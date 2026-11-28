package entregas

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/cola"
	"mjbj/internal/numeracion"
	"mjbj/internal/sqlc"
)

// El remito de un pedido que solo lleva el corte (mes simulado 2, M2S2-066 y
// M3S1-053): la venta que cobró un corte no tiene mercadería por retirar, así
// que no ofrecía remito; se marcaba entregada sin firma, y el nombre y el
// documento de quien retiraba se pedían y no quedaban en ningún lado. Ahora
// sale un remito con las piezas del corte (como el de la reposición, sin
// mover stock: la placa ya salió con el corte), preparado para firmar.

// RemitoDelCorte hace el remito de cada corte del pedido que ya salió de la
// máquina y no tiene uno vivo. Quien llama tiene el candado de la serie de
// remitos (numeracion.BloquearRemitos) y la fila del pedido. Devuelve el
// primero (nil si no hizo ninguno).
func RemitoDelCorte(ctx context.Context, tx pgx.Tx, pedido string, sucursal *string, usuario *string, quien Receptor) (*EntregaCreada, error) {
	filas, err := tx.Query(ctx, `
		SELECT co.id::text FROM cutting_orders co
		WHERE co.order_id = $1 AND NOT co.sin_cargo AND co.estado IN ('terminado', 'retirado')
		  AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.cutting_order_id = co.id AND d.estado <> 'anulada')
		ORDER BY co.numero`, pedido)
	if err != nil {
		return nil, err
	}
	cortes, err := pgx.CollectRows(filas, pgx.RowTo[string])
	if err != nil {
		return nil, err
	}
	var primero *EntregaCreada
	for _, corte := range cortes {
		numero, err := numeracion.Remito(ctx, tx)
		if err != nil {
			return nil, err
		}
		token := tokenDeFirma()
		var id string
		if err := tx.QueryRow(ctx, `
			INSERT INTO deliveries (numero, order_id, branch_id, tipo, estado, receptor_nombre, receptor_documento, firma_token,
			  created_by_user_id, cutting_order_id, created_at, updated_at)
			VALUES ($1, $2, coalesce((SELECT branch_id FROM cutting_orders WHERE id = $8), $3), 'retiro', 'preparada', $4, $5, $6, $7, $8,
			  clock_timestamp(), clock_timestamp())
			RETURNING id::text`, numero, pedido, sucursal, textoONulo(quien.Nombre), textoONulo(quien.Documento), token, usuario, corte).Scan(&id); err != nil {
			return nil, err
		}
		if _, err := cola.Encolar(ctx, sqlc.New(tx), TrabajoRemitoParaFirmar, map[string]string{"deliveryId": id}, time.Now().Add(EsperaDelPedidoDeFirma)); err != nil {
			return nil, err
		}
		if primero == nil {
			primero = &EntregaCreada{ID: id, Numero: numero, FirmaToken: token, PedidoCompleto: true}
		}
	}
	return primero, nil
}

// SoloElCorte dice si al pedido no le queda mercadería por entregar pero
// tiene cortes: lo que se lleva son las piezas.
func SoloElCorte(ctx context.Context, tx pgx.Tx, pedido string) (bool, error) {
	saldo, err := SaldoDeAcopio(ctx, tx, pedido)
	if err != nil {
		return false, err
	}
	if len(SoloPendientes(saldo)) > 0 {
		return false, nil
	}
	var hay bool
	err = tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM cutting_orders WHERE order_id = $1 AND NOT sin_cargo AND estado <> 'cancelado')`, pedido).Scan(&hay)
	return hay, err
}
