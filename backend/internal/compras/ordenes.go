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
	"mjbj/internal/numeracion"
	"mjbj/internal/plataforma"
	"mjbj/internal/sqlc"
)

// OrdenListada es una fila del listado de órdenes de compra.
type OrdenListada struct {
	ID             string     `json:"id"`
	Numero         string     `json:"numero"`
	Estado         string     `json:"estado"`
	FechaPrometida *time.Time `json:"fechaPrometida"`
	CreatedAt      time.Time  `json:"createdAt"`
	Proveedor      string     `json:"proveedor"`
	SupplierID     string     `json:"supplierId"`
	Sucursal       *string    `json:"sucursal"`
	Lineas         int        `json:"lineas"`
	Neto           float64    `json:"neto"`
	Pendientes     int        `json:"pendientes"`
}

// ListarOrdenes es listarOrdenesDeCompra: las últimas, con el neto y los
// renglones que faltan sumados en SQL.
func (s *Servicio) ListarOrdenes(ctx context.Context, limite int) ([]OrdenListada, error) {
	filas, err := s.pool.Query(ctx, `
		SELECT o.id, o.numero, o.estado::text, o.fecha_prometida, o.created_at, s.nombre, o.supplier_id, b.name,
		  coalesce(t.lineas, 0), t.neto, coalesce(t.pendientes, 0)
		FROM purchase_orders o
		JOIN suppliers s ON s.id = o.supplier_id
		LEFT JOIN branches b ON b.id = o.branch_id
		LEFT JOIN (
		  SELECT purchase_order_id, count(*)::int AS lineas, sum(cantidad * costo_unitario) AS neto,
		    count(*) FILTER (WHERE cantidad_recibida < cantidad)::int AS pendientes
		  FROM purchase_order_items GROUP BY purchase_order_id
		) t ON t.purchase_order_id = o.id
		ORDER BY o.created_at DESC LIMIT $1`, limite)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, func(r pgx.CollectableRow) (OrdenListada, error) {
		var o OrdenListada
		var neto *jsmath.Num
		err := r.Scan(&o.ID, &o.Numero, &o.Estado, &o.FechaPrometida, &o.CreatedAt, &o.Proveedor, &o.SupplierID, &o.Sucursal, &o.Lineas, &neto, &o.Pendientes)
		o.Neto = numOCero(neto)
		return o, err
	})
}

// RenglonDeOrden es una fila de purchase_order_items (los numeric, como texto:
// así los devolvía drizzle).
type RenglonDeOrden struct {
	ID               string `json:"id"`
	PurchaseOrderID  string `json:"purchaseOrderId"`
	VariantID        string `json:"variantId"`
	Descripcion      string `json:"descripcion"`
	Cantidad         string `json:"cantidad"`
	CantidadRecibida string `json:"cantidadRecibida"`
	CostoUnitario    string `json:"costoUnitario"`
	AlicuotaIva      string `json:"alicuotaIva"`
	Orden            int32  `json:"orden"`
}

// Orden es una orden con sus renglones.
type Orden struct {
	ID             string           `json:"id"`
	Numero         string           `json:"numero"`
	Estado         string           `json:"estado"`
	FechaPrometida *time.Time       `json:"fechaPrometida"`
	Notas          *string          `json:"notas"`
	CreatedAt      time.Time        `json:"createdAt"`
	EnviadaAt      *time.Time       `json:"enviadaAt"`
	SupplierID     string           `json:"supplierId"`
	Proveedor      string           `json:"proveedor"`
	BranchID       string           `json:"branchId"`
	Sucursal       *string          `json:"sucursal"`
	Items          []RenglonDeOrden `json:"items"`
}

// ObtenerOrden es obtenerOrdenDeCompra.
func (s *Servicio) ObtenerOrden(ctx context.Context, id string) (*Orden, error) {
	if !plataforma.UUIDValido(id) {
		return nil, nil
	}
	var o Orden
	err := s.pool.QueryRow(ctx, `
		SELECT o.id, o.numero, o.estado::text, o.fecha_prometida, o.notas, o.created_at, o.enviada_at, o.supplier_id, s.nombre, o.branch_id, b.name
		FROM purchase_orders o JOIN suppliers s ON s.id = o.supplier_id LEFT JOIN branches b ON b.id = o.branch_id
		WHERE o.id = $1`, id).Scan(&o.ID, &o.Numero, &o.Estado, &o.FechaPrometida, &o.Notas, &o.CreatedAt, &o.EnviadaAt, &o.SupplierID,
		&o.Proveedor, &o.BranchID, &o.Sucursal)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	filas, err := s.pool.Query(ctx, `
		SELECT id, purchase_order_id, variant_id, descripcion, cantidad::text, cantidad_recibida::text, costo_unitario::text, alicuota_iva::text, orden
		FROM purchase_order_items WHERE purchase_order_id = $1 ORDER BY orden`, id)
	if err != nil {
		return nil, err
	}
	o.Items, err = pgx.CollectRows(filas, pgx.RowToStructByPos[RenglonDeOrden])
	return &o, err
}

// PorLlegar es lo que falta recibir de una variante.
type PorLlegar struct {
	VariantID      string     `json:"variantId"`
	Descripcion    string     `json:"descripcion"`
	Pendiente      string     `json:"pendiente"`
	ProximaEntrega *time.Time `json:"proximaEntrega"`
}

// LoQueEstaPorLlegar es loQueEstaPorLlegar: lo pedido en órdenes vivas
// (enviadas o parciales) que todavía no llegó.
func (s *Servicio) LoQueEstaPorLlegar(ctx context.Context, sucursal string) ([]PorLlegar, error) {
	var a argumentos
	cond := []string{"o.estado IN ('enviada', 'parcial')", "i.cantidad_recibida < i.cantidad"}
	if sucursal != "" {
		cond = append(cond, "o.branch_id = "+a.poner(sucursal))
	}
	filas, err := s.pool.Query(ctx, `
		SELECT i.variant_id, i.descripcion, sum(i.cantidad - i.cantidad_recibida)::text, min(o.fecha_prometida)
		FROM purchase_order_items i JOIN purchase_orders o ON o.id = i.purchase_order_id
		WHERE `+strings.Join(cond, " AND ")+`
		GROUP BY i.variant_id, i.descripcion`, a...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, pgx.RowToStructByPos[PorLlegar])
}

// CrearOrden es crearOrdenDeCompra: con el número de la serie OC (candado
// incluido) y los renglones, en una transacción.
func (s *Servicio) CrearOrden(ctx context.Context, ses *auth.Sesion, m map[string]any) (string, error) {
	o, err := leerOrden(m)
	if err != nil {
		return "", err
	}
	var prometida *time.Time
	if o.FechaPrometida != nil && *o.FechaPrometida != "" {
		f, ok := LeerFecha(*o.FechaPrometida)
		if !ok {
			return "", plataforma.Invalido(map[string]string{"fechaPrometida": "La fecha no es válida."})
		}
		prometida = &f
	}
	var id string
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		numero, err := numeracion.OrdenDeCompra(ctx, tx)
		if err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `
			INSERT INTO purchase_orders (supplier_id, branch_id, notas, numero, fecha_prometida, created_by_user_id)
			VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, o.SupplierID, o.BranchID, o.Notas, numero, prometida, ses.UserID).Scan(&id); err != nil {
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
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCrear, "orden_compra", id, fmt.Sprintf("Creó una orden de compra con %d renglones", len(o.Lineas)), nil)
	return id, nil
}

// MarcarEnviada es marcarOrdenEnviada: solo un borrador pasa a enviada.
func (s *Servicio) MarcarEnviada(ctx context.Context, ses *auth.Sesion, id string) (string, error) {
	var numero string
	err := s.pool.QueryRow(ctx, `
		UPDATE purchase_orders SET estado = 'enviada', enviada_at = now() WHERE id = $1 AND estado = 'borrador' RETURNING numero`, id).Scan(&numero)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", fallo("Esa orden ya no está en borrador.")
	}
	if err != nil {
		return "", err
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCambiarEstado, "orden_compra", id, "Marcó "+numero+" como enviada al proveedor", nil)
	return numero + " quedó como enviada.", nil
}

// AnularOrden es anularOrdenDeCompra, con el motivo en las notas.
func (s *Servicio) AnularOrden(ctx context.Context, ses *auth.Sesion, id, motivo string) (string, error) {
	motivo = trimJS(motivo)
	if motivo == "" {
		return "", fallo("Poné el motivo.")
	}
	var numero string
	err := s.pool.QueryRow(ctx, `
		UPDATE purchase_orders SET estado = 'anulada', notas = coalesce(notas || ' · ', '') || $2 WHERE id = $1 RETURNING numero`,
		id, "Anulada: "+motivo).Scan(&numero)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", fallo("Esa orden no existe.")
	}
	if err != nil {
		return "", err
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCambiarEstado, "orden_compra", id, "Anuló "+numero+": "+motivo, nil)
	return numero + " quedó anulada.", nil
}

// RecibirDeLaOrden es recibirDeLaOrden: una recepción en borrador con lo que
// falta de cada renglón.
func (s *Servicio) RecibirDeLaOrden(ctx context.Context, ses *auth.Sesion, ordenID, remito string) (string, error) {
	var recepcion string
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var supplier, branch, estado string
		err := tx.QueryRow(ctx, `SELECT supplier_id, branch_id, estado::text FROM purchase_orders WHERE id = $1`, ordenID).Scan(&supplier, &branch, &estado)
		if errors.Is(err, pgx.ErrNoRows) {
			return fallo("Esa orden no existe.")
		}
		if err != nil {
			return err
		}
		switch estado {
		case "borrador":
			return fallo("Marcá la orden como enviada antes de recibir contra ella.")
		case "anulada":
			return fallo("Esa orden está anulada.")
		}
		filas, err := tx.Query(ctx, `
			SELECT id, variant_id, cantidad, cantidad_recibida, costo_unitario::text, alicuota_iva::text
			FROM purchase_order_items WHERE purchase_order_id = $1 AND cantidad_recibida < cantidad ORDER BY orden`, ordenID)
		if err != nil {
			return err
		}
		type pendiente struct {
			id, variante       string
			cantidad, recibida jsmath.Num
			costo, alicuota    string
		}
		pendientes, err := pgx.CollectRows(filas, func(r pgx.CollectableRow) (pendiente, error) {
			var p pendiente
			return p, r.Scan(&p.id, &p.variante, &p.cantidad, &p.recibida, &p.costo, &p.alicuota)
		})
		if err != nil {
			return err
		}
		if len(pendientes) == 0 {
			return fallo("Esta orden ya se recibió entera.")
		}
		var numero *string
		if r := trimJS(remito); r != "" {
			numero = &r
		}
		if err := tx.QueryRow(ctx, `
			INSERT INTO goods_receipts (supplier_id, branch_id, purchase_order_id, numero_remito, created_by_user_id)
			VALUES ($1, $2, $3, $4, $5) RETURNING id`, supplier, branch, ordenID, numero, ses.UserID).Scan(&recepcion); err != nil {
			if strings.Contains(err.Error(), "goods_receipts_remito_idx") {
				return fallo("Ya hay una recepción con ese remito para este proveedor.")
			}
			return err
		}
		for i, p := range pendientes {
			// Lo que falta, no lo pedido.
			falta := jsmath.ToFixed(float64(p.cantidad)-float64(p.recibida), 4)
			if _, err := tx.Exec(ctx, `
				INSERT INTO goods_receipt_items (receipt_id, variant_id, purchase_order_item_id, cantidad, costo_unitario, alicuota_iva, orden)
				VALUES ($1, $2, $3, $4::numeric, $5::numeric, $6::numeric, $7)`, recepcion, p.variante, p.id, falta, p.costo, p.alicuota, i); err != nil {
				return err
			}
		}
		return nil
	})
	return recepcion, err
}
