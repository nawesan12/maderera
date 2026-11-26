package pedidos

import (
	"context"
	"errors"
	"math"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/autorizacion"
	"mjbj/internal/bitacora"
	"mjbj/internal/cobros"
	"mjbj/internal/cola"
	"mjbj/internal/entregas"
	"mjbj/internal/formato"
	"mjbj/internal/jsmath"
	"mjbj/internal/numeracion"
	"mjbj/internal/plataforma"
	"mjbj/internal/precios"
	"mjbj/internal/reservas"
	"mjbj/internal/roles"
	"mjbj/internal/sqlc"
	"mjbj/internal/ventas"
	"mjbj/internal/ventas/fragmentos"
)

// Las acciones de app/admin/ventas-actions.ts. Los avisos al cliente
// (WhatsApp y correo al avanzar) quedan en la cola en la misma transacción
// (pedido.estado, los manda el worker); las revalidaciones siguen en la
// acción de Next.

// TrabajoCambioDeEstado es el aviso de un pedido que avanzó.
const TrabajoCambioDeEstado = "pedido.estado"

// TrabajoPresupuestoEnviado es el aviso de un presupuesto armado: el
// correo con el detalle y el WhatsApp con el PDF (presupuesto_listo).
const TrabajoPresupuestoEnviado = "presupuesto.enviado"

// EncolarPresupuestoEnviado deja el aviso del presupuesto armado en la
// cola, dentro de la transacción de quien lo pasa a «enviado».
func EncolarPresupuestoEnviado(ctx context.Context, tx pgx.Tx, quoteID string) error {
	_, err := cola.Encolar(ctx, sqlc.New(tx), TrabajoPresupuestoEnviado, map[string]string{"quoteId": quoteID}, time.Time{})
	return err
}

// Resultado es lo que contesta una acción: el mensaje y, según cuál, el
// estado al que llegó el pedido y su número.
type Resultado struct {
	Ok     string `json:"ok"`
	ID     string `json:"id,omitempty"`
	Numero string `json:"numero,omitempty"`
	Estado string `json:"estado,omitempty"`
}

// NotaEntregadoSinCobrar encabeza la nota del historial de un pedido que se
// entregó con algo sin cobrar.
const NotaEntregadoSinCobrar = fragmentos.NotaEntregadoSinCobrar

// OrdenDelPedido es el recorrido, fijo y de una sola dirección.
var OrdenDelPedido = []string{"pendiente", "preparando", "listo", "en-camino", "entregado"}

var textoDelEstado = map[string]string{
	"preparando": "en preparación",
	"listo":      "listo para retirar",
	"en-camino":  "en camino",
	"entregado":  "entregado",
}

// nombreDelEstado es el estado como se lee en el aviso de un 409.
func nombreDelEstado(e string) string {
	switch e {
	case "pendiente":
		return "pendiente"
	case "cancelado":
		return "cancelado"
	}
	if t := textoDelEstado[e]; t != "" {
		return t
	}
	return e
}

func (s *Servicio) enTransaccion(ctx context.Context, f func(pgx.Tx) error) error {
	return plataforma.EnTransaccion(ctx, s.pool, f)
}

func (s *Servicio) anotar(ctx context.Context, ses *auth.Sesion, accion bitacora.Accion, entidad, id, descripcion string, detalle any) {
	bitacora.Anotar(ctx, s.q, s.log, ses, accion, entidad, id, descripcion, detalle)
}

type filaDePedido struct {
	numero, estado, tipoEntrega, estadoPago, total, origen string
	medioPago, customerID                                  *string
}

// bloquearPedido lee el pedido y bloquea su fila hasta el final de la
// transacción: es lo que ordena dos acciones sobre el mismo pedido.
func bloquearPedido(ctx context.Context, tx pgx.Tx, id string) (*filaDePedido, error) {
	var p filaDePedido
	err := tx.QueryRow(ctx, `
		SELECT numero, estado::text, tipo_entrega::text, estado_pago::text, total::text, origen::text, medio_pago::text, customer_id
		FROM orders WHERE id = $1 FOR UPDATE`, id).Scan(&p.numero, &p.estado, &p.tipoEntrega, &p.estadoPago, &p.total, &p.origen, &p.medioPago, &p.customerID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, noEsta("No se encontró el pedido.")
	}
	return &p, err
}

// Avanzar lleva el pedido al estado siguiente. Uno de retiro pasa de
// «listo» a «entregado»; uno con envío, a «en camino». No se vuelve atrás:
// para deshacer se cancela, que deja rastro.
//
// **Arreglado** (auditoría del 30/10): pasar a «entregado» no sacaba nada del
// depósito; el físico no bajaba y la reserva quedaba activa para siempre.
// Ahora, si queda saldo, sale con un remito por todo lo pendiente
// (entregas.RemitoPorLoQueQueda): con su número, su movimiento, el consumo de
// la reserva y el enlace para firmar. Se eligió eso y no rechazar porque
// «Avanzar» es el camino normal del tablero para los pedidos de la tienda, y
// porque la regla del depósito es que **cada salida tiene su remito**: así
// la tiene, y se puede anular como cualquier otro.
//
// desde es el estado que vio quien tocó el botón (vacío: no se controla). Si
// el pedido ya cambió —otro depositero, el tablero abierto hace un minuto—,
// se avanzaría un paso que nadie pidió: de «preparando» a «entregado» con
// remito, baja del físico y un WhatsApp al cliente. Con la fila bloqueada se
// compara y, si no coincide, 409.
//
// Un retiro que pasa a «entregado» con saldo emite el remito con quien
// retira: el documento es obligatorio, como en el remito a mano (la firma
// sola no identifica a nadie), y sin él es un 422 en `receptorDocumento`.
// En un envío no se pide nada.
func (s *Servicio) Avanzar(ctx context.Context, ses *auth.Sesion, id, desde string, quien entregas.Receptor) (*Resultado, error) {
	var p *filaDePedido
	var siguiente string
	var remito *entregas.EntregaCreada
	err := s.enTransaccion(ctx, func(tx pgx.Tx) error {
		// La serie de remitos antes que la fila del pedido: el mismo orden
		// que preparar un remito, por si este avance tiene que emitir uno.
		if err := numeracion.BloquearRemitos(ctx, tx); err != nil {
			return err
		}
		var err error
		if p, err = bloquearPedido(ctx, tx, id); err != nil {
			return err
		}
		if desde != "" && desde != p.estado {
			return yaCambio(p.numero + " ya estaba " + nombreDelEstado(p.estado) + ": se actualizó la lista.")
		}
		switch p.estado {
		case "entregado":
			return fallo("El pedido ya está entregado.")
		case "cancelado":
			return fallo("El pedido está cancelado.")
		}
		posicion := -1
		for i, e := range OrdenDelPedido {
			if e == p.estado {
				posicion = i
			}
		}
		if posicion+1 < len(OrdenDelPedido) {
			siguiente = OrdenDelPedido[posicion+1]
		}
		if p.estado == "listo" && p.tipoEntrega == "retiro" {
			siguiente = "entregado"
		}
		if siguiente == "" {
			return fallo("No hay un estado siguiente.")
		}
		if siguiente == "entregado" {
			var sucursal *string
			if err := tx.QueryRow(ctx, `SELECT branch_id FROM orders WHERE id = $1`, id).Scan(&sucursal); err != nil {
				return err
			}
			usuario := ses.UserID
			if remito, err = entregas.RemitoPorLoQueQueda(ctx, tx, id, sucursal, p.tipoEntrega, &usuario, quien); err != nil {
				return err
			}
		}
		// Entregar sin cobrar se puede (existe el pago contra entrega), pero
		// deja firma: la pantalla pregunta y el historial guarda cuánto
		// faltaba y quién soltó la mercadería. Si no, «Entregar igual» se
		// toca sin leer y nadie sabe después quién entregó.
		var nota *string
		if siguiente == "entregado" {
			var falta *float64
			if err := tx.QueryRow(ctx, `SELECT `+fragmentos.SinCobrarDelPedido+`::float8 FROM orders o WHERE o.id = $1`, id).Scan(&falta); err != nil {
				return err
			}
			if falta != nil && *falta > 0.009 {
				n := NotaEntregadoSinCobrar + " · " + formato.Moneda(*falta)
				nota = &n
			}
		}
		if _, err := tx.Exec(ctx, `UPDATE orders SET estado = $2, updated_at = now() WHERE id = $1`, id, siguiente); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO order_status_history (order_id, estado, nota, created_by_user_id) VALUES ($1, $2, $3, $4)`,
			id, siguiente, nota, ses.UserID); err != nil {
			return err
		}
		_, err = cola.Encolar(ctx, sqlc.New(tx), TrabajoCambioDeEstado, map[string]string{"orderId": id, "estado": siguiente}, time.Time{})
		return err
	})
	if err != nil {
		return nil, err
	}
	s.anotar(ctx, ses, sqlc.AccionAuditoriaCambiarEstado, "pedido", id, p.numero+": "+p.estado+" → "+siguiente, nil)
	texto := textoDelEstado[siguiente]
	if texto == "" {
		texto = siguiente
	}
	ok := p.numero + " quedó " + texto + "."
	if remito != nil {
		ok = p.numero + " quedó " + texto + ": la mercadería salió con el remito " + remito.Numero + ", que queda para firmar."
	}
	return &Resultado{Ok: ok, Numero: p.numero, Estado: siguiente}, nil
}

// Cancelar cancela el pedido y libera lo reservado (el físico no se toca:
// nunca salió del galpón). Un pedido ya cancelado no se cancela de nuevo, y
// uno con remitos vigentes tampoco: lo que salió vuelve anulando el remito.
//
// Si el pedido cargó deuda en la cuenta corriente (la compra a cuenta de la
// tienda), la cancelación la devuelve con una nota de crédito, una sola vez:
// antes el pedido quedaba cancelado y la deuda seguía en la cuenta. Una
// venta del mostrador no se cancela acá: se anula desde el mostrador, que
// además devuelve el stock que salió y el efectivo de la caja.
func (s *Servicio) Cancelar(ctx context.Context, ses *auth.Sesion, id string, motivo *string) (*Resultado, error) {
	devuelto := 0.0
	err := s.enTransaccion(ctx, func(tx pgx.Tx) error {
		p, err := bloquearPedido(ctx, tx, id)
		if err != nil {
			return err
		}
		if p.estado == "cancelado" {
			return fallo("El pedido ya está cancelado.")
		}
		if p.origen == "mostrador" {
			return fallo("Es una venta del mostrador: anulala desde el mostrador, que devuelve el stock, el efectivo de la caja y la deuda.")
		}
		// Si ya salió mercadería, cancelar devolvía la deuda y liberaba
		// reservas que ya no estaban, pero el físico quedaba afuera. Primero
		// se anulan los remitos, que la devuelven al depósito.
		var remitos []string
		if err := tx.QueryRow(ctx, `
			SELECT coalesce(array_agg(numero ORDER BY numero), '{}') FROM deliveries
			WHERE order_id = $1 AND estado <> 'anulada'`, id).Scan(&remitos); err != nil {
			return err
		}
		if len(remitos) > 0 {
			return fallo("Ya salió mercadería con el remito " + strings.Join(remitos, ", ") +
				": anulalo en la ficha del pedido, así vuelve al depósito, y después cancelá.")
		}
		// Lo mismo con la plata (revisión de T3): desde que todo cobro del
		// pedido sale con recibo, cancelarlo con el recibo vivo dejaba la plata
		// en el arqueo imputada a un pedido cancelado, sin saldo a favor ni
		// devolución, y retirarla después no decía a quién se le devolvió.
		// Primero se anula el recibo y se devuelve la plata; recién ahí se
		// cancela. Así el depósito, que abre Pedidos, tampoco cancela un
		// pedido cobrado.
		//
		// También los recibos que cobraron su factura desde Facturación
		// (fragmentos.RecibosDelPedido). El recibo al que una devolución ya le
		// reintegró plata no se puede anular (cobros.AnularRecibo): lo que
		// queda vuelve con otra devolución desde la factura, y el mensaje lo
		// dice para que nadie quede trabado.
		var recibos []string
		var conReintegro bool
		if err := tx.QueryRow(ctx, `
			SELECT coalesce(array_agg(numero ORDER BY numero), '{}'),
			       coalesce(bool_or(EXISTS (SELECT 1 FROM receipt_refunds t WHERE t.receipt_id = r.id)), false)
			FROM receipts r
			WHERE r.id IN `+fragmentos.RecibosDelPedido("$1::uuid")+` AND r.estado = 'emitido'`, id).Scan(&recibos, &conReintegro); err != nil {
			return err
		}
		if len(recibos) > 0 && conReintegro {
			return fallo("Ya se cobró con el recibo " + strings.Join(recibos, ", ") +
				" y una devolución ya le reintegró una parte: devolvé lo que queda desde la factura.")
		}
		if len(recibos) > 0 {
			return fallo("Ya se cobró con el recibo " + strings.Join(recibos, ", ") +
				": primero hay que anularlo y devolver la plata.")
		}
		// Y con el pago en línea (comité final, M2): el pedido pagado en el
		// sitio no tiene recibo, así que el freno de arriba no lo veía, y el
		// depósito lo cancelaba con la plata del cliente adentro y sin nadie
		// que se la devuelva. Primero el reintegro (Mercado Pago o la
		// transferencia de vuelta); y aun reintegrado, lo cancela solo quien
		// maneja la plata.
		//
		// Una transferencia informada que nadie verificó (en_revision) frena
		// igual (revisión del carril E): si el depósito cancelaba y después
		// administración la aprobaba, quedaba plata cobrada de un pedido
		// cancelado, sin recibo ni reintegro. Primero se resuelve el pago.
		var pagado, sinDevolver, enRevision float64
		if err := tx.QueryRow(ctx, `
			SELECT coalesce(sum(p.monto) FILTER (WHERE p.estado IN ('aprobado', 'reintegrado')), 0)::float8,
			       coalesce(sum(p.monto - coalesce((SELECT sum(t.importe) FROM payment_refunds t WHERE t.payment_id = p.id), 0))
			                FILTER (WHERE p.estado = 'aprobado'), 0)::float8,
			       coalesce(sum(p.monto) FILTER (WHERE p.estado = 'en_revision'), 0)::float8
			FROM payments p WHERE p.order_id = $1 AND p.estado IN ('aprobado', 'reintegrado', 'en_revision')`, id).
			Scan(&pagado, &sinDevolver, &enRevision); err != nil {
			return err
		}
		if pagado+enRevision > 0.005 && !manejaPlata(ses) {
			return plataforma.NuevoProblema(http.StatusForbidden, "El pedido se pagó en línea: lo cancela administración o un vendedor.")
		}
		if enRevision > 0.005 {
			return fallo("El pedido tiene una transferencia de " + formato.Moneda(enRevision) + " en revisión: primero resolvé el pago.")
		}
		if sinDevolver > 0.005 {
			return fallo("El pedido tiene un pago aprobado de " + formato.Moneda(sinDevolver) + ": primero devolvé el pago.")
		}
		if p.customerID != nil {
			if devuelto, err = devolverDeuda(ctx, tx, *p.customerID, p.numero, motivo, ses.UserID); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, `UPDATE orders SET estado = 'cancelado', updated_at = now() WHERE id = $1`, id); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO order_status_history (order_id, estado, nota, created_by_user_id) VALUES ($1, 'cancelado', $2, $3)`,
			id, motivo, ses.UserID); err != nil {
			return err
		}
		return reservas.LiberarReservas(ctx, tx, id)
	})
	if err != nil {
		return nil, err
	}
	desc := "Canceló el pedido"
	if motivo != nil && *motivo != "" {
		desc += ": " + *motivo
	}
	s.anotar(ctx, ses, sqlc.AccionAuditoriaAnular, "pedido", id, desc, nil)
	ok := "Pedido cancelado. La mercadería reservada quedó disponible."
	if devuelto > 0 {
		ok = "Pedido cancelado. La mercadería reservada quedó disponible y la deuda del pedido salió de la cuenta corriente."
	}
	return &Resultado{Ok: ok, Estado: "cancelado"}, nil
}

// devolverDeuda revierte lo que el pedido cargó en la cuenta corriente del
// cliente (los movimientos «compra» con el número del pedido como
// referencia, que es como los asienta el checkout) menos lo que ya se
// devolvió por una cancelación anterior: así se devuelve una sola vez aunque
// el pedido se cancele dos veces. Devuelve cuánto devolvió.
// manejaPlata: el rol de la sesión está en roles.ManejanPlata.
func manejaPlata(ses *auth.Sesion) bool {
	return ses != nil && ses.RolStaff != nil && slices.Contains(roles.ManejanPlata, *ses.RolStaff)
}

func devolverDeuda(ctx context.Context, tx pgx.Tx, cliente, numero string, motivo *string, usuario string) (float64, error) {
	var pendiente jsmath.Num
	if err := tx.QueryRow(ctx, `
		SELECT coalesce(sum(monto), 0) FROM account_movements
		WHERE customer_id = $1 AND referencia = $2
		  AND (tipo = 'compra' OR (tipo = 'nota_credito' AND detalle LIKE 'Cancelación del pedido %'))`, cliente, numero).Scan(&pendiente); err != nil {
		return 0, err
	}
	monto := pendiente.F()
	if jsmath.Fijo2(monto) == "0.00" || monto < 0 {
		return 0, nil
	}
	detalle := "Cancelación del pedido " + numero
	if motivo != nil && *motivo != "" {
		detalle += ": " + *motivo
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO account_movements (customer_id, tipo, monto, detalle, referencia, created_by_user_id)
		VALUES ($1, 'nota_credito', $2::numeric, $3, $4, $5)`, cliente, jsmath.Fijo2(-monto), detalle, numero, usuario)
	return monto, err
}

// EstadosDePresupuesto son los del enum estado_presupuesto.
var EstadosDePresupuesto = []string{"pendiente", "revision", "enviado", "aceptado", "rechazado", "vencido"}

// CambiarEstadoPresupuesto acepta, rechaza o mueve un presupuesto.
func (s *Servicio) CambiarEstadoPresupuesto(ctx context.Context, ses *auth.Sesion, id, estado string) (*Resultado, error) {
	valido := false
	for _, e := range EstadosDePresupuesto {
		valido = valido || e == estado
	}
	if !valido {
		return nil, fallo("Ese estado no existe.")
	}
	// El estado anterior, con la fila bloqueada: el aviso al cliente sale
	// solo cuando el presupuesto llega a «enviado» desde otro estado, y dos
	// clics seguidos en «enviado» dan un solo aviso (el segundo espera al
	// primero y ya lo encuentra enviado).
	err := s.enTransaccion(ctx, func(tx pgx.Tx) error {
		var anterior string
		err := tx.QueryRow(ctx, `SELECT estado::text FROM quotes WHERE id = $1 FOR UPDATE`, id).Scan(&anterior)
		// El TS contestaba «actualizado» aunque el presupuesto no existiera.
		if errors.Is(err, pgx.ErrNoRows) {
			return noEsta("No se encontró el presupuesto.")
		}
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE quotes SET estado = $2, updated_at = now() WHERE id = $1`, id, estado); err != nil {
			return err
		}
		if estado == "enviado" && anterior != "enviado" {
			return EncolarPresupuestoEnviado(ctx, tx, id)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	s.anotar(ctx, ses, sqlc.AccionAuditoriaCambiarEstado, "presupuesto", id, "Pasó el presupuesto a "+estado, nil)
	return &Resultado{Ok: "Presupuesto actualizado.", Estado: estado}, nil
}

// ConvertirEnPedido pasa un presupuesto a pedido: copia las líneas con el
// precio que tenían (el cliente aceptó ese número), congela el costo del
// momento, lee del producto cuánto stock mueve cada línea y reserva la
// mercadería. La fila del presupuesto queda bloqueada mientras tanto: la
// misma conversión dos veces a la vez da un solo pedido (en el TS daba dos,
// con la mercadería reservada dos veces).
func (s *Servicio) ConvertirEnPedido(ctx context.Context, ses *auth.Sesion, quoteID string) (*Resultado, error) {
	return s.ConvertirConEntrega(ctx, ses, quoteID, Entrega{})
}

// Entrega es cómo sale el pedido que nace de un presupuesto. Vacía es retiro
// en el local sin medio de pago, como era antes: el pedido telefónico
// quedaba como «retiro» aunque fuera con envío, y sin dirección.
type Entrega struct {
	Envio      bool
	Direccion  string
	Zona       string
	CostoEnvio float64
	MedioPago  *string
	// EntregarEl es el día comprometido (AAAA-MM-DD). Vacío: el «para
	// cuándo» del presupuesto, si lo tenía.
	EntregarEl string
	// Precios, para un presupuesto vencido: «actualizar» (los de lista de
	// hoy) o «respetar» (los del presupuesto; pasado lo libre, con el PIN de
	// un admin). Vacío en uno vigente.
	Precios    string
	PIN, Ficha string
}

func (e Entrega) revisar() error {
	if e.MedioPago != nil && !medioValido(*e.MedioPago) {
		return fallo("Ese medio de pago no existe.")
	}
	if e.Precios != "" && e.Precios != "actualizar" && e.Precios != "respetar" {
		return fallo("Elegí si se actualizan los precios o se respetan.")
	}
	if !e.Envio {
		return nil
	}
	if strings.TrimSpace(e.Direccion) == "" {
		return fallo("Falta la dirección de entrega.")
	}
	if e.CostoEnvio < 0 || math.IsNaN(e.CostoEnvio) || math.IsInf(e.CostoEnvio, 0) {
		return fallo("El costo del envío no puede ser negativo.")
	}
	return nil
}

func medioValido(m string) bool {
	switch m {
	case "efectivo", "transferencia", "debito", "credito", "mercado_pago", "cuenta_corriente":
		return true
	}
	return false
}

// ConvertirConEntrega es ConvertirEnPedido diciendo cómo se entrega y cómo
// paga. El costo del envío se suma al total del pedido, como en el checkout.
func (s *Servicio) ConvertirConEntrega(ctx context.Context, ses *auth.Sesion, quoteID string, ent Entrega) (*Resultado, error) {
	if err := ent.revisar(); err != nil {
		return nil, err
	}
	tipo, costo := "retiro", "0"
	var direccion, zona *string
	if ent.Envio {
		tipo = "envio"
		d := strings.TrimSpace(ent.Direccion)
		direccion = &d
		if z := strings.TrimSpace(ent.Zona); z != "" {
			zona = &z
		}
		costo = jsmath.Fijo2(ent.CostoEnvio)
	}
	var entregarEl *time.Time
	if ent.EntregarEl != "" {
		d, err := time.Parse("2006-01-02", ent.EntregarEl)
		if err != nil {
			return nil, fallo("Revisá el día de entrega.")
		}
		entregarEl = &d
	}
	var numero, pedidoID, numeroPresupuesto, quienAutorizo string
	var autorizadoPor *string
	var dejado float64
	err := s.enTransaccion(ctx, func(tx pgx.Tx) error {
		var q struct {
			customerID, email, telefono, branchID, notas, sellerID *string
			nombre, subtotal, total, estado                        string
			validoHasta                                            *time.Time
			// Quien lo emitió, si es un admin: sus precios ya son su firma.
			adminID, adminNombre *string
		}
		err := tx.QueryRow(ctx, `
			SELECT q.numero, q.customer_id, q.contacto_nombre, q.contacto_email, q.contacto_telefono, q.branch_id, q.subtotal::text, q.total::text,
			       q.notas, q.seller_id, q.estado::text, q.valido_hasta, u.id, u.name
			FROM quotes q
			LEFT JOIN profiles p ON p.user_id = q.created_by_user_id AND p.role = 'staff' AND p.staff_role = 'admin'
			LEFT JOIN "user" u ON u.id = p.user_id
			WHERE q.id = $1 FOR UPDATE OF q`, quoteID).Scan(&numeroPresupuesto, &q.customerID, &q.nombre, &q.email, &q.telefono,
			&q.branchID, &q.subtotal, &q.total, &q.notas, &q.sellerID, &q.estado, &q.validoHasta, &q.adminID, &q.adminNombre)
		if errors.Is(err, pgx.ErrNoRows) {
			return noEsta("No se encontró el presupuesto.")
		}
		if err != nil {
			return err
		}
		var ya string
		err = tx.QueryRow(ctx, `SELECT numero FROM orders WHERE quote_id = $1 LIMIT 1`, quoteID).Scan(&ya)
		if err == nil {
			return fallo("Ya se convirtió en el pedido " + ya + ".")
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}

		type linea struct {
			variantID, presentacion, listaAlEmitir      *string
			descripcion, unidad, cantidad, precio, subt string
			orden                                       int
		}
		filas, err := tx.Query(ctx, `
			SELECT variant_id, presentacion, descripcion, unidad, cantidad::text, precio_unitario::text, subtotal::text, orden, precio_lista::text
			FROM quote_items WHERE quote_id = $1 ORDER BY orden, id`, quoteID)
		if err != nil {
			return err
		}
		var lineas []linea
		for filas.Next() {
			var l linea
			if err := filas.Scan(&l.variantID, &l.presentacion, &l.descripcion, &l.unidad, &l.cantidad, &l.precio, &l.subt, &l.orden, &l.listaAlEmitir); err != nil {
				filas.Close()
				return err
			}
			lineas = append(lineas, l)
		}
		filas.Close()
		if err := filas.Err(); err != nil {
			return err
		}
		if len(lineas) == 0 {
			return fallo("El presupuesto está vacío: no tiene ningún producto.")
		}
		if q.estado == "rechazado" {
			return fallo("El presupuesto está rechazado: no se pasa a pedido.")
		}

		// Los precios de lista de hoy, para cada renglón con variante (T3,
		// hallazgo 12). Un presupuesto «enviado» en marzo se convertía en
		// noviembre con los precios de marzo, con un clic.
		renglones := make([]ventas.LineaDeVenta, len(lineas))
		conVariante := make([]precios.RenglonConVariante, len(lineas))
		for i, l := range lineas {
			renglones[i] = ventas.LineaDeVenta{VariantID: l.variantID, Cantidad: jsmath.Numero(l.cantidad), PrecioUnitario: jsmath.Numero(l.precio), Presentacion: l.presentacion}
			conVariante[i] = precios.RenglonConVariante{VariantID: l.variantID, Presentacion: l.presentacion}
		}
		lista, err := precios.ListaDelCliente(ctx, tx, q.customerID)
		if err != nil {
			return err
		}
		listas, err := precios.PreciosDeLista(ctx, tx, conVariante, lista)
		if err != nil {
			return err
		}
		for i := range renglones {
			renglones[i].PrecioLista = listas[i]
		}
		// Lo que se deja de cobrar se mide siempre (T3, revisión): antes solo
		// con el presupuesto vencido, y armar un presupuesto al 40 % abajo en
		// el mostrador y pasarlo a pedido en el acto era el atajo para no
		// llamar al admin. Uno vigente se mide contra la lista del día en que
		// se emitió (la que prometió el precio); uno sin esa lista guardada
		// (anterior a la 00142, o de la tienda), contra la de hoy.
		vencido := PresupuestoVencido(q.estado, q.validoHasta, s.ahora())
		motivo := autorizacion.Precio
		if vencido {
			switch ent.Precios {
			case "actualizar":
				// Cada renglón con lista vuelve al precio de hoy; el subtotal y
				// el total se rehacen (lo que había entre los dos, el envío del
				// presupuesto, se conserva).
				nuevo := 0.0
				for i := range lineas {
					if listas[i] != nil {
						renglones[i].PrecioUnitario = *listas[i]
						lineas[i].precio = jsmath.Fijo2(*listas[i])
						lineas[i].subt = jsmath.Fijo2(ventas.ACentavos(float64(renglones[i].Cantidad * *listas[i])))
					}
					nuevo += jsmath.Numero(lineas[i].subt)
				}
				extra := jsmath.Numero(q.total) - jsmath.Numero(q.subtotal)
				q.subtotal = jsmath.Fijo2(ventas.ACentavos(nuevo))
				q.total = jsmath.Fijo2(ventas.ACentavos(nuevo + extra))
			case "respetar":
				motivo = autorizacion.Presupuesto
			default:
				return plataforma.Invalido(map[string]string{"precios": "El presupuesto venció: elegí si se actualizan los precios o se respetan."})
			}
		} else {
			for i := range lineas {
				if lineas[i].listaAlEmitir != nil && renglones[i].VariantID != nil {
					v := jsmath.Numero(*lineas[i].listaAlEmitir)
					renglones[i].PrecioLista = &v
				}
			}
		}
		d := ventas.DesvioDeLaVenta(renglones, 0, 0)
		libre, err := precios.PorcentajeLibre(ctx, tx)
		if err != nil {
			return err
		}
		switch {
		case d.DentroDeLoLibre(libre):
			// La misma regla y el mismo umbral que el mostrador: una
			// diferencia de diez pesos no llama al admin.
		case !vencido && q.adminID != nil:
			// Lo emitió un admin con esos precios: ya firmó él.
			autorizadoPor, quienAutorizo = q.adminID, *q.adminNombre
		default:
			sucursal := ""
			if q.branchID != nil {
				sucursal = *q.branchID
			}
			firma, err := s.aut.Exigir(ctx, ses, autorizacion.Pedido{Motivo: motivo, Monto: d.Total,
				Clave: quoteID, Sucursal: sucursal, PIN: ent.PIN, Ficha: ent.Ficha})
			var falta *autorizacion.Falta
			if errors.As(err, &falta) {
				return faltaDePIN(falta)
			}
			if err != nil {
				return err
			}
			autorizadoPor = &firma.UserID
			quienAutorizo = firma.Nombre
		}
		dejado = ventas.DesvioDeLaVenta(renglones, 0, 0).Total

		aCuenta := ent.MedioPago != nil && *ent.MedioPago == "cuenta_corriente"
		totalPedido := jsmath.Numero(q.total) + jsmath.Numero(costo)
		if aCuenta {
			if q.customerID == nil {
				return fallo("A cuenta corriente solo con un cliente cargado: elegilo en el presupuesto.")
			}
			motivo, err := cobros.LimiteEnLaTransaccion(ctx, tx, *q.customerID, totalPedido)
			if err != nil {
				return err
			}
			if motivo != "" {
				return fallo(motivo)
			}
		}

		if numero, err = numeracion.Pedido(ctx, tx); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `
			INSERT INTO orders (numero, customer_id, quote_id, contacto_nombre, contacto_email, contacto_telefono, branch_id,
			                    estado, origen, subtotal, total, notas, seller_id, created_by_user_id,
			                    tipo_entrega, direccion_entrega, zona_envio, costo_envio, medio_pago, entregar_el,
			                    dejado_de_cobrar, autorizado_por)
			VALUES ($1, $2, $3, $4, $5, $6, $7, 'pendiente', 'presupuesto', $8::numeric, $9::numeric + $14::numeric, $10, $11, $12,
			        $13::tipo_entrega, $15, $16, $14::numeric, $17::medio_pago,
			        coalesce($18::date, (SELECT (necesita_para AT TIME ZONE 'America/Argentina/Buenos_Aires')::date FROM quotes WHERE id = $3)),
			        $19::numeric, $20)
			RETURNING id`, numero, q.customerID, quoteID, q.nombre, q.email, q.telefono, q.branchID, q.subtotal, q.total, q.notas,
			q.sellerID, ses.UserID, tipo, costo, direccion, zona, ent.MedioPago, entregarEl, jsmath.Fijo2(dejado), autorizadoPor).Scan(&pedidoID); err != nil {
			return err
		}

		var variantes []string
		conPresentacion := make([]reservas.LineaConPresentacion, len(lineas))
		for i, l := range lineas {
			if l.variantID != nil {
				variantes = append(variantes, *l.variantID)
			}
			conPresentacion[i] = reservas.LineaConPresentacion{VariantID: l.variantID, Presentacion: l.presentacion}
		}
		costos, err := reservas.CostosParaCongelar(ctx, tx, variantes)
		if err != nil {
			return err
		}
		factores, err := reservas.FactoresDeStock(ctx, tx, conPresentacion)
		if errors.Is(err, ventas.ErrSinMedidas) {
			return fallo(err.Error())
		}
		if err != nil {
			return err
		}
		for i, l := range lineas {
			var costo *string
			var alicuota *string
			if l.variantID != nil {
				if c, ok := costos[*l.variantID]; ok {
					costo = c.CostoUnitario
					a := c.AlicuotaIva
					alicuota = &a
				}
			}
			f := factores[i]
			if _, err := tx.Exec(ctx, `
				INSERT INTO order_items (order_id, variant_id, descripcion, unidad, cantidad, precio_unitario, subtotal,
				                         presentacion, stock_por_unidad, costo_unitario, alicuota_iva, orden, precio_lista)
				VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7::numeric, $8, $9::numeric, $10::numeric, $11::numeric, $12, $13::numeric)`,
				pedidoID, l.variantID, l.descripcion, l.unidad, l.cantidad, l.precio, l.subt, f.Presentacion,
				jsmath.Texto(f.StockPorUnidad), reservas.CostoPorUnidadDeVenta(costo, f.StockPorUnidad), alicuota, l.orden, fijo2ONulo(renglones[i].PrecioLista)); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, `INSERT INTO order_status_history (order_id, estado, nota, created_by_user_id) VALUES ($1, 'pendiente', $2, $3)`,
			pedidoID, "Generado desde el presupuesto "+numeroPresupuesto, ses.UserID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE quotes SET estado = 'aceptado', updated_at = now() WHERE id = $1`, quoteID); err != nil {
			return err
		}
		// La deuda, como la asienta el checkout: con el número del pedido
		// de referencia, que es lo que la cancelación busca para devolverla.
		if aCuenta {
			if _, err := tx.Exec(ctx, `
				INSERT INTO account_movements (customer_id, tipo, monto, detalle, referencia, created_by_user_id)
				VALUES ($1, 'compra', $2::numeric, $3, $4, $5)`,
				*q.customerID, jsmath.Fijo2(totalPedido), "Pedido "+numero, numero, ses.UserID); err != nil {
				return err
			}
		}
		// Desde acá la mercadería tiene dueño y deja de estar disponible
		// para el resto, aunque siga en el galpón hasta que la retiren.
		return reservas.ReservarPedido(ctx, tx, pedidoID)
	})
	if err != nil {
		return nil, err
	}
	var detalle any
	desc := "Convirtió el presupuesto " + numeroPresupuesto + " en el pedido " + numero
	switch ent.Precios {
	case "actualizar":
		desc += ", con los precios de hoy"
	case "respetar":
		desc += ", respetando los precios vencidos"
	}
	if quienAutorizo != "" || dejado > 0 {
		detalle = map[string]any{"dejadoDeCobrar": dejado, "autorizadoPor": quienAutorizo, "precios": ent.Precios}
	}
	s.anotar(ctx, ses, sqlc.AccionAuditoriaCrear, "pedido", quoteID, desc, detalle)
	return &Resultado{Ok: "Se creó el pedido " + numero + ".", ID: pedidoID, Numero: numero}, nil
}

// CambiarEntrega corrige el día comprometido de entrega (nil lo borra). Es
// lo que dice si el pedido está atrasado.
func (s *Servicio) CambiarEntrega(ctx context.Context, ses *auth.Sesion, id string, dia *string) (*Resultado, error) {
	var fecha *time.Time
	if dia != nil && *dia != "" {
		d, err := time.Parse("2006-01-02", *dia)
		if err != nil {
			return nil, fallo("Revisá el día de entrega.")
		}
		fecha = &d
	}
	var numero string
	err := s.pool.QueryRow(ctx, `UPDATE orders SET entregar_el = $2, updated_at = now() WHERE id = $1 RETURNING numero`, id, fecha).Scan(&numero)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, noEsta("No se encontró el pedido.")
	}
	if err != nil {
		return nil, err
	}
	texto := "Sacó el día de entrega de " + numero
	if fecha != nil {
		texto = "Comprometió la entrega de " + numero + " para el " + fecha.Format("02/01/2006")
	}
	s.anotar(ctx, ses, sqlc.AccionAuditoriaEditar, "pedido", id, texto, nil)
	return &Resultado{Ok: "Día de entrega guardado."}, nil
}

// PresupuestoVencido: «vencido» o con la validez pasada (en el día
// argentino). Uno aceptado o ya convertido no vence.
func PresupuestoVencido(estado string, validoHasta *time.Time, ahora time.Time) bool {
	if estado == "vencido" {
		return true
	}
	if validoHasta == nil || estado == "aceptado" {
		return false
	}
	a := ahora.In(argentina)
	hoy := time.Date(a.Year(), a.Month(), a.Day(), 0, 0, 0, 0, argentina)
	return validoHasta.Before(hoy)
}

// faltaDePIN es el 422 con lo que la pantalla necesita para pedir el PIN.
func faltaDePIN(f *autorizacion.Falta) error {
	// Todas las claves empiezan con «pin»: el mensaje va primero, que es el
	// que muestra quien no sabe de PIN (mensajeDe toma el primero).
	e := map[string]string{"pin": f.Mensaje(), "pinMonto": jsmath.Fijo2(f.Monto)}
	if f.PinIncorrecto {
		e["pinIncorrecto"] = "si"
	}
	if f.ConClave {
		e["pinConClave"] = "si"
	}
	if f.BloqueadoHasta != nil {
		e["pinHasta"] = f.BloqueadoHasta.UTC().Format(time.RFC3339)
	}
	return plataforma.Invalido(e)
}

func fijo2ONulo(p *float64) *string {
	if p == nil {
		return nil
	}
	s := jsmath.Fijo2(*p)
	return &s
}
