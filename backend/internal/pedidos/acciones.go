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
	"mjbj/internal/reglas"
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

// TrabajoPresupuestoPorCorreo es solo el correo de un presupuesto que ya
// salió (por WhatsApp, por ejemplo): el cliente lo pide también por mail
// (M2S1-098). No vuelve a mandar el WhatsApp ni cambia el estado.
const TrabajoPresupuestoPorCorreo = "presupuesto.correo"

// MotivoPorCorreo es lo que manda «Por correo» de un presupuesto ya enviado.
const MotivoPorCorreo = "por_correo"

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
	// FirmaToken: el enlace de firma del remito que salió al avanzar. En
	// un retiro el cliente está presente: la pantalla va derecho a la firma
	// (mes simulado 2: quedaba «Sin firmar», un paso aparte que se olvidaba).
	FirmaToken string `json:"firmaToken,omitempty"`
}

// NotaEntregadoSinCobrar encabeza la nota del historial de un pedido que se
// entregó con algo sin cobrar.
const NotaEntregadoSinCobrar = fragmentos.NotaEntregadoSinCobrar

// NotaSalioSinCobrar encabeza la del envío que sale sin cobrar con el PIN
// de un admin.
const NotaSalioSinCobrar = "Salió sin cobrar"

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
	var autorizoFuera string
	err := s.enTransaccion(ctx, func(tx pgx.Tx) error {
		autorizoFuera = ""
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
		// Un pedido con su corte en la cola no está listo (mes simulado): se
		// marcaba listo y el depósito lo despachaba sin las piezas.
		if siguiente == "listo" || siguiente == "en-camino" || siguiente == "entregado" {
			if err := entregas.FaltaElCorte(ctx, tx, id); err != nil {
				return err
			}
		}
		// El envío que ya salió en parte no se da por entregado entero: lo
		// que falta llevar sale con su propio remito.
		if siguiente == "entregado" && p.estado == "en-camino" {
			saldo, err := entregas.SaldoDeAcopio(ctx, tx, id)
			if err != nil {
				return err
			}
			if len(entregas.SoloPendientes(saldo)) > 0 {
				return fallo(p.numero + " tiene productos por llevar todavía: preparales el remito.")
			}
		}
		// «Listo» es armado: no se arma lo que no está en el galpón. El
		// tablero ofrecía «Marcar listo» con 135 placas vendidas y 55 en el
		// estante (mes simulado, H218).
		if siguiente == "listo" {
			saldo, err := entregas.SaldoDeAcopio(ctx, tx, id)
			if err != nil {
				return err
			}
			if saldo, err = entregas.ConGalpon(ctx, tx, id, saldo); err != nil {
				return err
			}
			for _, r := range saldo {
				if r.EnElGalpon != nil && r.Pendiente > 0.0005 && *r.EnElGalpon < r.Pendiente {
					return fallo("No alcanza para armarlo: " + r.Descripcion + " lleva " + formato.Cantidad(r.Pendiente) +
						" y en el galpón hay " + formato.Cantidad(math.Max(*r.EnElGalpon, 0)) + ".")
				}
			}
		}
		// El remito sale cuando la mercadería deja el depósito: en un envío,
		// al despachar (acompaña al camión y lo firma quien recibe); en un
		// retiro, al entregar. Antes el envío salía sin papel y el remito
		// nacía al marcarlo entregado.
		// El envío con el flete sin cotizar (M4-077): con la regla en
		// «frena» no sale; si sale, el historial lo dice.
		var fleteSinCotizar bool
		var autorizo string
		if p.tipoEntrega == "envio" && (siguiente == "en-camino" || siguiente == "entregado") {
			if fleteSinCotizar, err = entregas.FleteSinCotizar(ctx, tx, id); err != nil {
				return err
			}
		}
		if siguiente == "entregado" || (siguiente == "en-camino" && p.tipoEntrega == "envio") {
			var sucursal *string
			if err := tx.QueryRow(ctx, `SELECT branch_id FROM orders WHERE id = $1`, id).Scan(&sucursal); err != nil {
				return err
			}
			usuario := ses.UserID
			saldo, err := entregas.SaldoDeAcopio(ctx, tx, id)
			if err != nil {
				return err
			}
			if len(entregas.SoloPendientes(saldo)) > 0 {
				// El documento primero: es lo que se corrige en el lugar.
				if p.tipoEntrega != "envio" {
					if campo, msj := quien.Revisar(); msj != "" {
						return plataforma.Invalido(map[string]string{campo: msj})
					}
				}
				if autorizo, err = entregas.AutorizarSinCobrar(ctx, tx, s.aut, ses, id, quien.SinCobrar); err != nil {
					return err
				}
			}
			if remito, err = entregas.RemitoPorLoQueQueda(ctx, tx, id, sucursal, p.tipoEntrega, &usuario, quien); err != nil {
				return err
			}
			// Sin mercadería, el pedido que solo lleva el corte sale con el
			// remito de sus piezas, con quien retira, para firmar (mes
			// simulado 2: se entregaba sin firma ni constancia).
			if remito == nil && siguiente == "entregado" && p.tipoEntrega != "envio" {
				solo, err := entregas.SoloElCorte(ctx, tx, id)
				if err != nil {
					return err
				}
				if solo {
					if campo, msj := quien.Revisar(); msj != "" {
						return plataforma.Invalido(map[string]string{campo: msj})
					}
					if remito, err = entregas.RemitoDelCorte(ctx, tx, id, sucursal, &usuario, quien); err != nil {
						return err
					}
				}
			}
		}
		// Entregar sin cobrar se puede (existe el pago contra entrega), pero
		// deja firma: la pantalla pregunta y el historial guarda cuánto
		// faltaba y quién soltó la mercadería. Si no, «Entregar igual» se
		// toca sin leer y nadie sabe después quién entregó.
		// El envío que sale sin cobrar lo dice al despachar, con quien lo
		// autorizó (M4-114: el historial no nombraba a nadie).
		var partes []string
		if siguiente == "entregado" || (siguiente == "en-camino" && autorizo != "") {
			var falta *float64
			if err := tx.QueryRow(ctx, `SELECT `+fragmentos.SinCobrarDelPedido+`::float8 FROM orders o WHERE o.id = $1`, id).Scan(&falta); err != nil {
				return err
			}
			if falta != nil && *falta > 0.009 {
				cabeza := NotaEntregadoSinCobrar
				if siguiente == "en-camino" {
					cabeza = NotaSalioSinCobrar
				}
				partes = append(partes, cabeza+" · "+formato.Importe(*falta))
			}
		}
		if autorizo != "" {
			partes = append(partes, "autorizó "+autorizo)
			autorizoFuera = autorizo
		}
		if fleteSinCotizar {
			partes = append(partes, entregas.NotaFleteSinCotizar)
		}
		var nota *string
		if len(partes) > 0 {
			n := strings.Join(partes, " · ")
			nota = &n
		}
		if _, err := tx.Exec(ctx, `UPDATE orders SET estado = $2, updated_at = now() WHERE id = $1`, id, siguiente); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO order_status_history (order_id, estado, nota, created_by_user_id) VALUES ($1, $2, $3, $4)`,
			id, siguiente, nota, ses.UserID); err != nil {
			return err
		}
		if siguiente == "entregado" {
			if err := entregas.CerrarCortes(ctx, tx, id); err != nil {
				return err
			}
		}
		_, err = cola.Encolar(ctx, sqlc.New(tx), TrabajoCambioDeEstado, map[string]string{"orderId": id, "estado": siguiente},
			entregas.CuandoAvisar(siguiente, time.Now()))
		return err
	})
	if err != nil {
		return nil, err
	}
	desc := p.numero + ": " + p.estado + " → " + siguiente
	if autorizoFuera != "" {
		desc += " · sin cobrar, autorizó " + autorizoFuera
	}
	s.anotar(ctx, ses, sqlc.AccionAuditoriaCambiarEstado, "pedido", id, desc, nil)
	texto := textoDelEstado[siguiente]
	if siguiente == "listo" && p.tipoEntrega == "envio" {
		texto = "listo para despachar"
	}
	if texto == "" {
		texto = siguiente
	}
	ok := p.numero + " quedó " + texto + "."
	if remito != nil {
		ok = p.numero + " quedó " + texto + ": la mercadería salió con el remito " + remito.Numero + ", que queda para firmar."
	}
	out := &Resultado{Ok: ok, Numero: p.numero, Estado: siguiente}
	if remito != nil {
		out.FirmaToken = remito.FirmaToken
	}
	return out, nil
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
		// El presupuesto del pedido cancelado (M4-030): con la regla en
		// «se_rechaza» se cierra con el mismo motivo; si no (lo de siempre),
		// vuelve a «aceptado sin pedido» para pasarlo de nuevo.
		if reglas.Es(ctx, tx, reglas.PresupuestoDelPedidoCancelado, "se_rechaza") {
			if _, err := tx.Exec(ctx, `UPDATE quotes q SET estado = 'rechazado', motivo_rechazo = coalesce(nullif(trim($2), ''), 'Se canceló el pedido'), updated_at = now()
				FROM orders o WHERE o.id = $1 AND q.id = o.quote_id AND q.estado = 'aceptado'
				  AND NOT EXISTS (SELECT 1 FROM orders x WHERE x.quote_id = q.id AND x.id <> o.id AND x.estado <> 'cancelado')`, id, motivo); err != nil {
				return err
			}
		}
		return reservas.LiberarReservas(ctx, tx, id)
	})
	if err != nil {
		return nil, err
	}
	var numero string
	_ = s.pool.QueryRow(ctx, `SELECT numero FROM orders WHERE id = $1`, id).Scan(&numero)
	desc := "Canceló " + numero
	if numero == "" {
		desc = "Canceló el pedido"
	}
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
	return s.CambiarEstadoPresupuestoConMotivo(ctx, ses, id, estado, "")
}

// MotivosDeRechazo son los que ofrece la pantalla al rechazar (mes simulado:
// rechazar no pedía motivo y no se sabía por qué se pierden las ventas).
var MotivosDeRechazo = []string{"Precio", "Se lo llevó otro", "No contestó", "Ya no lo necesita", "Otro"}

// mensajeDelEstado es lo que dice el aviso: antes todo era «Presupuesto
// actualizado.», enviar, aceptar o rechazar.
var mensajeDelEstado = map[string]string{
	"enviado":   "Presupuesto enviado al cliente.",
	"aceptado":  "Presupuesto aceptado.",
	"rechazado": "Presupuesto rechazado.",
}

// CambiarEstadoPresupuestoConMotivo es CambiarEstadoPresupuesto con el
// motivo del rechazo (uno de MotivosDeRechazo; vacío al rechazar es «Otro»).
func (s *Servicio) CambiarEstadoPresupuestoConMotivo(ctx context.Context, ses *auth.Sesion, id, estado, motivo string) (*Resultado, error) {
	var motivoRechazo *string
	if estado == "rechazado" {
		m := strings.TrimSpace(motivo)
		if m == "" {
			m = "Otro"
		}
		if !slices.Contains(MotivosDeRechazo, m) {
			return nil, fallo("Elegí por qué se perdió.")
		}
		motivoRechazo = &m
	}
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
	soloCorreo, yaSalio := false, false
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
		// Con un pedido vivo no se rechaza: el cliente ya compró. Con el pedido
		// cancelado, sí (M2S4-066: quedaba «Aceptado» para siempre).
		if estado == "rechazado" {
			var vivo bool
			if err := tx.QueryRow(ctx, `SELECT exists(SELECT 1 FROM orders WHERE quote_id = $1 AND estado <> 'cancelado')`, id).Scan(&vivo); err != nil {
				return err
			}
			if vivo {
				return fallo("Este presupuesto ya es un pedido: cancelá el pedido primero.")
			}
		}
		// «Por correo» de uno que ya salió (por WhatsApp): solo el correo, y
		// el estado queda como estaba. Lo pide el botón (motivo «por_correo»):
		// un segundo clic en «enviado» sigue sin mandar nada. Dos clics en
		// dos minutos, un correo.
		if estado == "enviado" && anterior == "enviado" && motivo == MotivoPorCorreo {
			soloCorreo = true
			var reciente bool
			if err := tx.QueryRow(ctx, `SELECT exists(SELECT 1 FROM trabajos WHERE tipo = $1 AND carga->>'quoteId' = $2
				AND created_at > now() - interval '2 minutes')`, TrabajoPresupuestoPorCorreo, id).Scan(&reciente); err != nil {
				return err
			}
			if reciente {
				yaSalio = true
				return nil
			}
			_, err := cola.Encolar(ctx, sqlc.New(tx), TrabajoPresupuestoPorCorreo, map[string]string{"quoteId": id}, time.Time{})
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE quotes SET estado = $2, motivo_rechazo = $3, updated_at = now() WHERE id = $1`, id, estado, motivoRechazo); err != nil {
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
	// El segundo clic en dos minutos no manda otro: no se le dice que sí
	// (mes 23: decía «Le mandamos el presupuesto por correo»).
	if soloCorreo && yaSalio {
		return &Resultado{Ok: "El correo con el presupuesto ya salió hace un momento.", Estado: estado}, nil
	}
	if soloCorreo {
		s.anotar(ctx, ses, sqlc.AccionAuditoriaEditar, "presupuesto", id, "Mandó el presupuesto por correo", nil)
		return &Resultado{Ok: "Le mandamos el presupuesto por correo.", Estado: estado}, nil
	}
	desc := "Pasó el presupuesto a " + estado
	if motivoRechazo != nil {
		desc += " (" + *motivoRechazo + ")"
	}
	s.anotar(ctx, ses, sqlc.AccionAuditoriaCambiarEstado, "presupuesto", id, desc, nil)
	ok := mensajeDelEstado[estado]
	if ok == "" {
		ok = "Presupuesto actualizado."
	}
	return &Resultado{Ok: ok, Estado: estado}, nil
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
	// ConCosto: se escribió el flete (aunque sea cero). SinCargo: se eligió
	// llevarlo gratis. Un envío sin ninguna de las dos no sale (mes simulado:
	// los pedidos con envío se creaban con el flete vacío y sin aviso).
	ConCosto, SinCargo bool
	MedioPago          *string
	// EntregarEl es el día comprometido (AAAA-MM-DD). Vacío: el «para
	// cuándo» del presupuesto, si lo tenía.
	EntregarEl string
	// Precios, para un presupuesto vencido: «actualizar» (los de lista de
	// hoy) o «respetar» (los del presupuesto; pasado lo libre, con el PIN de
	// un admin). Vacío en uno vigente.
	Precios    string
	PIN, Ficha string
	// Sucursal es el slug de la sucursal de donde sale, si no es la del
	// presupuesto: lo que falta en una y hay en otra (M2S1-089).
	Sucursal string
	// ACuenta es la parte que va a la cuenta corriente de un pedido partido
	// (H047); el resto se paga con MedioPago. Cero: el pedido no se parte.
	ACuenta float64
}

func (e Entrega) revisar() error {
	if e.MedioPago != nil && !medioValido(*e.MedioPago) {
		return fallo("Ese medio de pago no existe.")
	}
	if e.ACuenta < 0 || math.IsNaN(e.ACuenta) || math.IsInf(e.ACuenta, 0) {
		return fallo("Lo que va a cuenta corriente no puede ser negativo.")
	}
	if e.ACuenta > 0 && (e.MedioPago == nil || *e.MedioPago == "cuenta_corriente") {
		return fallo("Elegí cómo paga el resto.")
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

// fleteDeLaZona revisa la zona contra las de envío (una inventada no pasa)
// y, sin flete escrito, propone el de la zona si tiene costo fijo. Un envío
// sin flete y sin «Sin cargo» no sale.
func fleteDeLaZona(ctx context.Context, tx pgx.Tx, ent *Entrega) error {
	if !ent.Envio {
		return nil
	}
	if z := strings.TrimSpace(ent.Zona); z != "" {
		var costo float64
		var aCotizar bool
		err := tx.QueryRow(ctx, `SELECT costo::float8, a_cotizar FROM shipping_zones WHERE activa AND lower(nombre) = lower($1) LIMIT 1`, z).
			Scan(&costo, &aCotizar)
		if errors.Is(err, pgx.ErrNoRows) {
			return fallo("Elegí una zona de la lista.")
		}
		if err != nil {
			return err
		}
		if !ent.ConCosto && !ent.SinCargo && !aCotizar && costo > 0 {
			ent.CostoEnvio, ent.ConCosto = costo, true
		}
	}
	if !ent.ConCosto && !ent.SinCargo {
		return fallo("Falta el flete: cargalo o elegí «Sin cargo».")
	}
	if ent.SinCargo && !ent.ConCosto {
		ent.CostoEnvio = 0
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
	if ent.Envio {
		err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error { return fleteDeLaZona(ctx, tx, &ent) })
		if err != nil {
			return nil, err
		}
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
		if strings.TrimSpace(ent.Sucursal) != "" {
			var otra string
			err := tx.QueryRow(ctx, `SELECT id FROM branches WHERE slug = $1 AND active`, strings.TrimSpace(ent.Sucursal)).Scan(&otra)
			if errors.Is(err, pgx.ErrNoRows) {
				return fallo("Esa sucursal no existe.")
			}
			if err != nil {
				return err
			}
			q.branchID = &otra
		}
		// Un pedido cancelado no traba (mes simulado): el presupuesto vuelve
		// a pasarse a pedido, corregido, sin cargarlo todo de nuevo.
		var ya string
		err = tx.QueryRow(ctx, `SELECT numero FROM orders WHERE quote_id = $1 AND estado <> 'cancelado' LIMIT 1`, quoteID).Scan(&ya)
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
		// El pedido partido (H047): una parte a la cuenta y el resto con el
		// medio elegido. Si la parte cubre el total, es un pedido a cuenta
		// como siempre.
		var partido *string
		if ent.ACuenta > 0 {
			parte := ventas.ACentavos(ent.ACuenta)
			if parte >= totalPedido-0.005 {
				cc := "cuenta_corriente"
				ent.MedioPago = &cc
			} else {
				p := jsmath.Fijo2(parte)
				partido = &p
			}
			aCuenta = true
		}
		// El descuento por forma de pago, como en el mostrador (mes simulado
		// 2, M2S1-080: el presupuesto prometía «10 % en efectivo o
		// transferencia» y el pedido cobraba la lista): sobre lo que se vende
		// del catálogo (con la regla descuento_al_flete, también lo cargado a
		// mano), con el pedido entero por un solo medio. Los renglones quedan
		// a lista y el descuento va al pedido, como el de la tienda.
		var descuento float64
		var motivoDescuento *string
		if ent.MedioPago != nil && !aCuenta {
			esc, err := s.q.WithTx(tx).EscalasDePago(ctx)
			if err != nil {
				return err
			}
			escalas := make([]ventas.EscalaDePago, len(esc))
			for i, f := range esc {
				escalas[i] = ventas.EscalaDePago{Medio: string(f.Medio), DesdeMonto: f.DesdeMonto.F(), Porcentaje: f.Porcentaje.F(), Etiqueta: f.Etiqueta}
			}
			alFlete := reglas.Es(ctx, tx, reglas.DescuentoAlFlete, "si")
			base := 0.0
			for _, l := range lineas {
				if l.variantID != nil || alFlete {
					base += jsmath.Numero(l.subt)
				}
			}
			base = ventas.ACentavos(base)
			if e := ventas.DescuentoPorMedioDePago(escalas, *ent.MedioPago, base); e != nil {
				descuento = ventas.MontoDelDescuentoDePago(base, e.Porcentaje)
				if e.Etiqueta != "" {
					m := e.Etiqueta
					motivoDescuento = &m
				}
				totalPedido = ventas.ACentavos(totalPedido - descuento)
			}
		}
		deuda := totalPedido
		if partido != nil {
			deuda = jsmath.Numero(*partido)
		}
		if aCuenta {
			if q.customerID == nil {
				return fallo("A cuenta corriente solo con un cliente cargado: elegilo en el presupuesto.")
			}
			// El crédito se mira solo sobre lo que va a la cuenta.
			motivo, err := cobros.LimiteEnLaTransaccion(ctx, tx, *q.customerID, deuda)
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
		// Un retiro sin sucursal en el presupuesto se retira en la primera
		// activa, la misma de donde reserva (reservas.sucursalDelPedido): la
		// tarjeta decía «Retira en» sin decir dónde, y el efectivo no sabía a
		// qué caja entrar (mes simulado).
		if err := tx.QueryRow(ctx, `
			INSERT INTO orders (numero, customer_id, quote_id, contacto_nombre, contacto_email, contacto_telefono, branch_id,
			                    estado, origen, subtotal, total, notas, seller_id, created_by_user_id,
			                    tipo_entrega, direccion_entrega, zona_envio, costo_envio, medio_pago, entregar_el,
			                    dejado_de_cobrar, autorizado_por, a_cuenta, flete_sin_cargo)
			VALUES ($1, $2, $3, $4,
			        -- Sin contacto propio, el de la ficha (M4-026: el presupuesto
			        -- del mostrador no avisaba por correo en ningún estado).
			        coalesce(nullif(trim($5), ''), (SELECT nullif(trim(email), '') FROM customers WHERE id = $2::uuid)),
			        coalesce(nullif(trim($6), ''), (SELECT nullif(trim(telefono), '') FROM customers WHERE id = $2::uuid)),
			        CASE WHEN $13::tipo_entrega = 'retiro'
			             THEN coalesce($7::uuid, (SELECT id FROM branches WHERE active ORDER BY sort_order LIMIT 1))
			             ELSE $7::uuid END,
			        'pendiente', 'presupuesto', $8::numeric, $9::numeric + $14::numeric - $22::numeric, $10, $11, $12,
			        $13::tipo_entrega, $15, $16, $14::numeric, $17::medio_pago,
			        coalesce($18::date, (SELECT (necesita_para AT TIME ZONE 'America/Argentina/Buenos_Aires')::date FROM quotes WHERE id = $3)),
			        $19::numeric, $20, $21::numeric, $23)
			RETURNING id`, numero, q.customerID, quoteID, q.nombre, q.email, q.telefono, q.branchID, q.subtotal, q.total, q.notas,
			q.sellerID, ses.UserID, tipo, costo, direccion, zona, ent.MedioPago, entregarEl, jsmath.Fijo2(dejado), autorizadoPor, partido,
			jsmath.Fijo2(descuento), ent.Envio && ent.SinCargo && !ent.ConCosto).Scan(&pedidoID); err != nil {
			return err
		}
		if descuento > 0 {
			if _, err := tx.Exec(ctx, `UPDATE orders SET descuento = $2::numeric, descuento_motivo = $3 WHERE id = $1`,
				pedidoID, jsmath.Fijo2(descuento), motivoDescuento); err != nil {
				return err
			}
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
		nota := "Generado desde el presupuesto " + numeroPresupuesto
		if partido != nil {
			nota += " · " + formato.Importe(deuda) + " a cuenta corriente y " + formato.Importe(ventas.ACentavos(totalPedido-deuda)) + " por cobrar"
		}
		if _, err := tx.Exec(ctx, `INSERT INTO order_status_history (order_id, estado, nota, created_by_user_id) VALUES ($1, 'pendiente', $2, $3)`,
			pedidoID, nota, ses.UserID); err != nil {
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
				*q.customerID, jsmath.Fijo2(deuda), "Pedido "+numero, numero, ses.UserID); err != nil {
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
	if ent.ACuenta > 0 && ent.MedioPago != nil && *ent.MedioPago != "cuenta_corriente" {
		desc += ", con " + formato.Importe(ventas.ACentavos(ent.ACuenta)) + " a cuenta corriente"
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
