package compras

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
	"mjbj/internal/sqlc"
)

// --- facturas de compra y libro IVA compras (lib/dal/admin/compras-fiscal.ts) ---

// FacturaDeCompra es una fila del listado del panel.
type FacturaDeCompra struct {
	ID               string     `json:"id"`
	Tipo             string     `json:"tipo"`
	PuntoVenta       int32      `json:"puntoVenta"`
	Numero           int32      `json:"numero"`
	FechaEmision     time.Time  `json:"fechaEmision"`
	FechaVencimiento *time.Time `json:"fechaVencimiento"`
	Proveedor        string     `json:"proveedor"`
	SupplierID       string     `json:"supplierId"`
	Neto             string     `json:"neto"`
	Total            string     `json:"total"`
	Pagado           string     `json:"pagado"`
}

// ListarFacturas es listarFacturasDeCompra: con lo ya imputado en pagos.
func (s *Servicio) ListarFacturas(ctx context.Context, limite int) ([]FacturaDeCompra, error) {
	filas, err := s.pool.Query(ctx, `
		SELECT f.id, f.tipo::text, f.punto_venta, f.numero, f.fecha_emision, f.fecha_vencimiento, s.nombre, f.supplier_id, f.neto::text, f.total::text,
		  coalesce((SELECT sum(a.importe) FROM supplier_payment_allocations a WHERE a.purchase_invoice_id = f.id), 0)::text
		FROM purchase_invoices f JOIN suppliers s ON s.id = f.supplier_id
		ORDER BY f.fecha_emision DESC LIMIT $1`, limite)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, pgx.RowToStructByPos[FacturaDeCompra])
}

// LibroIvaCompras es libroIvaCompras: los comprobantes entre dos fechas
// (inclusive) con el signo puesto, y los totales.
func (s *Servicio) LibroIvaCompras(ctx context.Context, desde, hasta time.Time) ([]RenglonLibro, TotalesLibro, error) {
	filas, err := s.pool.Query(ctx, `
		SELECT f.id, f.fecha_emision, f.tipo::text, f.punto_venta, f.numero, s.nombre, s.cuit,
		  f.neto, f.iva21, f.iva105, f.iva27, f.exento, f.percepciones, f.total, f.cae
		FROM purchase_invoices f JOIN suppliers s ON s.id = f.supplier_id
		WHERE f.fecha_emision >= $1 AND f.fecha_emision <= $2
		ORDER BY f.fecha_emision, f.numero`, desde, hasta)
	if err != nil {
		return nil, TotalesLibro{}, err
	}
	renglones, err := pgx.CollectRows(filas, func(r pgx.CollectableRow) (RenglonLibro, error) {
		var x RenglonLibro
		var pv, n int32
		var neto, i21, i105, i27, exento, perc, total jsmath.Num
		err := r.Scan(&x.ID, &x.FechaEmision, &x.Tipo, &pv, &n, &x.Proveedor, &x.Cuit, &neto, &i21, &i105, &i27, &exento, &perc, &total, &x.Cae)
		x.PuntoVenta, x.Numero = int64(pv), int64(n)
		x.Neto, x.Iva21, x.Iva105, x.Iva27 = float64(neto), float64(i21), float64(i105), float64(i27)
		x.Exento, x.Percepciones, x.Total = float64(exento), float64(perc), float64(total)
		return ConSigno(x), err
	})
	if err != nil {
		return nil, TotalesLibro{}, err
	}
	return renglones, SumarLibro(renglones), nil
}

// CargarFactura es cargarFacturaDeCompra: la factura y la deuda, en el mismo
// acto. El total no se pide: se suma.
func (s *Servicio) CargarFactura(ctx context.Context, ses *auth.Sesion, m map[string]any) (string, string, error) {
	d, err := leerFactura(m)
	if err != nil {
		return "", "", err
	}
	total := d.Neto + d.Iva21 + d.Iva105 + d.Iva27 + d.Exento + d.Percepciones
	if total <= 0 {
		return "", "", fallo("La factura no puede sumar cero.")
	}
	emision, ok := LeerFecha(d.FechaEmision)
	if !ok {
		return "", "", plataforma.Invalido(map[string]string{"fechaEmision": "La fecha no es válida."})
	}
	esCredito := strings.HasPrefix(d.Tipo, "nota_credito")
	var id string
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		dias := int32(0)
		if err := tx.QueryRow(ctx, `SELECT dias_pago FROM suppliers WHERE id = $1`, d.SupplierID).Scan(&dias); err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if err := tx.QueryRow(ctx, `
			INSERT INTO purchase_invoices (supplier_id, tipo, punto_venta, numero, fecha_emision, fecha_vencimiento, cae, neto, iva21, iva105, iva27,
			  exento, percepciones, total, observaciones, created_by_user_id)
			VALUES ($1, $2::tipo_comprobante_compra, $3, $4, $5, $6, $7, $8::numeric, $9::numeric, $10::numeric, $11::numeric, $12::numeric,
			  $13::numeric, $14::numeric, $15, $16) RETURNING id`,
			d.SupplierID, d.Tipo, int64(d.PuntoVenta), int64(d.Numero), emision, Vencimiento(emision, int(dias)), d.Cae, jsmath.Fijo2(d.Neto),
			jsmath.Fijo2(d.Iva21), jsmath.Fijo2(d.Iva105), jsmath.Fijo2(d.Iva27), jsmath.Fijo2(d.Exento), jsmath.Fijo2(d.Percepciones),
			jsmath.Fijo2(total), d.Observaciones, ses.UserID).Scan(&id); err != nil {
			return err
		}
		tipo, monto := "factura", total
		if esCredito {
			tipo, monto = "nota_credito", -total
		} else if strings.HasPrefix(d.Tipo, "nota_debito") {
			tipo = "nota_debito"
		}
		_, err := tx.Exec(ctx, `
			INSERT INTO supplier_movements (supplier_id, tipo, monto, referencia, detalle, created_by_user_id)
			VALUES ($1, $2::tipo_movimiento_proveedor, $3::numeric, $4, 'Factura de compra', $5)`,
			d.SupplierID, tipo, jsmath.Fijo2(monto), NumeroDeCompra(int64(d.PuntoVenta), int64(d.Numero)), ses.UserID)
		return err
	})
	if err != nil {
		if strings.Contains(err.Error(), "purchase_invoices_numeracion_idx") {
			return "", "", fallo("Ese comprobante ya está cargado para este proveedor. Computarlo dos veces rompería el IVA del mes.")
		}
		if strings.Contains(err.Error(), "foreign key") {
			return "", "", fallo("Ese proveedor no existe.")
		}
		return "", "", err
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCrear, "factura_compra", id, "Cargó una factura de compra por $"+jsmath.Fijo2(total), nil)
	return id, d.SupplierID, nil
}

// --- retenciones sufridas (las lecturas; la carga sigue en TS) ---

// RetencionSufrida es un certificado que nos entregó un cliente.
type RetencionSufrida struct {
	ID            string    `json:"id"`
	Numero        string    `json:"numero"`
	Fecha         time.Time `json:"fecha"`
	Impuesto      string    `json:"impuesto"`
	CodigoRegimen *string   `json:"codigoRegimen"`
	Base          string    `json:"base"`
	Alicuota      *string   `json:"alicuota"`
	Importe       string    `json:"importe"`
	Referencia    *string   `json:"referencia"`
	Cliente       string    `json:"cliente"`
	CustomerID    string    `json:"customerId"`
	Cuit          *string   `json:"cuit"`
}

// ListarRetencionesSufridas es listarRetencionesSufridas.
func (s *Servicio) ListarRetencionesSufridas(ctx context.Context, limite int) ([]RetencionSufrida, error) {
	filas, err := s.pool.Query(ctx, `
		SELECT r.id, r.numero, r.fecha, r.impuesto::text, r.codigo_regimen, r.base::text, r.alicuota::text, r.importe::text, r.referencia,
		  c.nombre, r.customer_id, c.cuit
		FROM retenciones_sufridas r JOIN customers c ON c.id = r.customer_id
		WHERE r.anulada_at IS NULL
		ORDER BY r.fecha DESC LIMIT $1`, limite)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, pgx.RowToStructByPos[RetencionSufrida])
}

// CreditoPorImpuesto es el crédito de un período para un impuesto.
type CreditoPorImpuesto struct {
	Impuesto string `json:"impuesto"`
	Cantidad int    `json:"cantidad"`
	Total    string `json:"total"`
}

// CreditoPorRetenciones es creditoPorRetenciones: por impuesto, porque no se
// compensan entre sí.
func (s *Servicio) CreditoPorRetenciones(ctx context.Context, desde, hasta time.Time) ([]CreditoPorImpuesto, error) {
	filas, err := s.pool.Query(ctx, `
		SELECT impuesto::text, count(*)::int, sum(importe)::text FROM retenciones_sufridas
		WHERE anulada_at IS NULL AND fecha >= $1 AND fecha <= $2 GROUP BY impuesto`, desde, hasta)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, pgx.RowToStructByPos[CreditoPorImpuesto])
}
