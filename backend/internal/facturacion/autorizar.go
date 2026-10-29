package facturacion

import (
	"context"
	"errors"
	"math"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/fiscal"
	"mjbj/internal/formato"
	"mjbj/internal/jsmath"
)

// El pedido de CAE (autorizarComprobante). Va **fuera** de la transacción
// que crea el comprobante: el comprobante primero existe, con su número, y
// después se manda a autorizar; una llamada a ARCA adentro de la transacción
// la dejaría abierta mientras ARCA piensa, y un rollback borraría un
// comprobante que ARCA quizás ya autorizó.
//
// El TS no cubría el otro lado: si el proceso se cortaba entre la respuesta
// de ARCA y el guardado del CAE (o la respuesta no llegaba), el comprobante
// quedaba «emitido» sin CAE; al reintentar, ARCA rechazaba el número por
// repetido (10016) y el TS lo marcaba «rechazado», con el CAE perdido. Acá:
//
//  1. Un pedido de CAE a la vez (CandadoCAE, un candado de sesión: no hay
//     transacción abierta mientras se habla con ARCA).
//  2. Antes de pedir, se pregunta el último autorizado del punto de venta y
//     tipo. Si el número ya está del lado de ARCA, se consulta
//     (FECompConsultar) y se adopta su CAE si los datos coinciden: el
//     reintento recupera lo que se perdió.
//  3. Si hay anteriores sin autorizar, se autorizan primero y en orden: ARCA
//     solo acepta el siguiente número, y dos ventas al mismo tiempo podían
//     llegar al revés.
//  4. El CAE se guarda solo si el comprobante no tiene uno (`cae IS NULL`).

// comprobanteArca es lo que hace falta para pedir el CAE.
type comprobanteArca struct {
	id, tipo, estado    string
	puntoVenta, numero  int64
	fecha               time.Time
	cae                 *string
	receptorCuit        *string
	condicion           string
	neto, exento, total float64
	origen              *string
}

const columnasArca = `id, tipo::text, estado::text, punto_venta, numero, fecha_emision, cae, receptor_cuit,
	receptor_condicion_iva::text, neto::float8, exento::float8, total::float8, comprobante_origen_id`

func (c *comprobanteArca) campos() []any {
	return []any{&c.id, &c.tipo, &c.estado, &c.puntoVenta, &c.numero, &c.fecha, &c.cae, &c.receptorCuit, &c.condicion,
		&c.neto, &c.exento, &c.total, &c.origen}
}

func leerParaArca(ctx context.Context, c consultor, id string) (*comprobanteArca, error) {
	var x comprobanteArca
	err := c.QueryRow(ctx, `SELECT `+columnasArca+` FROM invoices WHERE id = $1`, id).Scan(x.campos()...)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &x, err
}

func etiqueta(tipo string, pv, n int64) string {
	return fiscal.NombreComprobante(tipo) + " " + fiscal.NumeroFormateado(pv, n)
}

const sinValorFiscal = "Emitido sin autorización de ARCA. El comprobante no tiene valor fiscal hasta que se cargue el certificado y se lo reenvíe."

// maxAnteriores es cuántos comprobantes anteriores sin CAE se autorizan de
// una vez antes de pedir que alguien mire qué pasó.
const maxAnteriores = 50

// Autorizar manda el comprobante a ARCA y guarda el CAE. Devuelve el mensaje
// para mostrar, o un ErrorDeEmision con el motivo.
func (s *Servicio) Autorizar(ctx context.Context, id string) (string, error) {
	c, err := leerParaArca(ctx, s.pool, id)
	if err != nil {
		return "", err
	}
	if c == nil {
		return "", errEmision("No encontramos el comprobante.")
	}
	if c.cae != nil {
		return "", errEmision("Este comprobante ya está autorizado.")
	}
	if c.estado == "anulada" {
		return "", errEmision("El comprobante está anulado.")
	}
	if !s.env.UsaArca() {
		// El proveedor interno: numera y emite, pero no autoriza. Nunca un
		// CAE inventado.
		if _, err := s.pool.Exec(ctx, `UPDATE invoices SET estado = 'rechazada', observaciones_arca = $2, updated_at = now() WHERE id = $1`,
			id, sinValorFiscal); err != nil {
			return "", err
		}
		return "", errEmision(sinValorFiscal)
	}
	cfg := s.env.Leer()

	s.cae.Lock()
	defer s.cae.Unlock()
	conn, err := s.pool.Acquire(ctx)
	if err != nil {
		return "", err
	}
	defer conn.Release()
	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock($1)`, CandadoCAE); err != nil {
		return "", err
	}
	defer func() { _, _ = conn.Exec(context.WithoutCancel(ctx), `SELECT pg_advisory_unlock($1)`, CandadoCAE) }()

	// Mientras se esperaba el candado, otro pedido pudo haberlo autorizado
	// (como anterior de otro comprobante).
	if c, err = leerParaArca(ctx, s.pool, id); err != nil {
		return "", err
	}
	if c.cae != nil {
		return "Autorizado por ARCA. CAE " + *c.cae + ".", nil
	}
	if c.estado == "anulada" {
		return "", errEmision("El comprobante está anulado.")
	}
	a := &arca{s: s, cfg: cfg}
	ultimo, err := a.ultimo(ctx, c.puntoVenta, c.tipo)
	if err != nil {
		return "", err
	}
	switch {
	case c.numero <= ultimo:
		return a.recuperar(ctx, c)
	case c.numero > ultimo+1:
		if c.numero-ultimo-1 > maxAnteriores {
			return "", errEmision("ARCA tiene autorizado hasta el " + fiscal.NumeroFormateado(c.puntoVenta, ultimo) + " y faltan " +
				strconv.FormatInt(c.numero-ultimo-1, 10) + " comprobantes antes de este: revisá el número inicial del punto de venta en ARCA › Puntos de venta.")
		}
		for n := ultimo + 1; n < c.numero; n++ {
			if err := a.anterior(ctx, c, n); err != nil {
				return "", err
			}
		}
	}
	return a.solicitar(ctx, c)
}

// arca es una conversación con ARCA dentro del candado.
type arca struct {
	s      *Servicio
	cfg    *fiscal.Config
	ticket *fiscal.Ticket
}

func (a *arca) auth(ctx context.Context) (string, error) {
	if a.ticket == nil {
		t, err := a.s.ticket(ctx, a.cfg)
		if err != nil {
			return "", err
		}
		a.ticket = &t
	}
	return fiscal.AuthXML(*a.ticket, a.cfg.Cuit), nil
}

// sinConexion pasa un error de red a lo que se le muestra a quien factura.
func sinConexion(err error) error {
	if Mensaje(err) != "" {
		return err
	}
	if errors.Is(err, fiscal.ErrSinRespuesta) {
		return errEmision("No se pudo conectar con ARCA.")
	}
	return errEmision(err.Error())
}

func (a *arca) ultimo(ctx context.Context, pv int64, tipo string) (int64, error) {
	auth, err := a.auth(ctx)
	if err != nil {
		return 0, sinConexion(err)
	}
	body, err := fiscal.Llamar(ctx, a.cfg, a.s.bitacoraArca(), "FECompUltimoAutorizado", fiscal.CuerpoUltimo(auth, pv, tipo), nil)
	if err != nil {
		return 0, sinConexion(err)
	}
	n, e := fiscal.LeerUltimo(body)
	if e != "" {
		return 0, errEmision(e)
	}
	if n == nil {
		return 0, errEmision("ARCA no dijo cuál es el último comprobante autorizado.")
	}
	return *n, nil
}

// recuperar: el número ya está del lado de ARCA. Si es este comprobante (el
// mismo documento y el mismo total), se adopta el CAE que ARCA dio y no
// llegó a guardarse.
func (a *arca) recuperar(ctx context.Context, c *comprobanteArca) (string, error) {
	auth, err := a.auth(ctx)
	if err != nil {
		return "", sinConexion(err)
	}
	body, err := fiscal.Llamar(ctx, a.cfg, a.s.bitacoraArca(), "FECompConsultar", fiscal.CuerpoConsultar(auth, c.puntoVenta, c.tipo, c.numero), &c.id)
	if err != nil {
		return "", sinConexion(err)
	}
	q := fiscal.LeerConsulta(body)
	nombre := etiqueta(c.tipo, c.puntoVenta, c.numero)
	if !q.Existe {
		return "", errEmision("ARCA ya numeró más allá del " + nombre + " pero no lo tiene registrado. Revisá la numeración del punto de venta. " + q.Errores)
	}
	tipoDoc, nroDoc := fiscal.DocumentoReceptor(c.receptorCuit)
	if q.Resultado != "A" || q.Cae == "" || int(q.DocTipo) != tipoDoc || q.DocNro != nroDoc || math.Abs(q.ImpTotal-c.total) > 0.005 {
		return "", errEmision("ARCA ya tiene autorizado el " + nombre + " con otros datos (total " + formato.Moneda(q.ImpTotal) +
			"): alguien facturó con este punto de venta desde otro sistema. Revisá la numeración antes de seguir.")
	}
	obs := "Recuperado de ARCA: el CAE se había otorgado y no llegó a guardarse."
	if err := a.s.guardarCAE(ctx, c.id, q.Cae, q.CaeVencimiento, &obs); err != nil {
		return "", err
	}
	return "Autorizado por ARCA. CAE " + q.Cae + ".", nil
}

// anterior autoriza el número n, que está antes del que se pidió.
func (a *arca) anterior(ctx context.Context, despues *comprobanteArca, n int64) error {
	var id string
	err := a.s.pool.QueryRow(ctx, `SELECT id FROM invoices WHERE punto_venta = $1 AND tipo = $2::tipo_comprobante AND numero = $3`,
		despues.puntoVenta, despues.tipo, n).Scan(&id)
	nombre := etiqueta(despues.tipo, despues.puntoVenta, n)
	if errors.Is(err, pgx.ErrNoRows) {
		return errEmision("ARCA espera antes el " + nombre + ", que no está en este sistema: revisá el número inicial del punto de venta en ARCA › Puntos de venta.")
	}
	if err != nil {
		return err
	}
	c, err := leerParaArca(ctx, a.s.pool, id)
	if err != nil {
		return err
	}
	if c.cae != nil {
		return errEmision("El " + nombre + " tiene CAE pero ARCA no lo cuenta como autorizado: revisá que el ambiente (homologación o producción) sea el correcto.")
	}
	if c.estado == "anulada" {
		return errEmision("Antes hay que autorizar el " + nombre + ", que está anulado sin CAE: ARCA no deja saltear números.")
	}
	if _, err := a.solicitar(ctx, c); err != nil {
		if m := Mensaje(err); m != "" {
			return errEmision("Antes hay que autorizar el " + nombre + ": " + m)
		}
		return err
	}
	return nil
}

// solicitar pide el CAE de un comprobante que es el siguiente para ARCA.
func (a *arca) solicitar(ctx context.Context, c *comprobanteArca) (string, error) {
	aut, err := a.s.paraArca(ctx, c)
	if err != nil {
		return "", err
	}
	auth, err := a.auth(ctx)
	if err != nil {
		return "", sinConexion(err)
	}
	body, err := fiscal.Llamar(ctx, a.cfg, a.s.bitacoraArca(), "FECAESolicitar", fiscal.CuerpoAutorizar(*aut, a.cfg.Cuit, auth), &c.id)
	if err != nil {
		return "", sinConexion(err)
	}
	r := fiscal.LeerAutorizacion(body)
	if !r.Autorizado {
		if _, err := a.s.pool.Exec(ctx, `UPDATE invoices SET estado = 'rechazada', observaciones_arca = $2, updated_at = now()
			WHERE id = $1 AND cae IS NULL`, c.id, nulo(r.Observaciones)); err != nil {
			return "", err
		}
		if r.Observaciones == "" {
			return "", errEmision("ARCA no autorizó el comprobante.")
		}
		return "", errEmision(r.Observaciones)
	}
	if a.s.despuesDelCAE != nil {
		if err := a.s.despuesDelCAE(c.id); err != nil {
			return "", err
		}
	}
	if err := a.s.guardarCAE(ctx, c.id, r.Cae, r.CaeVencimiento, nulo(r.Observaciones)); err != nil {
		return "", err
	}
	return "Autorizado por ARCA. CAE " + r.Cae + ".", nil
}

func nulo(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func (s *Servicio) guardarCAE(ctx context.Context, id, cae string, vence *time.Time, obs *string) error {
	_, err := s.pool.Exec(ctx, `UPDATE invoices SET estado = 'autorizada', cae = $2, cae_vencimiento = $3, observaciones_arca = $4,
		updated_at = now() WHERE id = $1 AND cae IS NULL`, id, cae, vence, obs)
	return err
}

// paraArca arma ComprobanteAAutorizar: el IVA reagrupado desde los renglones
// (en su orden), los tributos y el comprobante asociado.
func (s *Servicio) paraArca(ctx context.Context, c *comprobanteArca) (*fiscal.AAutorizar, error) {
	a := &fiscal.AAutorizar{Tipo: c.tipo, PuntoVenta: c.puntoVenta, Numero: c.numero, FechaEmision: c.fecha, ReceptorCuit: c.receptorCuit,
		ReceptorCondicionIva: c.condicion, Neto: c.neto, Exento: c.exento, Total: c.total, Iva: []fiscal.IvaDeAlicuota{}, Tributos: []fiscal.Tributo{}}
	filas, err := s.pool.Query(ctx, `SELECT alicuota_iva::float8, neto::float8, iva::float8 FROM invoice_items WHERE invoice_id = $1 ORDER BY orden`, c.id)
	if err != nil {
		return nil, err
	}
	for filas.Next() {
		var alic, neto, iva float64
		if err := filas.Scan(&alic, &neto, &iva); err != nil {
			filas.Close()
			return nil, err
		}
		if alic <= 0 {
			continue
		}
		i := -1
		for k, x := range a.Iva {
			if x.Alicuota == alic {
				i = k
			}
		}
		if i < 0 {
			a.Iva = append(a.Iva, fiscal.IvaDeAlicuota{Alicuota: alic})
			i = len(a.Iva) - 1
		}
		a.Iva[i].Base = fiscal.Redondear(a.Iva[i].Base + neto)
		a.Iva[i].Importe = fiscal.Redondear(a.Iva[i].Importe + iva)
	}
	filas.Close()
	if err := filas.Err(); err != nil {
		return nil, err
	}
	filas, err = s.pool.Query(ctx, `SELECT codigo, descripcion, base_imponible::float8, alicuota::float8, importe::float8
		FROM invoice_tributos WHERE invoice_id = $1`, c.id)
	if err != nil {
		return nil, err
	}
	for filas.Next() {
		var t fiscal.Tributo
		if err := filas.Scan(&t.Codigo, &t.Descripcion, &t.Base, &t.Alicuota, &t.Importe); err != nil {
			filas.Close()
			return nil, err
		}
		a.Tributos = append(a.Tributos, t)
	}
	filas.Close()
	if c.origen != nil {
		var as fiscal.Asociado
		err := s.pool.QueryRow(ctx, `SELECT tipo::text, punto_venta, numero, fecha_emision FROM invoices WHERE id = $1`, *c.origen).
			Scan(&as.Tipo, &as.PuntoVenta, &as.Numero, &as.Fecha)
		if err == nil {
			a.Asociado = &as
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
	}
	return a, nil
}

// ticket es ticketDeAcceso: el guardado si vence en más de cinco minutos; si
// no, uno nuevo. Pedirlo va con un candado: ARCA no da un segundo ticket
// mientras el primero siga vigente, y dos pedidos a la vez dejaban al segundo
// sin poder facturar.
func (s *Servicio) ticket(ctx context.Context, cfg *fiscal.Config) (fiscal.Ticket, error) {
	leer := func(c consultor) (fiscal.Ticket, error) {
		var t fiscal.Ticket
		err := c.QueryRow(ctx, `SELECT token, sign, expira_at FROM arca_tokens WHERE servicio = 'wsfe' AND ambiente = $1 AND expira_at > $2
			ORDER BY expira_at DESC LIMIT 1`, cfg.Ambiente, s.ahora().Add(5*time.Minute)).Scan(&t.Token, &t.Sign, &t.Expira)
		return t, err
	}
	t, err := leer(s.pool)
	if err == nil {
		return t, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return t, err
	}
	conn, err := s.pool.Acquire(ctx)
	if err != nil {
		return t, err
	}
	defer conn.Release()
	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock($1)`, CandadoTicket); err != nil {
		return t, err
	}
	defer func() { _, _ = conn.Exec(context.WithoutCancel(ctx), `SELECT pg_advisory_unlock($1)`, CandadoTicket) }()
	if t, err = leer(conn); err == nil {
		return t, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return t, err
	}
	t, err = fiscal.PedirTicket(ctx, cfg, "wsfe", s.ahora())
	if err != nil {
		return t, err
	}
	_, err = conn.Exec(ctx, `INSERT INTO arca_tokens (servicio, ambiente, token, sign, expira_at) VALUES ('wsfe', $1, $2, $3, $4)`,
		cfg.Ambiente, t.Token, t.Sign, t.Expira)
	return t, err
}

// bitacoraArca deja cada llamada en arca_log: el pedido antes de mandarlo y
// la respuesta cuando llega.
type bitacoraArca struct{ pool *pgxpool.Pool }

func (s *Servicio) bitacoraArca() fiscal.Bitacora { return bitacoraArca{s.pool} }

func (b bitacoraArca) Antes(ctx context.Context, invoiceID *string, operacion, ambiente, solicitud string) string {
	var id string
	_ = b.pool.QueryRow(ctx, `INSERT INTO arca_log (invoice_id, operacion, ambiente, exito, solicitud, respuesta)
		VALUES ($1, $2, $3, false, $4, '') RETURNING id`, invoiceID, operacion, ambiente, solicitud).Scan(&id)
	return id
}

func (b bitacoraArca) Despues(ctx context.Context, id string, exito bool, respuesta string) {
	if id == "" {
		return
	}
	_, _ = b.pool.Exec(ctx, `UPDATE arca_log SET exito = $2, respuesta = $3 WHERE id = $1`, id, exito, respuesta)
}

var _ = jsmath.Fijo2
