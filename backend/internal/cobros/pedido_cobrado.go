package cobros

import (
	"context"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/sqlc"
	"mjbj/internal/ventas/fragmentos"
)

// CerrarElPedidoCobrado deja al día un pedido después de un recibo que lo
// cobra, venga de su ficha o de su factura (mes simulado 2):
//
//   - Pagado si lo cobrado cubre lo que se cobra fuera de la cuenta
//     (M2S2-010, M2S2-015, M3S4-034: el cobro desde Facturación dejaba el
//     pedido «pendiente» y el remito decía «Pendiente de pago»).
//   - La forma de pago, la del cobro real cuando todo entró por un solo
//     medio (M3S4-027: el pedido de un presupuesto sin forma de pago seguía
//     «—» después de cobrarlo; M2S3-039: decía «efectivo» con una
//     transferencia, y la factura lo copiaba). Con un cobro parcial solo se
//     completa la que faltaba: el resto puede entrar por otro medio. Lo que está a cuenta
//     corriente no se toca: ese medio es la deuda, no el cobro.
func CerrarElPedidoCobrado(ctx context.Context, tx pgx.Tx, pedido string) error {
	var pagado bool
	if err := tx.QueryRow(ctx, `SELECT `+fragmentos.CobradoDelPedido+` + 0.005 >= `+fragmentos.ACobrarFueraDeLaCuenta+`
		FROM orders o WHERE o.id = $1`, pedido).Scan(&pagado); err != nil {
		return err
	}
	if pagado {
		if err := sqlc.New(tx).PedidoPagado(ctx, pedido); err != nil {
			return err
		}
	}
	_, err := tx.Exec(ctx, `
		WITH medios AS (
		  SELECT DISTINCT CASE rp.medio::text
		           WHEN 'deposito' THEN 'transferencia' WHEN 'echeq' THEN 'cheque'
		           WHEN 'tarjeta_debito' THEN 'debito' WHEN 'tarjeta_credito' THEN 'credito'
		           ELSE rp.medio::text END AS medio
		  FROM receipt_parts rp JOIN receipts r ON r.id = rp.receipt_id
		  WHERE r.estado = 'emitido' AND rp.medio <> 'retencion' AND r.id IN `+fragmentos.RecibosDelPedido("$1::uuid")+`)
		UPDATE orders o SET medio_pago = (SELECT medio FROM medios)::medio_pago, updated_at = now()
		WHERE o.id = $1 AND o.a_cuenta IS NULL AND o.medio_pago IS DISTINCT FROM 'cuenta_corriente'
		  AND `+fragmentos.DeudaFueraDeLaCuenta+`
		  AND (SELECT count(*) FROM medios) = 1 AND ($2 OR o.medio_pago IS NULL)
		  AND o.medio_pago IS DISTINCT FROM (SELECT medio FROM medios)::medio_pago`, pedido, pagado)
	return err
}
