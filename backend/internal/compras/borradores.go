package compras

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
	"mjbj/internal/sqlc"
)

// Lo que se corrige antes de que cuente (mes simulado, noviembre de 2026):
// la recepción en borrador (H059) y la orden de compra en borrador (H297).
// Ninguno de los dos tocó todavía el stock, el costo ni la deuda, así que se
// pueden cambiar sin dejar rastro contable; la bitácora anota qué cambió.

// RenglonCorregido es un renglón del borrador de una recepción con lo que de
// verdad llegó.
type RenglonCorregido struct {
	ID            string
	Cantidad      float64
	CostoUnitario float64
}

// leerCorreccion es el cuerpo de EditarRecepcion: el flete y cada renglón.
func leerCorreccion(m map[string]any) (float64, []RenglonCorregido, error) {
	l := leer(m)
	gastos := l.numero("gastos", f(0), minimo(0))
	var lineas []RenglonCorregido
	l.lista("lineas", false, 1, "La recepción tiene que tener al menos un renglón.", 200, func(_ int, e *lector) {
		lineas = append(lineas, RenglonCorregido{
			ID:            e.uuid("id", "Ese renglón ya no está."),
			Cantidad:      e.numero("cantidad", nil, minimo(0)),
			CostoUnitario: e.numero("costoUnitario", nil, minimo(0)),
		})
	})
	return gastos, lineas, l.Problema()
}

// EditarRecepcion corrige el borrador: lo que vino de cada renglón (en cero,
// el renglón sale: no vino nada), su costo y el flete. Es lo que dice la
// orden («quien recibe corrige lo que vino de menos, y la orden queda
// parcial sola»): antes el borrador no tenía ningún campo y la única salida
// era anularlo y cargar una recepción a mano, que no se ataba a la orden y
// dejaba la mercadería contada dos veces (en stock y «en camino»).
func (s *Servicio) EditarRecepcion(ctx context.Context, ses *auth.Sesion, id string, m map[string]any) (string, error) {
	if !plataforma.UUIDValido(id) {
		return "", fallo("Esa recepción no existe.")
	}
	gastos, lineas, err := leerCorreccion(m)
	if err != nil {
		return "", err
	}
	quedan := 0
	for _, l := range lineas {
		if l.Cantidad > 0 {
			quedan++
		}
	}
	if quedan == 0 {
		return "", fallo("No vino nada: anulá la recepción.")
	}
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		c, err := leerCabecera(ctx, tx, id)
		if err != nil {
			return err
		}
		if c.estado != "borrador" {
			return fallo("Solo se corrige una recepción en borrador: esta ya está " + c.estado + ".")
		}
		for _, l := range lineas {
			var tag int64
			if l.Cantidad <= 0 {
				tag, err = execTag(ctx, tx, `DELETE FROM goods_receipt_items WHERE id = $1 AND receipt_id = $2`, l.ID, id)
			} else {
				tag, err = execTag(ctx, tx, `UPDATE goods_receipt_items SET cantidad = $3::numeric, costo_unitario = $4::numeric WHERE id = $1 AND receipt_id = $2`,
					l.ID, id, jsmath.ToFixed(l.Cantidad, 4), jsmath.ToFixed(l.CostoUnitario, 4))
			}
			if err != nil {
				return err
			}
			if tag == 0 {
				return fallo("Ese renglón ya no está en la recepción.")
			}
		}
		_, err = tx.Exec(ctx, `UPDATE goods_receipts SET gastos = $2::numeric WHERE id = $1`, id, jsmath.Fijo2(gastos))
		return err
	})
	if err != nil {
		return "", err
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaEditar, "recepcion", id,
		fmt.Sprintf("Corrigió el borrador: %d renglones, flete $%s", quedan, jsmath.Fijo2(gastos)), nil)
	return "Recepción corregida.", nil
}

func execTag(ctx context.Context, tx pgx.Tx, sql string, args ...any) (int64, error) {
	t, err := tx.Exec(ctx, sql, args...)
	return t.RowsAffected(), err
}

// fechaPrometidaDe lee la fecha prometida de una orden y frena una pasada
// (mes simulado, H203: la OC-7 se creó para ayer sin ningún aviso y quedó
// «enviada» en verde, como si estuviera bien).
func fechaPrometidaDe(texto *string, ahora time.Time) (*time.Time, error) {
	if texto == nil || *texto == "" {
		return nil, nil
	}
	f, ok := LeerFecha(*texto)
	if !ok {
		return nil, plataforma.Invalido(map[string]string{"fechaPrometida": "La fecha no es válida."})
	}
	if f.Before(diaDeHoy(ahora)) {
		return nil, plataforma.Invalido(map[string]string{"fechaPrometida": "Esa fecha ya pasó."})
	}
	return &f, nil
}

// EditarOrden corrige una orden en borrador (todavía no se le mandó al
// proveedor): el proveedor, la sucursal, la fecha, las notas y los
// renglones, enteros. Antes la única salida era anularla con motivo y
// rehacerla con otro número (mes simulado, H297).
func (s *Servicio) EditarOrden(ctx context.Context, ses *auth.Sesion, id string, m map[string]any) (string, error) {
	if !plataforma.UUIDValido(id) {
		return "", fallo("Esa orden no existe.")
	}
	o, err := leerOrden(m)
	if err != nil {
		return "", err
	}
	prometida, err := fechaPrometidaDe(o.FechaPrometida, time.Now())
	if err != nil {
		return "", err
	}
	var numero string
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var estado string
		err := tx.QueryRow(ctx, `SELECT numero, estado::text FROM purchase_orders WHERE id = $1 FOR UPDATE`, id).Scan(&numero, &estado)
		if errors.Is(err, pgx.ErrNoRows) {
			return fallo("Esa orden no existe.")
		}
		if err != nil {
			return err
		}
		if estado != "borrador" {
			return fallo("Esa orden ya no está en borrador: se le mandó al proveedor.")
		}
		if _, err := tx.Exec(ctx, `UPDATE purchase_orders SET supplier_id = $2, branch_id = $3, notas = $4, fecha_prometida = $5 WHERE id = $1`,
			id, o.SupplierID, o.BranchID, o.Notas, prometida); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM purchase_order_items WHERE purchase_order_id = $1`, id); err != nil {
			return err
		}
		for i, l := range o.Lineas {
			if _, err := tx.Exec(ctx, `
				INSERT INTO purchase_order_items (purchase_order_id, variant_id, descripcion, cantidad, costo_unitario, alicuota_iva, orden)
				VALUES ($1, $2, $3, $4::numeric, $5::numeric, $6::numeric, $7)`, id, l.VariantID, l.Descripcion,
				jsmath.ToFixed(l.Cantidad, 4), jsmath.ToFixed(l.CostoUnitario, 4), jsmath.Fijo2(l.AlicuotaIva), i); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		if strings.Contains(err.Error(), "foreign key") {
			return "", fallo("El proveedor, la sucursal o alguno de los productos ya no existe.")
		}
		return "", err
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaEditar, "orden_compra", id, fmt.Sprintf("Corrigió %s: %d renglones", numero, len(o.Lineas)), nil)
	return numero + " quedó corregida.", nil
}
