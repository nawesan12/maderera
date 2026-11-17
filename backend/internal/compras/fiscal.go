package compras

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/jsmath"
)

// --- facturas de compra y libro IVA compras (lib/dal/admin/compras-fiscal.ts) ---

// LibroIvaCompras es libroIvaCompras: los comprobantes entre dos fechas
// (inclusive) con el signo puesto, y los totales.
func (s *Servicio) LibroIvaCompras(ctx context.Context, desde, hasta time.Time) ([]RenglonLibro, TotalesLibro, error) {
	filas, err := s.pool.Query(ctx, `
		SELECT f.id, f.fecha_emision, f.tipo::text, f.punto_venta, f.numero, s.nombre, s.cuit,
		  f.neto, f.iva21, f.iva105, f.iva27, f.exento, f.percepciones, f.total, f.cae
		FROM purchase_invoices f JOIN suppliers s ON s.id = f.supplier_id
		-- Una factura anulada no da crédito ni débito: es como si no se hubiera cargado.
		WHERE f.fecha_emision >= $1 AND f.fecha_emision <= $2 AND f.anulada_at IS NULL
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
