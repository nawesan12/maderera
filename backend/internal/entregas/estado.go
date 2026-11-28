package entregas

import (
	"context"
	"math"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/cola"
	"mjbj/internal/formato"
	"mjbj/internal/jsmath"
	"mjbj/internal/sqlc"
	"mjbj/internal/ventas/fragmentos"
)

// Lo que mueve el estado del pedido alrededor de un remito: los cortes que
// todavía no salieron de la máquina, el envío que queda «en camino» hasta
// que firma quien recibe, y la venta del mostrador que ya descontó el stock.
// (Mes simulado en producción, 26/11/2026.)

// TrabajoPedidoEstado es el aviso al cliente de un pedido que cambió de
// estado (pedidos.TrabajoCambioDeEstado: pedidos importa este paquete, así
// que la constante se repite acá).
const TrabajoPedidoEstado = "pedido.estado"

// EsperaDelAviso es cuánto espera el aviso de un paso intermedio (preparando,
// listo): el depósito que lleva el pedido de una a entregado mandaba cuatro
// correos en treinta segundos (recorrido, M4-087). Si al salir el pedido ya
// pasó a otro estado, ese aviso no sale y queda el último.
const EsperaDelAviso = 2 * time.Minute

// CuandoAvisar es el momento del aviso de un pedido que pasó a `estado`:
// los intermedios esperan, el resto sale ya (cero).
func CuandoAvisar(estado string, ahora time.Time) time.Time {
	if estado == "preparando" || estado == "listo" {
		return ahora.Add(EsperaDelAviso)
	}
	return time.Time{}
}

// CortesSinTerminar son los números de los cortes del pedido que todavía
// están en la cola o en la máquina. Un pedido con su corte en cola no está
// listo: se marcaba «listo» y el depósito lo despachaba sin las piezas.
func CortesSinTerminar(ctx context.Context, db consultor, pedido string) ([]string, error) {
	var numeros []string
	err := db.QueryRow(ctx, `
		SELECT coalesce(array_agg(numero ORDER BY numero), '{}') FROM cutting_orders
		WHERE order_id = $1 AND estado IN ('en-cola', 'en-proceso')`, pedido).Scan(&numeros)
	return numeros, err
}

// ConCortes marca cada renglón con su corte sin terminar (el del mismo
// producto) y cuánto del renglón se lleva: las placas del corte, en la unidad
// del renglón (las medias de un corte de medias placas son media placa cada
// una). Lo demás del renglón sale igual, sin cortar.
func ConCortes(ctx context.Context, db consultor, pedido string, renglones []Renglon) ([]Renglon, error) {
	if len(renglones) == 0 {
		return renglones, nil
	}
	filas, err := db.Query(ctx, `
		SELECT oi.id::text, string_agg(c.numero, ', ' ORDER BY c.numero),
		       sum(c.placas * CASE WHEN c.mitad IS NOT NULL THEN 0.5 ELSE 1 END / coalesce(nullif(oi.stock_por_unidad, 0), 1))::float8
		FROM order_items oi
		JOIN cutting_orders c ON c.order_id = oi.order_id AND c.estado IN ('en-cola', 'en-proceso')
		  AND c.variant_id IS NOT NULL AND c.variant_id = oi.variant_id
		WHERE oi.order_id = $1 GROUP BY oi.id`, pedido)
	if err != nil {
		return nil, err
	}
	type enCorte struct {
		numeros  string
		cantidad float64
	}
	cortes := map[string]enCorte{}
	var id, numeros string
	var cantidad float64
	if _, err := pgx.ForEachRow(filas, []any{&id, &numeros, &cantidad}, func() error {
		cortes[id] = enCorte{numeros, cantidad}
		return nil
	}); err != nil {
		return nil, err
	}
	for i := range renglones {
		if c, ok := cortes[renglones[i].OrderItemID]; ok {
			renglones[i].EnCorte = c.numeros
			n := math.Min(jsmath.Round(c.cantidad*1000)/1000, renglones[i].Pendiente)
			renglones[i].EnCorteCantidad = &n
		}
	}
	return renglones, nil
}

// FaltaElCorte es el 422 de un pedido que quiere quedar listo o salir con
// cortes sin terminar; nil si no hay ninguno.
func FaltaElCorte(ctx context.Context, db consultor, pedido string) error {
	numeros, err := CortesSinTerminar(ctx, db, pedido)
	if err != nil || len(numeros) == 0 {
		return err
	}
	if len(numeros) == 1 {
		return ErrorDeEntrega("El corte " + numeros[0] + " todavía no salió de la máquina: el pedido queda listo cuando se termine.")
	}
	return ErrorDeEntrega("Los cortes " + strings.Join(numeros, ", ") + " todavía no salieron de la máquina: el pedido queda listo cuando se terminen.")
}

// CerrarCortes da por retirados los cortes terminados de un pedido que se
// entregó: las piezas salieron con él. Quedaban «terminados sin retirar» y
// había que cerrarlos a mano uno por uno.
func CerrarCortes(ctx context.Context, tx pgx.Tx, pedido string) error {
	_, err := tx.Exec(ctx, `UPDATE cutting_orders SET estado = 'retirado', updated_at = now() WHERE order_id = $1 AND estado = 'terminado'`, pedido)
	return err
}

// SalioConLaVenta: la venta del mostrador ya descontó el stock al cobrar
// (sus movimientos dicen «Mostrador PED-…»). Un remito de ese pedido no
// vuelve a sacar nada: es la constancia de lo que se lleva. Es lo que pasa
// con la venta que lleva un corte, que queda en curso hasta que se termina.
func SalioConLaVenta(ctx context.Context, db consultor, pedido string) (bool, error) {
	var si bool
	err := db.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM orders o JOIN inventory_movements m ON m.note = 'Mostrador ' || o.numero AND m.type = 'venta'
		               WHERE o.id = $1)`, pedido).Scan(&si)
	return si, err
}

// pasarA cambia el estado del pedido con su renglón en el historial y, con
// `avisar`, el aviso al cliente. Al quedar entregado, cierra sus cortes
// terminados.
func pasarA(ctx context.Context, tx pgx.Tx, pedido, estado, nota string, usuario *string, avisar bool) error {
	if _, err := tx.Exec(ctx, `UPDATE orders SET estado = $2, updated_at = now() WHERE id = $1`, pedido, estado); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO order_status_history (order_id, estado, nota, created_by_user_id) VALUES ($1, $2, $3, $4)`,
		pedido, estado, nota, usuario); err != nil {
		return err
	}
	if estado == "entregado" {
		if err := CerrarCortes(ctx, tx, pedido); err != nil {
			return err
		}
	}
	if !avisar {
		return nil
	}
	_, err := cola.Encolar(ctx, sqlc.New(tx), TrabajoPedidoEstado, map[string]string{"orderId": pedido, "estado": estado}, CuandoAvisar(estado, time.Now()))
	return err
}

// notaSinCobrar antepone a la nota lo que faltaba cobrar al entregar, con la
// misma cabecera que «Avanzar».
func notaSinCobrar(ctx context.Context, tx pgx.Tx, pedido, nota string) (string, error) {
	var falta *float64
	if err := tx.QueryRow(ctx, `SELECT `+fragmentos.SinCobrarDelPedido+`::float8 FROM orders o WHERE o.id = $1`, pedido).Scan(&falta); err != nil {
		return "", err
	}
	if falta != nil && *falta > 0.009 {
		return fragmentos.NotaEntregadoSinCobrar + " · " + formato.Importe(*falta) + " · " + nota, nil
	}
	return nota, nil
}

// estadoAntesDelViaje es el estado en que estaba el pedido antes de salir
// en camino (el último del historial que no lo es), o «listo».
func estadoAntesDelViaje(ctx context.Context, tx pgx.Tx, pedido string) (string, error) {
	var estado string
	err := tx.QueryRow(ctx, `
		SELECT coalesce((SELECT estado::text FROM order_status_history
		                 WHERE order_id = $1 AND estado NOT IN ('en-camino', 'entregado', 'cancelado')
		                 ORDER BY created_at DESC, id DESC LIMIT 1), 'listo')`, pedido).Scan(&estado)
	return estado, err
}

// remitosDeViajeSinFirmar cuenta los remitos de envío vivos del pedido que
// todavía no firmó nadie (sin contar `menos`).
func remitosDeViajeSinFirmar(ctx context.Context, tx pgx.Tx, pedido, menos string) (int, error) {
	var n int
	err := tx.QueryRow(ctx, `
		SELECT count(*)::int FROM deliveries
		WHERE order_id = $1 AND id::text <> $2 AND tipo = 'envio' AND estado = 'preparada'`, pedido, menos).Scan(&n)
	return n, err
}

// VueltaDelViaje decide qué pasa con un pedido «en camino» cuando se firma
// o se anula uno de sus remitos de envío: si no queda ninguno en la calle,
// con todo entregado queda entregado, y con algo por llevar vuelve a donde
// estaba antes de salir (para el próximo viaje). Quien llama tiene la fila
// del pedido bloqueada.
func VueltaDelViaje(ctx context.Context, tx pgx.Tx, pedido, remito, numero string, usuario *string, firmado bool) error {
	var estado string
	if err := tx.QueryRow(ctx, `SELECT estado::text FROM orders WHERE id = $1`, pedido).Scan(&estado); err != nil {
		return err
	}
	if estado != "en-camino" {
		return nil
	}
	enLaCalle, err := remitosDeViajeSinFirmar(ctx, tx, pedido, remito)
	if err != nil || enLaCalle > 0 {
		return err
	}
	saldo, err := SaldoDeAcopio(ctx, tx, pedido)
	if err != nil {
		return err
	}
	if len(SoloPendientes(saldo)) == 0 && firmado {
		nota, err := notaSinCobrar(ctx, tx, pedido, "Remito "+numero+" firmado")
		if err != nil {
			return err
		}
		return pasarA(ctx, tx, pedido, "entregado", nota, usuario, true)
	}
	if len(SoloPendientes(saldo)) == 0 {
		return nil
	}
	antes, err := estadoAntesDelViaje(ctx, tx, pedido)
	if err != nil {
		return err
	}
	nota := "Remito " + numero + " firmado: falta llevar el resto"
	if !firmado {
		nota = "Remito " + numero + " anulado: la mercadería volvió al depósito"
	}
	// Vuelve sin aviso: el cliente ya recibió una parte, y «tu pedido está
	// listo» otra vez confunde.
	return pasarA(ctx, tx, pedido, antes, nota, usuario, false)
}
