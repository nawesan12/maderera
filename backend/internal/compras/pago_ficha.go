package compras

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/jsmath"
	"mjbj/internal/pdf"
	"mjbj/internal/plataforma"
)

// --- la ficha de un pago a proveedor y su orden de pago ---

// FacturaAplicada es una factura que canceló el pago, con cuánto.
type FacturaAplicada struct {
	ID               string     `json:"id"`
	Numero           string     `json:"numero"`
	Tipo             string     `json:"tipo"`
	FechaEmision     time.Time  `json:"fechaEmision"`
	FechaVencimiento *time.Time `json:"fechaVencimiento"`
	Total            float64    `json:"total"`
	Aplicado         float64    `json:"aplicado"`
}

// RetencionDelPago es un certificado que salió con el pago.
type RetencionDelPago struct {
	Numero        string     `json:"numero"`
	Impuesto      string     `json:"impuesto"`
	CodigoRegimen string     `json:"codigoRegimen"`
	NombreRegimen *string    `json:"nombreRegimen"`
	Base          float64    `json:"base"`
	Importe       float64    `json:"importe"`
	AnuladaAt     *time.Time `json:"anuladaAt"`
}

// ParteDelPago es un renglón de con qué salió la plata.
type ParteDelPago struct {
	Medio          string     `json:"medio"`
	Importe        float64    `json:"importe"`
	Referencia     *string    `json:"referencia"`
	ChequeNumero   *string    `json:"chequeNumero"`
	ChequeBanco    *string    `json:"chequeBanco"`
	ChequeFechaPag *time.Time `json:"chequeFechaPago"`
}

// FichaDePago es el pago entero.
type FichaDePago struct {
	ID              string             `json:"id"`
	Fecha           time.Time          `json:"fecha"`
	Total           float64            `json:"total"`
	Neto            float64            `json:"neto"`
	Medio           string             `json:"medio"`
	Circuito        string             `json:"circuito"`
	Referencia      *string            `json:"referencia"`
	Notas           *string            `json:"notas"`
	SupplierID      string             `json:"supplierId"`
	Proveedor       string             `json:"proveedor"`
	RazonSocial     *string            `json:"razonSocial"`
	Cuit            *string            `json:"cuit"`
	AnuladoAt       *time.Time         `json:"anuladoAt"`
	MotivoAnulacion *string            `json:"motivoAnulacion"`
	Facturas        []FacturaAplicada  `json:"facturas"`
	Retenciones     []RetencionDelPago `json:"retenciones"`
	Partes          []ParteDelPago     `json:"partes"`
	// La caja de la que salió el efectivo, si salió de una.
	Caja           *string `json:"caja"`
	EfectivoEnCaja float64 `json:"efectivoEnCaja"`
}

// ObtenerPago es la ficha de /admin/compras/pagos/[id]; nil si no está.
func (s *Servicio) ObtenerPago(ctx context.Context, id string) (*FichaDePago, error) {
	if !plataforma.UUIDValido(id) {
		return nil, nil
	}
	var p FichaDePago
	var total, neto jsmath.Num
	err := s.pool.QueryRow(ctx, `
		SELECT p.id, p.fecha, p.total, p.neto, p.medio, p.circuito::text, p.referencia, p.notas, p.supplier_id, s.nombre, s.razon_social, s.cuit,
		  p.anulado_at, p.motivo_anulacion
		FROM supplier_payments p JOIN suppliers s ON s.id = p.supplier_id WHERE p.id = $1`, id).
		Scan(&p.ID, &p.Fecha, &total, &neto, &p.Medio, &p.Circuito, &p.Referencia, &p.Notas, &p.SupplierID, &p.Proveedor, &p.RazonSocial, &p.Cuit,
			&p.AnuladoAt, &p.MotivoAnulacion)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	p.Total, p.Neto = float64(total), float64(neto)

	filas, err := s.pool.Query(ctx, `
		SELECT f.id, f.punto_venta, f.numero, f.tipo::text, f.fecha_emision, f.fecha_vencimiento, f.total, a.importe
		FROM supplier_payment_allocations a JOIN purchase_invoices f ON f.id = a.purchase_invoice_id
		WHERE a.payment_id = $1 ORDER BY f.fecha_emision`, id)
	if err != nil {
		return nil, err
	}
	p.Facturas, err = pgx.CollectRows(filas, func(r pgx.CollectableRow) (FacturaAplicada, error) {
		var f FacturaAplicada
		var pv, n int64
		var t, a jsmath.Num
		err := r.Scan(&f.ID, &pv, &n, &f.Tipo, &f.FechaEmision, &f.FechaVencimiento, &t, &a)
		f.Numero, f.Total, f.Aplicado = NumeroDeCompra(pv, n), float64(t), float64(a)
		return f, err
	})
	if err != nil {
		return nil, err
	}

	filas, err = s.pool.Query(ctx, `
		SELECT r.numero, r.impuesto::text, r.codigo_regimen, g.nombre, r.base, r.importe, r.anulada_at
		FROM retenciones_practicadas r LEFT JOIN regimenes_retencion g ON g.id = r.regimen_id
		WHERE r.payment_id = $1 ORDER BY r.numero`, id)
	if err != nil {
		return nil, err
	}
	p.Retenciones, err = pgx.CollectRows(filas, func(r pgx.CollectableRow) (RetencionDelPago, error) {
		var x RetencionDelPago
		var base, importe jsmath.Num
		err := r.Scan(&x.Numero, &x.Impuesto, &x.CodigoRegimen, &x.NombreRegimen, &base, &importe, &x.AnuladaAt)
		x.Base, x.Importe = float64(base), float64(importe)
		return x, err
	})
	if err != nil {
		return nil, err
	}

	filas, err = s.pool.Query(ctx, `
		SELECT p.medio, p.importe, p.referencia, c.numero, c.banco, c.fecha_pago
		FROM supplier_payment_parts p LEFT JOIN cheques c ON c.id = p.cheque_id
		WHERE p.payment_id = $1 ORDER BY p.importe DESC`, id)
	if err != nil {
		return nil, err
	}
	p.Partes, err = pgx.CollectRows(filas, func(r pgx.CollectableRow) (ParteDelPago, error) {
		var x ParteDelPago
		var importe jsmath.Num
		err := r.Scan(&x.Medio, &importe, &x.Referencia, &x.ChequeNumero, &x.ChequeBanco, &x.ChequeFechaPag)
		x.Importe = float64(importe)
		return x, err
	})
	if err != nil {
		return nil, err
	}

	var salio *jsmath.Num
	if err := s.pool.QueryRow(ctx, `
		SELECT -sum(m.monto) FILTER (WHERE m.tipo = 'gasto'), min(b.name)
		FROM cash_movements m JOIN cash_sessions c ON c.id = m.session_id JOIN branches b ON b.id = c.branch_id
		WHERE m.supplier_payment_id = $1`, id).Scan(&salio, &p.Caja); err != nil {
		return nil, err
	}
	p.EfectivoEnCaja = numOCero(salio)
	return &p, nil
}

// nombreDelMedio es la palabra de cada medio en papel.
func nombreDelMedio(m string) string {
	switch m {
	case "transferencia":
		return "Transferencia"
	case "efectivo":
		return "Efectivo"
	case "cheque":
		return "Cheque"
	case "echeq":
		return "e-Cheq"
	}
	return m
}

// DatosDeLaOrdenDePago pasa la ficha a lo que dibuja internal/pdf.
func DatosDeLaOrdenDePago(p *FichaDePago, emisor *pdf.Emisor) pdf.DatosOrdenDePago {
	de := func(s *string) string {
		if s == nil {
			return ""
		}
		return *s
	}
	d := pdf.DatosOrdenDePago{Fecha: p.Fecha, Total: p.Total, Neto: p.Neto, Referencia: de(p.Referencia), Emisor: emisor,
		Anulado: p.AnuladoAt != nil}
	d.Proveedor.Nombre, d.Proveedor.RazonSocial, d.Proveedor.Cuit = p.Proveedor, de(p.RazonSocial), de(p.Cuit)
	for _, f := range p.Facturas {
		d.Facturas = append(d.Facturas, pdf.FacturaDeLaOrden{Comprobante: NombreComprobanteCompra(f.Tipo) + " " + f.Numero,
			Fecha: f.FechaEmision, Aplicado: f.Aplicado})
	}
	for _, r := range p.Retenciones {
		if r.AnuladaAt != nil {
			continue
		}
		d.Retenciones = append(d.Retenciones, pdf.RetencionDeLaOrden{Certificado: r.Numero, Regimen: r.CodigoRegimen + " · " + de(r.NombreRegimen),
			Importe: r.Importe})
	}
	if len(p.Partes) == 0 {
		d.Medios = append(d.Medios, pdf.MedioDeLaOrden{Medio: nombreDelMedio(p.Medio), Detalle: de(p.Referencia), Importe: p.Neto})
	}
	for _, x := range p.Partes {
		detalle := de(x.Referencia)
		if x.ChequeNumero != nil {
			detalle = "N.º " + *x.ChequeNumero
			if x.ChequeBanco != nil && *x.ChequeBanco != "" {
				detalle += " · " + *x.ChequeBanco
			}
			if x.ChequeFechaPag != nil {
				detalle += " · al " + pdf.FechaLocal(*x.ChequeFechaPag)
			}
		}
		d.Medios = append(d.Medios, pdf.MedioDeLaOrden{Medio: nombreDelMedio(x.Medio), Detalle: detalle, Importe: x.Importe})
	}
	return d
}
