package pagos

import (
	"context"
	"errors"
	"math"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/checkout"
	"mjbj/internal/cobros"
	"mjbj/internal/formato"
	"mjbj/internal/jsmath"
	"mjbj/internal/limites"
	"mjbj/internal/plataforma"
	"mjbj/internal/precios"
	"mjbj/internal/push"
	"mjbj/internal/sqlc"
	"mjbj/internal/subidas"
	"mjbj/internal/zodjs"
)

// Lo que hace falta para las acciones que guardan archivos, frenan y avisan
// al panel.
type Extras struct {
	Lim   *limites.Limitador
	Disco *subidas.Disco
	Push  *push.Avisador
}

// Resultado es el { ok } de una acción (el error va como problema).
type Resultado struct {
	Ok string `json:"ok"`
	// Trabajo es el aviso encolado para el TS, si se acreditó algo.
	Trabajo *string `json:"trabajo,omitempty"`
}

// --- app/(public)/pago-actions.ts ---

// PagarPedido abre el checkout de un pedido: el token (o el dueño, o el
// personal) es lo que autoriza.
func (s *Servicio) PagarPedido(ctx context.Context, numero, token string, ses *auth.Sesion) (*CobroAbierto, error) {
	if numero == "" {
		return nil, fallo("Falta el número de pedido.")
	}
	p, err := s.Autorizado(ctx, numero, token, ses)
	if err != nil {
		return nil, err
	}
	if p == nil {
		return nil, fallo("No encontramos ese pedido.")
	}
	if p.EstadoPago == "pagado" {
		return nil, fallo("Este pedido ya está pagado.")
	}
	var usuario *string
	if ses != nil {
		usuario = &ses.UserID
	}
	c, err := s.IniciarPagoDePedido(ctx, p.ID, usuario)
	var prob *plataforma.Problema
	if err != nil && !errors.As(err, &prob) {
		s.log.Error("no se pudo abrir el pago", "pedido", numero, "error", err)
		return nil, fallo("No pudimos abrir el pago. Probá de nuevo en un momento o escribinos por WhatsApp.")
	}
	return c, err
}

// TiposDeComprobante son los que se aceptan.
var TiposDeComprobante = map[string]bool{"image/jpeg": true, "image/png": true, "image/webp": true, "application/pdf": true}

// Archivo es lo que se subió.
type Archivo struct {
	Datos []byte
	Tipo  string
}

func revisarArchivo(a *Archivo) error {
	if a == nil || len(a.Datos) == 0 {
		return fallo("Adjuntá el comprobante de la transferencia.")
	}
	if !TiposDeComprobante[a.Tipo] {
		return fallo("Subí una imagen o un PDF.")
	}
	return nil
}

func (s *Servicio) guardar(x Extras, a *Archivo) (string, error) {
	url, err := x.Disco.GuardarAdjunto(a.Datos, a.Tipo, "comprobante")
	var e *subidas.ErrSubida
	if errors.As(err, &e) {
		return "", fallo(e.Mensaje)
	}
	return url, err
}

// SubirComprobante deja una transferencia de un pedido en revisión: una
// captura no es plata acreditada.
func (s *Servicio) SubirComprobante(ctx context.Context, x Extras, numero, token string, ses *auth.Sesion, a *Archivo) (Resultado, error) {
	if err := revisarArchivo(a); err != nil {
		return Resultado{}, err
	}
	p, err := s.Autorizado(ctx, numero, token, ses)
	if err != nil {
		return Resultado{}, err
	}
	if p == nil {
		return Resultado{}, fallo("No encontramos ese pedido.")
	}
	// Se cuenta después del token: contado antes, cualquiera que supiera el
	// número (son consecutivos) le gastaba los intentos al dueño del pedido.
	if v := x.Lim.Permitido(ctx, limites.Comprobante, "pedido:"+numero); !v.Permitido {
		return Resultado{}, fallo(limites.AvisoDeEspera(v))
	}
	if p.EstadoPago == "pagado" {
		return Resultado{}, fallo("Este pedido ya está pagado.")
	}
	url, err := s.guardar(x, a)
	if err != nil {
		return Resultado{}, err
	}
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `
			INSERT INTO payments (order_id, customer_id, tipo, proveedor, medio, monto, estado, comprobante_url)
			VALUES ($1, $2, 'pedido', 'transferencia', 'transferencia', $3::numeric, 'en_revision', $4)`,
			p.ID, p.CustomerID, jsmath.Fijo2(p.Total), url); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `UPDATE orders SET estado_pago = 'pendiente', updated_at = now() WHERE id = $1`, p.ID)
		return err
	})
	if err != nil {
		return Resultado{}, err
	}
	return Resultado{Ok: "Recibimos tu comprobante. Lo verificamos y te confirmamos el pago."}, nil
}

type clienteDeLaSesion struct{ id, nombre string }

func (s *Servicio) cliente(ctx context.Context, ses *auth.Sesion) (*clienteDeLaSesion, error) {
	if ses == nil {
		return nil, nil
	}
	var c clienteDeLaSesion
	err := s.pool.QueryRow(ctx, `SELECT id, nombre FROM customers WHERE user_id = $1 AND active LIMIT 1`, ses.UserID).Scan(&c.id, &c.nombre)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &c, err
}

// SubirComprobanteDeDeuda: una transferencia o un depósito para la cuenta
// corriente, en revisión hasta que alguien de la casa lo concilie.
func (s *Servicio) SubirComprobanteDeDeuda(ctx context.Context, x Extras, ses *auth.Sesion, a *Archivo, monto, medio string) (Resultado, error) {
	c, err := s.cliente(ctx, ses)
	if err != nil {
		return Resultado{}, err
	}
	if c == nil {
		return Resultado{}, fallo("Iniciá sesión para informar un pago.")
	}
	if err := revisarArchivo(a); err != nil {
		return Resultado{}, err
	}
	importe := precios.ParsearImporte(monto)
	if math.IsNaN(importe) || math.IsInf(importe, 0) || importe <= 0 {
		return Resultado{}, fallo("Ingresá el importe que pagaste.")
	}
	if medio != "deposito" {
		medio = "transferencia"
	}
	if v := x.Lim.Permitido(ctx, limites.Comprobante, "cliente:"+c.id); !v.Permitido {
		return Resultado{}, fallo(limites.AvisoDeEspera(v))
	}
	url, err := s.guardar(x, a)
	if err != nil {
		return Resultado{}, err
	}
	if _, err := s.pool.Exec(ctx, `
		INSERT INTO payments (customer_id, tipo, proveedor, medio, monto, estado, comprobante_url)
		VALUES ($1, 'deuda', 'transferencia', $2, $3::numeric, 'en_revision', $4)`, c.id, medio, jsmath.Fijo2(importe), url); err != nil {
		return Resultado{}, err
	}
	titulo := "Transferencia"
	if medio == "deposito" {
		titulo = "Depósito"
	}
	if x.Push != nil {
		go x.Push.Avisar(context.WithoutCancel(ctx), push.Aviso{
			Titulo: titulo + " informada · " + c.nombre, Cuerpo: formato.MonedaEntera(importe) + " para su cuenta corriente. Verificala en Pagos.",
			URL: "/admin/pagos", Etiqueta: "pago_informado",
		})
	}
	return Resultado{Ok: "Recibimos tu comprobante. Lo imputamos a tu cuenta al verificarlo y te mandamos el recibo."}, nil
}

// InformarCheques: los cheques con los que el cliente paga su cuenta nacen
// «informados» y no mueven la cuenta hasta que alguien los acepta.
func (s *Servicio) InformarCheques(ctx context.Context, x Extras, ses *auth.Sesion, partesCrudas string) (Resultado, error) {
	c, err := s.cliente(ctx, ses)
	if err != nil {
		return Resultado{}, err
	}
	if c == nil {
		return Resultado{}, fallo("Iniciá sesión para informar un pago.")
	}
	partes, msj := cobros.LeerPartes(partesCrudas)
	if msj != "" {
		return Resultado{}, fallo(msj)
	}
	for _, p := range partes {
		if !cobros.EsCheque(p.Medio) || p.Cheque == nil {
			return Resultado{}, fallo("Acá se informan cheques. Las transferencias van en la otra pestaña.")
		}
	}
	if p := cobros.Revisar(partes, ""); p != "" {
		return Resultado{}, fallo(p)
	}
	if v := x.Lim.Permitido(ctx, limites.Comprobante, "cliente:"+c.id); !v.Permitido {
		return Resultado{}, fallo(limites.AvisoDeEspera(v))
	}
	total := 0.0
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		for _, p := range partes {
			numero := cobros.NormalizarNumeroDeCheque(p.Cheque.Numero)
			banco := zodjs.TrimJS(p.Cheque.Banco)
			var hay bool
			if err := tx.QueryRow(ctx, `
				SELECT exists(SELECT 1 FROM cheques WHERE sentido = 'recibido' AND numero = $1
				  AND lower(coalesce(banco, '')) = lower($2) AND estado <> 'anulado' AND estado <> 'rechazado')`, numero, banco).Scan(&hay); err != nil {
				return err
			}
			if hay {
				return fallo("El cheque " + banco + " N° " + numero + " ya lo tenemos registrado. Si es otro, revisá el número.")
			}
			tipo := "fisico"
			if p.Medio == "echeq" {
				tipo = "echeq"
			}
			if _, err := tx.Exec(ctx, `
				INSERT INTO cheques (sentido, tipo, numero, banco, librador, fecha_pago, importe, estado, customer_id, notas)
				VALUES ('recibido', $1, $2, $3, $4, $5, $6::numeric, 'informado', $7, 'Informado por el cliente desde Mi cuenta')`,
				tipo, numero, banco, p.Cheque.Librador, p.Cheque.FechaPago, jsmath.Fijo2(p.Importe), c.id); err != nil {
				return err
			}
			total += p.Importe
		}
		return nil
	})
	if err != nil {
		return Resultado{}, err
	}
	n := len(partes)
	if x.Push != nil {
		titulo := "Cheque informado"
		if n != 1 {
			titulo = strconv.Itoa(n) + " cheques informados"
		}
		go x.Push.Avisar(context.WithoutCancel(ctx), push.Aviso{
			Titulo: titulo + " · " + c.nombre,
			Cuerpo: formato.MonedaEntera(total) + " para su cuenta corriente. Aceptalos en Cheques cuando los tengas en mano.",
			URL:    "/admin/cheques", Etiqueta: "cheque_informado",
		})
	}
	if n == 1 {
		return Resultado{Ok: "Listo, registramos tu cheque. Cuando lo recibamos te mandamos el recibo y baja tu saldo."}, nil
	}
	return Resultado{Ok: "Listo, registramos tus " + strconv.Itoa(n) + " cheques. Cuando los recibamos te mandamos el recibo y baja tu saldo."}, nil
}

// --- app/(public)/pago-demo/actions.ts ---

// Simulacion es a dónde vuelve la persona.
type Simulacion struct {
	VolverA string  `json:"volverA"`
	Estado  string  `json:"estado"`
	Trabajo *string `json:"trabajo,omitempty"`
}

// Simular arma el mismo aviso que mandaría Mercado Pago y lo pasa por
// ProcesarAviso. Solo sobre cobros del proveedor demo.
func (s *Servicio) Simular(ctx context.Context, pagoID, decision string) (*Simulacion, error) {
	p, err := s.Simulado(ctx, pagoID)
	if err != nil || p == nil {
		return nil, err
	}
	estado := Rechazado
	if decision == "aprobar" {
		estado = Aprobado
	}
	cuerpo := []byte(`{"id":"demo-evento-` + pagoID + `-` + estado + `","type":"payment","data":{"id":"` + IDSimulado(pagoID, estado) + `"}}`)
	r, err := s.ProcesarAviso(ctx, CargaAviso{Proveedor: "demo", Cuerpo: cuerpo, URL: "https://demo.local/api/pagos/webhook"})
	if err != nil {
		return nil, err
	}
	return &Simulacion{VolverA: p.VolverA, Estado: estado, Trabajo: r.Trabajo}, nil
}

// --- app/admin/pagos/actions.ts ---

// Conciliar acredita o rechaza una transferencia: la decide una persona,
// queda firmada (conciliado_por) y pasa por Acreditar como cualquier cobro.
func (s *Servicio) Conciliar(ctx context.Context, ses *auth.Sesion, pagoID, decision string, motivo *string) (Resultado, error) {
	if !plataforma.UUIDValido(pagoID) || (decision != "aprobar" && decision != "rechazar") || (motivo != nil && zodjs.LargoJS(zodjs.TrimJS(*motivo)) > 300) {
		return Resultado{}, fallo("No pudimos registrar la decisión. Si escribiste un motivo, fijate que no pase de 300 letras.")
	}
	if motivo != nil {
		t := zodjs.TrimJS(*motivo)
		motivo = &t
		if t == "" {
			motivo = nil
		}
	}
	var estado string
	err := s.pool.QueryRow(ctx, `SELECT estado::text FROM payments WHERE id = $1`, pagoID).Scan(&estado)
	if errors.Is(err, pgx.ErrNoRows) {
		return Resultado{}, fallo("El cobro no existe.")
	}
	if err != nil {
		return Resultado{}, err
	}
	if estado == Aprobado {
		return Resultado{}, fallo("Este cobro ya estaba acreditado.")
	}
	aprueba := decision == "aprobar"
	medio := "Transferencia bancaria"
	remoto := &PagoRemoto{ID: "manual-" + pagoID, Estado: Rechazado, Medio: &medio, Referencia: &pagoID}
	if aprueba {
		remoto.Estado = Aprobado
	} else {
		m := "Rechazada en la conciliación"
		if motivo != nil {
			m = *motivo
		}
		remoto.MotivoRechazo = &m
	}
	remoto.Crudo, _ = jsonDe(map[string]any{"conciliadoPor": ses.UserID, "decision": decision})
	r, err := s.Acreditar(ctx, pagoID, remoto)
	if err != nil {
		return Resultado{}, err
	}
	if _, err := s.pool.Exec(ctx, `UPDATE payments SET conciliado_por = $2, conciliado_at = now() WHERE id = $1`, pagoID, ses.UserID); err != nil {
		return Resultado{}, err
	}
	desc := "Acreditó una transferencia en la conciliación"
	accion := sqlc.AccionAuditoriaCobrar
	if !aprueba {
		accion = sqlc.AccionAuditoriaAnular
		m := "sin motivo"
		if motivo != nil {
			m = *motivo
		}
		desc = "Rechazó una transferencia: " + m
	}
	bitacora.Anotar(ctx, sqlc.New(s.pool), s.log, ses, accion, "pago", pagoID, desc, nil)
	if aprueba {
		return Resultado{Ok: "Cobro acreditado.", Trabajo: r.Trabajo}, nil
	}
	return Resultado{Ok: "Cobro rechazado. El cliente lo ve en su pedido."}, nil
}

// Reconsultar le vuelve a preguntar a Mercado Pago (los webhooks se
// pierden).
func (s *Servicio) Reconsultar(ctx context.Context, ses *auth.Sesion, pagoID string) (Resultado, error) {
	if !plataforma.UUIDValido(pagoID) {
		return Resultado{}, fallo("El cobro no existe.")
	}
	var proveedor string
	var remotoID *string
	err := s.pool.QueryRow(ctx, `SELECT proveedor::text, proveedor_payment_id FROM payments WHERE id = $1`, pagoID).Scan(&proveedor, &remotoID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Resultado{}, fallo("El cobro no existe.")
	}
	if err != nil {
		return Resultado{}, err
	}
	if remotoID == nil || *remotoID == "" {
		return Resultado{}, fallo("Todavía no hay un pago del lado de Mercado Pago: la persona no llegó a pagar.")
	}
	nombre := "mercado_pago"
	if proveedor == "demo" {
		nombre = "demo"
	}
	prov := s.porNombre(nombre)
	if prov == nil {
		return Resultado{}, fallo("Mercado Pago todavía no está conectado.")
	}
	remoto, err := prov.ConsultarPago(ctx, *remotoID)
	if err != nil {
		return Resultado{}, fallo(err.Error())
	}
	if remoto == nil {
		return Resultado{}, fallo("Mercado Pago no reconoce ese pago.")
	}
	r, err := s.Acreditar(ctx, pagoID, remoto)
	if err != nil {
		return Resultado{}, fallo(err.Error())
	}
	if r.Cambio {
		bitacora.Anotar(ctx, sqlc.New(s.pool), s.log, ses, sqlc.AccionAuditoriaCambiarEstado, "pago", pagoID,
			"Reconsultó un cobro a Mercado Pago y quedó "+r.Estado, nil)
		return Resultado{Ok: "Actualizado: el cobro quedó " + r.Estado + ".", Trabajo: r.Trabajo}, nil
	}
	return Resultado{Ok: "Sin cambios: sigue " + r.Estado + "."}, nil
}

// GuardarDatosBancarios: una sola fila, editable.
func (s *Servicio) GuardarDatosBancarios(ctx context.Context, ses *auth.Sesion, m map[string]any) (Resultado, error) {
	if c, ok := m["cbu"].(string); ok {
		m["cbu"] = strings.Join(strings.FieldsFunc(c, zodjs.EspacioJS), "")
	}
	d, e := checkout.LeerDatosBancarios(m)
	if e != nil {
		return Resultado{}, fallo(e.Mensaje)
	}
	_, id, err := s.datosBancarios(ctx)
	if err != nil {
		return Resultado{}, err
	}
	if id != nil {
		_, err = s.pool.Exec(ctx, `
			UPDATE datos_bancarios SET banco = $2, titular = $3, cuit = $4, cbu = $5, alias = $6, instrucciones = $7, updated_at = now()
			WHERE id = $1`, *id, d.Banco, d.Titular, d.Cuit, d.Cbu, d.Alias, d.Instrucciones)
	} else {
		_, err = s.pool.Exec(ctx, `
			INSERT INTO datos_bancarios (banco, titular, cuit, cbu, alias, instrucciones) VALUES ($1, $2, $3, $4, $5, $6)`,
			d.Banco, d.Titular, d.Cuit, d.Cbu, d.Alias, d.Instrucciones)
	}
	if err != nil {
		return Resultado{}, err
	}
	bitacora.Anotar(ctx, sqlc.New(s.pool), s.log, ses, sqlc.AccionAuditoriaEditar, "configuracion", "", "Cambió los datos bancarios para transferencias", nil)
	return Resultado{Ok: "Datos bancarios guardados."}, nil
}
