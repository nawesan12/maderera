package compras

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/formato"
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
	// PorLlegar es el neto de lo que falta recibir: «en camino» no cuenta
	// lo que ya llegó de una orden parcial (mes simulado).
	PorLlegar float64 `json:"porLlegar"`
	// Recibido es el neto de lo que ya llegó: el de una orden cerrada con
	// faltante (M2S3-013).
	Recibido float64 `json:"recibido"`
}

// ListarOrdenes es listarOrdenesDeCompra: las últimas, con el neto y los
// renglones que faltan sumados en SQL.
func (s *Servicio) ListarOrdenes(ctx context.Context, limite int) ([]OrdenListada, error) {
	filas, err := s.pool.Query(ctx, `
		SELECT o.id, o.numero, o.estado::text, o.fecha_prometida, o.created_at, s.nombre, o.supplier_id, b.name,
		  coalesce(t.lineas, 0), t.neto, coalesce(t.pendientes, 0), t.por_llegar, t.recibido
		FROM purchase_orders o
		JOIN suppliers s ON s.id = o.supplier_id
		LEFT JOIN branches b ON b.id = o.branch_id
		LEFT JOIN (
		  SELECT purchase_order_id, count(*)::int AS lineas, sum(cantidad * costo_unitario) AS neto,
		    count(*) FILTER (WHERE cantidad_recibida < cantidad)::int AS pendientes,
		    sum(greatest(cantidad - cantidad_recibida, 0) * costo_unitario) AS por_llegar,
		    sum(least(cantidad_recibida, cantidad) * costo_unitario) AS recibido
		  FROM purchase_order_items GROUP BY purchase_order_id
		) t ON t.purchase_order_id = o.id
		ORDER BY o.created_at DESC LIMIT $1`, limite)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, func(r pgx.CollectableRow) (OrdenListada, error) {
		var o OrdenListada
		var neto, porLlegar *jsmath.Num
		var recibido *jsmath.Num
		err := r.Scan(&o.ID, &o.Numero, &o.Estado, &o.FechaPrometida, &o.CreatedAt, &o.Proveedor, &o.SupplierID, &o.Sucursal, &o.Lineas, &neto, &o.Pendientes, &porLlegar, &recibido)
		o.Neto = numOCero(neto)
		o.PorLlegar = numOCero(porLlegar)
		o.Recibido = numOCero(recibido)
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
	// CostoRecibido es el promedio con que llegó en las recepciones
	// confirmadas de la orden: la ficha marca cuando no es el pedido
	// ($ 40.400 → $ 41.500, M2S1-035).
	CostoRecibido *string `json:"costoRecibido"`
}

// RecepcionDeLaOrden es un remito que llegó contra la orden.
type RecepcionDeLaOrden struct {
	ID           string    `json:"id"`
	NumeroRemito *string   `json:"numeroRemito"`
	Fecha        time.Time `json:"fecha"`
	Estado       string    `json:"estado"`
}

// Orden es una orden con sus renglones.
type Orden struct {
	ID             string     `json:"id"`
	Numero         string     `json:"numero"`
	Estado         string     `json:"estado"`
	FechaPrometida *time.Time `json:"fechaPrometida"`
	Notas          *string    `json:"notas"`
	CreatedAt      time.Time  `json:"createdAt"`
	EnviadaAt      *time.Time `json:"enviadaAt"`
	SupplierID     string     `json:"supplierId"`
	Proveedor      string     `json:"proveedor"`
	BranchID       string     `json:"branchId"`
	Sucursal       *string    `json:"sucursal"`
	// BorradorAbierto es la recepción en borrador de la orden, si hay: la
	// ficha lleva a corregir esa en vez de ofrecer recibir otra vez.
	BorradorAbierto *BorradorDeOrden `json:"borradorAbierto"`
	Items           []RenglonDeOrden `json:"items"`
	// Recepciones son los remitos de la orden, con enlace (M2S1-035).
	Recepciones []RecepcionDeLaOrden `json:"recepciones"`
}

// BorradorDeOrden es la recepción en borrador que salió de una orden.
type BorradorDeOrden struct {
	ID           string  `json:"id"`
	NumeroRemito *string `json:"numeroRemito"`
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
		SELECT i.id, i.purchase_order_id, i.variant_id, i.descripcion, i.cantidad::text, i.cantidad_recibida::text, i.costo_unitario::text,
		  i.alicuota_iva::text, i.orden,
		  (SELECT (sum(g.cantidad * g.costo_unitario) / nullif(sum(g.cantidad), 0))::numeric(14, 4)::text
		   FROM goods_receipt_items g JOIN goods_receipts r ON r.id = g.receipt_id
		   WHERE r.purchase_order_id = i.purchase_order_id AND r.estado = 'confirmada' AND g.variant_id = i.variant_id)
		FROM purchase_order_items i WHERE i.purchase_order_id = $1 ORDER BY i.orden`, id)
	if err != nil {
		return nil, err
	}
	o.Items, err = pgx.CollectRows(filas, pgx.RowToStructByPos[RenglonDeOrden])
	if err != nil {
		return nil, err
	}
	filas, err = s.pool.Query(ctx, `
		SELECT id, numero_remito, fecha, estado::text FROM goods_receipts
		WHERE purchase_order_id = $1 AND estado <> 'borrador' ORDER BY fecha, created_at`, id)
	if err != nil {
		return nil, err
	}
	o.Recepciones, err = pgx.CollectRows(filas, pgx.RowToStructByPos[RecepcionDeLaOrden])
	if err != nil {
		return nil, err
	}
	var b BorradorDeOrden
	err = s.pool.QueryRow(ctx, `SELECT id, numero_remito FROM goods_receipts WHERE purchase_order_id = $1 AND estado = 'borrador' ORDER BY created_at LIMIT 1`, id).
		Scan(&b.ID, &b.NumeroRemito)
	if err == nil {
		o.BorradorAbierto = &b
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	return &o, nil
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
	prometida, err := fechaPrometidaDe(o.FechaPrometida, time.Now())
	if err != nil {
		return "", err
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
				VALUES ($1, $2, $3, $4::numeric, $5::numeric, `+alicuotaDelProveedor("(SELECT o.supplier_id FROM purchase_orders o WHERE o.id = $1)", "$6::numeric")+`, $7)`, id, l.VariantID, l.Descripcion,
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
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCrear, "orden_compra", id, "Creó una orden de compra con "+formato.Cuantos(len(o.Lineas), "renglón", "renglones"), nil)
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
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		// Una orden de la que ya llegó algo no se anula: quedaba «Anulada»
		// con todo su neto aunque la mercadería estaba en el depósito y
		// facturada (M2S3-013, M2S1-138). Se cierra con faltante, y lo
		// recibido se corrige anulando la recepción.
		var estado string
		var llego bool
		err := tx.QueryRow(ctx, `SELECT estado::text, EXISTS (SELECT 1 FROM purchase_order_items WHERE purchase_order_id = $1 AND cantidad_recibida > 0)
			FROM purchase_orders WHERE id = $1 FOR UPDATE`, id).Scan(&estado, &llego)
		if errors.Is(err, pgx.ErrNoRows) {
			return fallo("Esa orden no existe.")
		}
		if err != nil {
			return err
		}
		if estado == "anulada" {
			return fallo("Esa orden ya está anulada.")
		}
		if llego || estado == "completa" {
			return fallo("De esta orden ya llegó mercadería: cerrala con faltante o anulá la recepción.")
		}
		err = tx.QueryRow(ctx, `
			UPDATE purchase_orders SET estado = 'anulada', notas = coalesce(notas || ' · ', '') || $2 WHERE id = $1 RETURNING numero`,
			id, "Anulada: "+motivo).Scan(&numero)
		if err != nil {
			return err
		}
		// Los borradores de recepción de la orden no van a llegar: se anulan
		// con ella (no tocaron stock ni deuda) y su remito queda libre.
		_, err = tx.Exec(ctx, `UPDATE goods_receipts SET estado = 'anulada', notas = coalesce(notas || ' · ', '') || $2
			WHERE purchase_order_id = $1 AND estado = 'borrador'`, id, "Anulada con la orden: "+motivo)
		return err
	})
	if err != nil {
		return "", err
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCambiarEstado, "orden_compra", id, "Anuló "+numero+": "+motivo, nil)
	return numero + " quedó anulada.", nil
}

// CerrarConFaltante deja completa una orden de la que llegó una parte y el
// proveedor avisó que no tiene el resto (M2S3-013): sale de «en camino» y
// el listado la muestra con lo que llegó. Los borradores de recepción que
// tenía se anulan, como al anular.
func (s *Servicio) CerrarConFaltante(ctx context.Context, ses *auth.Sesion, id, motivo string) (string, error) {
	motivo = trimJS(motivo)
	if !plataforma.UUIDValido(id) {
		return "", fallo("Esa orden no existe.")
	}
	var numero string
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var estado string
		err := tx.QueryRow(ctx, `SELECT estado::text, numero FROM purchase_orders WHERE id = $1 FOR UPDATE`, id).Scan(&estado, &numero)
		if errors.Is(err, pgx.ErrNoRows) {
			return fallo("Esa orden no existe.")
		}
		if err != nil {
			return err
		}
		if estado != "parcial" {
			return fallo("Solo se cierra con faltante una orden de la que llegó una parte.")
		}
		nota := "Cerrada con faltante"
		if motivo != "" {
			nota += ": " + motivo
		}
		if _, err := tx.Exec(ctx, `UPDATE purchase_orders SET estado = 'completa', notas = coalesce(notas || ' · ', '') || $2 WHERE id = $1`,
			id, nota); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `UPDATE goods_receipts SET estado = 'anulada', notas = coalesce(notas || ' · ', '') || $2
			WHERE purchase_order_id = $1 AND estado = 'borrador'`, id, "Anulada al cerrar la orden con faltante")
		return err
	})
	if err != nil {
		return "", err
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCambiarEstado, "orden_compra", id, "Cerró "+numero+" con faltante"+
		map[bool]string{true: ": " + motivo, false: ""}[motivo != ""], nil)
	return numero + " quedó cerrada con lo que llegó.", nil
}

// CambiarFechaPrometida corrige la fecha prometida mientras la orden no llegó
// entera (M3S4-020): una vez enviada no había forma de cargarla.
func (s *Servicio) CambiarFechaPrometida(ctx context.Context, ses *auth.Sesion, id, fecha string) (string, error) {
	if !plataforma.UUIDValido(id) {
		return "", fallo("Esa orden no existe.")
	}
	var prometida *time.Time
	if f := trimJS(fecha); f != "" {
		p, err := fechaPrometidaDe(&f, time.Now())
		if err != nil {
			return "", err
		}
		prometida = p
	}
	var numero string
	err := s.pool.QueryRow(ctx, `UPDATE purchase_orders SET fecha_prometida = $2 WHERE id = $1 AND estado IN ('borrador', 'enviada', 'parcial') RETURNING numero`,
		id, prometida).Scan(&numero)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", fallo("A esa orden ya no se le cambia la fecha.")
	}
	if err != nil {
		return "", err
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaEditar, "orden_compra", id, "Cambió la fecha prometida de "+numero, nil)
	return "Fecha guardada.", nil
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
		// Un borrador abierto de la misma orden: se corrige ese, no se hace
		// otro (dos borradores de lo mismo, confirmados, la recibían dos veces).
		var abierto string
		if err := tx.QueryRow(ctx, `SELECT coalesce(numero_remito, '') FROM goods_receipts WHERE purchase_order_id = $1 AND estado = 'borrador' LIMIT 1`,
			ordenID).Scan(&abierto); err == nil {
			if abierto != "" {
				return fallo("Ya hay una recepción en borrador de esta orden (remito " + abierto + "): corregí esa.")
			}
			return fallo("Ya hay una recepción en borrador de esta orden: corregí esa.")
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return err
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
				VALUES ($1, $2, $3, $4::numeric, $5::numeric, `+alicuotaDelProveedor("(SELECT g.supplier_id FROM goods_receipts g WHERE g.id = $1)", "$6::numeric")+`, $7)`, recepcion, p.variante, p.id, falta, p.costo, p.alicuota, i); err != nil {
				return err
			}
		}
		return nil
	})
	return recepcion, err
}
