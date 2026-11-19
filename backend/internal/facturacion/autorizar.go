package facturacion

import (
	"context"
	"errors"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/clientes"
	"mjbj/internal/fiscal"
	"mjbj/internal/formato"
	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
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

// FechaMovida es un comprobante que salió a ARCA con la fecha del día en vez
// de la suya (arca.alDia).
type FechaMovida struct {
	InvoiceID string    `json:"invoiceId"`
	Etiqueta  string    `json:"etiqueta"`
	De        time.Time `json:"de"`
	A         time.Time `json:"a"`
}

// Cadena es lo que hizo un pedido de CAE además del comprobante pedido: los
// que salieron con la fecha de hoy y los que quedaron autorizados (este y los
// anteriores de la serie).
type Cadena struct {
	Movidas     []FechaMovida
	Autorizados []string
}

// Autorizar manda el comprobante a ARCA y guarda el CAE. Devuelve el mensaje
// para mostrar, o un ErrorDeEmision con el motivo.
func (s *Servicio) Autorizar(ctx context.Context, id string) (string, error) {
	m, _, err := s.AutorizarConFechas(ctx, id)
	return m, err
}

// AutorizarConFechas es Autorizar, y además dice qué comprobantes salieron
// con la fecha de hoy y cuáles autorizó la cadena, para dejarlo en la
// bitácora y avisarle a cada cliente. Es el pedido desde Facturación: ahí
// alguien decidió autorizar la serie.
func (s *Servicio) AutorizarConFechas(ctx context.Context, id string) (string, Cadena, error) {
	a := &arca{s: s}
	m, err := s.autorizar(ctx, id, a)
	return m, Cadena{Movidas: a.movidas, Autorizados: a.autorizados}, err
}

// AutorizarAlEmitir es el pedido de CAE que sale solo, apenas se emite (la
// venta del mostrador, la API interna). No le cambia la fecha a nadie: si la
// cadena llega a un anterior de otro día, frena y el comprobante queda
// pendiente. Antes la primera venta fiscal después de cargar el certificado
// autorizaba con fecha de hoy todo lo atrasado, sin bitácora ni aviso, y la
// pregunta que el documento le hace al estudio (autorizar con fecha de hoy o
// dar de baja lo de meses cerrados) ya la había contestado el sistema.
// Los anteriores del mismo día sí pasan (son las ventas que llegaron al mismo
// tiempo), y a cada uno se le manda su comprobante.
func (s *Servicio) AutorizarAlEmitir(ctx context.Context, id string) (string, error) {
	a := &arca{s: s, sinMover: true}
	m, err := s.autorizar(ctx, id, a)
	for _, otro := range a.autorizados {
		if otro == id {
			continue
		}
		if e := s.AvisarFactura(ctx, otro); e != nil {
			s.log.Error("encolando el aviso de la factura", "invoiceId", otro, "error", e)
		}
	}
	return m, err
}

// ventaAnulada dice si el comprobante es de un pedido cancelado: una venta
// anulada en el mostrador sin CAE no va a ARCA (sería IVA de una venta que no
// existió); se da de baja.
func ventaAnulada(ctx context.Context, c consultor, id string) (bool, error) {
	var si bool
	err := c.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM invoices i JOIN orders o ON o.id = i.order_id
		WHERE i.id = $1 AND o.estado = 'cancelado')`, id).Scan(&si)
	return si, err
}

func (s *Servicio) autorizar(ctx context.Context, id string, a *arca) (string, error) {
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
	restaurar, err := plataforma.SinTopes(ctx, conn)
	if err != nil {
		return "", err
	}
	defer restaurar()
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
	if anulada, err := ventaAnulada(ctx, s.pool, id); err != nil {
		return "", err
	} else if anulada {
		return "", errEmision("La venta de este comprobante se anuló: dalo de baja.")
	}
	a.cfg = cfg
	// El camino corto: si el anterior tiene CAE en esta base, este es el
	// siguiente para ARCA y se pide directo (una sola llamada). Si ARCA dice
	// que no es el siguiente (10016) —otro sistema numeró, o un CAE se perdió
	// en un corte—, se va al camino largo.
	var anteriorConCAE bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM invoices WHERE punto_venta = $1 AND tipo = $2::tipo_comprobante
		AND numero = $3 AND cae IS NOT NULL)`, c.puntoVenta, c.tipo, c.numero-1).Scan(&anteriorConCAE); err != nil {
		return "", err
	}
	if anteriorConCAE {
		r, err := a.pedir(ctx, c)
		if err != nil {
			return "", err
		}
		if r.Autorizado || !strings.Contains(r.Observaciones, "[10016]") {
			return a.aplicar(ctx, c, r)
		}
	}
	return a.largo(ctx, c)
}

// largo pregunta el último autorizado y, según dónde está ARCA, recupera el
// CAE, autoriza antes los anteriores o pide el de este.
func (a *arca) largo(ctx context.Context, c *comprobanteArca) (string, error) {
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

// CorregirReceptor arregla los datos del receptor de un comprobante que ARCA
// rechazó, para volver a pedir su CAE con el mismo número.
//
// Para ARCA un número rechazado no se consumió: el próximo que espera sigue
// siendo ese. Pero el siguiente comprobante del mismo tipo, al autorizarse,
// pasa primero por el rechazado (ARCA no deja saltear números), y si el
// rechazo era por un dato del receptor (un CUIT mal, la condición frente al
// IVA) fallaba igual, para siempre. Corregido acá, el reintento manda los
// datos nuevos (paraArca lee la fila en cada pedido).
//
// La letra no cambia: con otra letra el comprobante sería de otra serie y
// este número quedaría vacío en la suya. Para eso (y para un rechazo que no
// es del receptor) está la baja (DarDeBaja).
func (s *Servicio) CorregirReceptor(ctx context.Context, id string, c map[string]string) error {
	cab, err := validarCabecera(c)
	if err != nil {
		return err
	}
	if strings.TrimSpace(cab.cuit) != "" {
		if _, msj := clientes.LeerDocumento(cab.cuit); msj != "" {
			return errEmision(msj)
		}
	}
	var cuit *string
	if d := fiscal.SoloDigitos(cab.cuit); d != "" {
		cuit = &d
	}
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var tipo, estado string
		var cae *string
		var total float64
		err := tx.QueryRow(ctx, `SELECT tipo::text, estado::text, cae, total::float8 FROM invoices WHERE id = $1 FOR UPDATE`, id).
			Scan(&tipo, &estado, &cae, &total)
		if errors.Is(err, pgx.ErrNoRows) {
			return errEmision("No encontramos el comprobante.")
		}
		if err != nil {
			return err
		}
		if estado != "rechazada" || cae != nil {
			return errEmision("Solo se corrigen los datos de un comprobante que ARCA rechazó.")
		}
		config, err := emisorEn(ctx, tx)
		if err != nil {
			return err
		}
		if l := fiscal.LetraQueCorresponde(config.CondicionIva, cab.condicion); l != fiscal.LetraDe(tipo) {
			return errEmision("Con esa condición frente al IVA corresponde una " + fiscal.NombreComprobante(fiscal.TipoFactura(l)) +
				", y este comprobante es " + fiscal.NombreComprobante(tipo) + ": la letra no se puede cambiar sobre el mismo número.")
		}
		if fiscal.LetraDe(tipo) == "A" {
			if m := faltaCuitParaLaA(fiscal.ResponsableInscripto, cuit); m != "" {
				return errEmision(m)
			}
		}
		if m := fiscal.FaltaIdentificarComprador(tipo, total, cuit, s.ahora()); m != "" {
			return errEmision(m)
		}
		_, err = tx.Exec(ctx, `UPDATE invoices SET receptor_nombre = $2, receptor_cuit = $3, receptor_condicion_iva = $4::condicion_iva,
			receptor_domicilio = $5, estado = 'emitida', observaciones_arca = NULL, updated_at = now() WHERE id = $1`,
			id, cab.nombre, cuit, cab.condicion, cab.domicilio)
		return err
	})
}

// arca es una conversación con ARCA dentro del candado.
type arca struct {
	s      *Servicio
	cfg    *fiscal.Config
	ticket *fiscal.Ticket
	// movidas son los que salieron con la fecha de hoy (alDia).
	movidas []FechaMovida
	// autorizados son los que recibieron su CAE en esta conversación.
	autorizados []string
	// sinMover: alDia no cambia fechas (AutorizarAlEmitir).
	sinMover bool
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
	if err := a.fechaDeArca(ctx, c, q.CbteFch); err != nil {
		return "", err
	}
	obs := "Recuperado de ARCA: el CAE se había otorgado y no llegó a guardarse."
	if err := a.s.guardarCAE(ctx, c.id, q.Cae, q.CaeVencimiento, &obs, a.cfg.Ambiente); err != nil {
		return "", err
	}
	a.autorizados = append(a.autorizados, c.id)
	return "Autorizado por ARCA. CAE " + q.Cae + ".", nil
}

// fechaDeArca deja en la base la fecha con que ARCA autorizó lo recuperado.
// El camino corto pasa por alDia antes de saber que el número ya estaba
// autorizado: un CAE otorgado el 31/10 y recuperado el 3/11 quedaba con
// fecha de noviembre en la base y de octubre en ARCA (libro IVA, CSV y QR en
// el mes equivocado). Si ARCA tiene la fecha original, el comprobante nunca
// se movió y sale de las movidas.
func (a *arca) fechaDeArca(ctx context.Context, c *comprobanteArca, cbteFch string) error {
	f := fiscal.DesdeFechaArca(cbteFch)
	if f == nil || cbteFch == fiscal.FechaArca(c.fecha) {
		return nil
	}
	var original *time.Time
	if err := a.s.pool.QueryRow(ctx, `SELECT fecha_emision_original FROM invoices WHERE id = $1`, c.id).Scan(&original); err != nil {
		return err
	}
	nueva := *f
	if original != nil && fiscal.FechaArca(*original) == cbteFch {
		nueva = *original
		original = nil
	}
	if _, err := a.s.pool.Exec(ctx, `UPDATE invoices SET fecha_emision = $2, fecha_emision_original = $3, updated_at = now()
		WHERE id = $1 AND cae IS NULL`, c.id, nueva, original); err != nil {
		return err
	}
	quedan := a.movidas[:0]
	for _, m := range a.movidas {
		if m.InvoiceID != c.id {
			quedan = append(quedan, m)
		} else if original != nil {
			m.A = nueva
			quedan = append(quedan, m)
		}
	}
	a.movidas = quedan
	c.fecha = nueva
	return nil
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
	if anulada, err := ventaAnulada(ctx, a.s.pool, id); err != nil {
		return err
	} else if anulada {
		return errEmision("Antes está el " + nombre + ", de una venta anulada: dalo de baja.")
	}
	if a.sinMover && fiscal.FechaArca(c.fecha) < fiscal.FechaArca(a.s.ahora()) {
		return errEmision("Antes está el " + nombre + ", del " + c.fecha.In(fiscal.Argentina).Format("02/01/2006") +
			", sin CAE: se autoriza desde Facturación.")
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
	r, err := a.pedir(ctx, c)
	if err != nil {
		return "", err
	}
	return a.aplicar(ctx, c, r)
}

// pedir manda FECAESolicitar y devuelve lo que contestó ARCA, sin tocar la base.
func (a *arca) pedir(ctx context.Context, c *comprobanteArca) (fiscal.Resultado, error) {
	if err := a.alDia(ctx, c); err != nil {
		return fiscal.Resultado{}, err
	}
	aut, err := a.s.paraArca(ctx, c)
	if err != nil {
		return fiscal.Resultado{}, err
	}
	// Una alícuota sin Id de AlicIva no sale: el cuerpo la mandaría como 21 %.
	for _, i := range aut.Iva {
		if !fiscal.AlicuotaValida(i.Alicuota) {
			return fiscal.Resultado{}, errEmision(fiscal.MensajeAlicuota + " El comprobante tiene un renglón al " + jsmath.Texto(i.Alicuota) + " %.")
		}
	}
	auth, err := a.auth(ctx)
	if err != nil {
		return fiscal.Resultado{}, sinConexion(err)
	}
	body, err := fiscal.Llamar(ctx, a.cfg, a.s.bitacoraArca(), "FECAESolicitar", fiscal.CuerpoAutorizar(*aut, a.cfg.Cuit, auth), &c.id)
	if err != nil {
		return fiscal.Resultado{}, sinConexion(err)
	}
	return fiscal.LeerAutorizacion(body), nil
}

// alDia pasa a la fecha de hoy un comprobante que se emitió otro día.
//
// ARCA acepta unos cinco días para atrás y nunca una fecha anterior a la del
// último que autorizó en la serie. Lo emitido sin certificado, o rechazado y
// reintentado una semana después, salía con su fecha original y ARCA lo
// rechazaba para siempre. Siempre hoy, aunque esté dentro de los cinco días:
// un pendiente con fecha vieja detrás de uno autorizado hoy también se
// rechazaría.
//
// Va acá y no en Autorizar porque cubre también los anteriores que autoriza
// la cadena. La fecha con que se emitió queda en fecha_emision_original (si
// era de un mes ya cerrado, la venta pasa al mes de hoy y el cierre lo
// muestra), y quien pidió el CAE lo deja en la bitácora (AutorizarConFechas).
// El reloj es el del servicio, no now() de la base: las pruebas lo mueven.
func (a *arca) alDia(ctx context.Context, c *comprobanteArca) error {
	hoy := a.s.ahora()
	if fiscal.FechaArca(c.fecha) >= fiscal.FechaArca(hoy) {
		return nil
	}
	if a.sinMover {
		return errEmision("El " + etiqueta(c.tipo, c.puntoVenta, c.numero) + " es del " + c.fecha.In(fiscal.Argentina).Format("02/01/2006") +
			" y sigue sin CAE: se autoriza desde Facturación.")
	}
	tag, err := a.s.pool.Exec(ctx, `UPDATE invoices SET fecha_emision = $2, fecha_emision_original = coalesce(fecha_emision_original, fecha_emision),
		updated_at = now() WHERE id = $1 AND cae IS NULL`, c.id, hoy)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 1 {
		a.movidas = append(a.movidas, FechaMovida{InvoiceID: c.id, Etiqueta: etiqueta(c.tipo, c.puntoVenta, c.numero), De: c.fecha, A: hoy})
		c.fecha = hoy
	}
	return nil
}

// aplicar guarda lo que contestó ARCA: el CAE, o el rechazo con su motivo.
func (a *arca) aplicar(ctx context.Context, c *comprobanteArca, r fiscal.Resultado) (string, error) {
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
	if err := a.s.guardarCAE(ctx, c.id, r.Cae, r.CaeVencimiento, nulo(r.Observaciones), a.cfg.Ambiente); err != nil {
		return "", err
	}
	a.autorizados = append(a.autorizados, c.id)
	return "Autorizado por ARCA. CAE " + r.Cae + ".", nil
}

func nulo(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// guardarCAE deja el CAE con el ambiente del que salió: un CAE de homologación no tiene valor fiscal
// y queda fuera del libro IVA y del cierre (ver reportes.conCae).
func (s *Servicio) guardarCAE(ctx context.Context, id, cae string, vence *time.Time, obs *string, ambiente string) error {
	_, err := s.pool.Exec(ctx, `UPDATE invoices SET estado = 'autorizada', cae = $2, cae_vencimiento = $3, observaciones_arca = $4,
		cae_ambiente = nullif($5, ''), updated_at = now() WHERE id = $1 AND cae IS NULL`, id, cae, vence, obs, ambiente)
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
		// La misma cuenta que el libro IVA digital (fiscal.AgruparIva).
		a.Iva = fiscal.AgruparIva(a.Iva, alic, neto, iva)
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
	restaurar, err := plataforma.SinTopes(ctx, conn)
	if err != nil {
		return t, err
	}
	defer restaurar()
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
