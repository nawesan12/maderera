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

	// Lo que canceló: las facturas, los cheques rechazados que repuso y los
	// ajustes que pagó. Antes solo las facturas: el cheque repuesto no
	// figuraba en la orden de pago y la lista no sumaba el total (M2S3-011).
	// De un pago anulado, lo que cubría cuando se anuló (M2S2-078).
	consulta := `
		SELECT f.id, f.punto_venta, f.numero, f.tipo::text, f.fecha_emision, f.fecha_vencimiento, f.total, a.importe, ''
		FROM supplier_payment_allocations a JOIN purchase_invoices f ON f.id = a.purchase_invoice_id
		WHERE a.payment_id = $1
		UNION ALL
		SELECT c.id, 0, 0, 'cheque_rechazado', m.created_at, NULL::timestamptz, m.monto, k.importe, 'Cheque ' || c.numero || ' rechazado'
		FROM supplier_payment_cheques k JOIN cheques c ON c.id = k.cheque_id
		JOIN supplier_movements m ON m.cheque_id = c.id AND m.supplier_id = $2 AND m.monto > 0
		WHERE k.payment_id = $1
		UNION ALL
		SELECT m.id, 0, 0, 'ajuste', m.created_at, NULL::timestamptz, m.monto, k.importe, 'Ajuste' || coalesce(' ' || nullif(m.referencia, ''), '')
		FROM supplier_payment_ajustes k JOIN supplier_movements m ON m.id = k.movement_id
		WHERE k.payment_id = $1
		ORDER BY 5`
	if p.AnuladoAt != nil {
		consulta = `
		SELECT coalesce(f.id, c.id, m.id), coalesce(f.punto_venta, 0), coalesce(f.numero, 0),
		  CASE WHEN f.id IS NOT NULL THEN f.tipo::text WHEN c.id IS NOT NULL THEN 'cheque_rechazado' ELSE 'ajuste' END,
		  coalesce(f.fecha_emision, m.created_at, p.fecha), f.fecha_vencimiento, coalesce(f.total, m.monto, x.importe), x.importe,
		  CASE WHEN f.id IS NOT NULL THEN '' WHEN c.id IS NOT NULL THEN 'Cheque ' || c.numero || ' rechazado'
		    ELSE 'Ajuste' || coalesce(' ' || nullif(m.referencia, ''), '') END
		FROM supplier_payment_anulado_items x JOIN supplier_payments p ON p.id = x.payment_id
		LEFT JOIN purchase_invoices f ON f.id = x.purchase_invoice_id
		LEFT JOIN cheques c ON c.id = x.cheque_id
		LEFT JOIN supplier_movements m ON m.id = x.movement_id
		WHERE x.payment_id = $1 AND $2::uuid IS NOT NULL AND (f.id IS NOT NULL OR c.id IS NOT NULL OR m.id IS NOT NULL)
		ORDER BY 5`
	}
	filas, err := s.pool.Query(ctx, consulta, id, p.SupplierID)
	if err != nil {
		return nil, err
	}
	p.Facturas, err = pgx.CollectRows(filas, func(r pgx.CollectableRow) (FacturaAplicada, error) {
		var f FacturaAplicada
		var pv, n int64
		var t, a jsmath.Num
		var nombre string
		err := r.Scan(&f.ID, &pv, &n, &f.Tipo, &f.FechaEmision, &f.FechaVencimiento, &t, &a, &nombre)
		f.Numero, f.Total, f.Aplicado = NumeroDeCompra(pv, n), float64(t), float64(a)
		if nombre != "" {
			f.Numero = nombre
		}
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
		comprobante := NombreComprobanteCompra(f.Tipo) + " " + f.Numero
		if f.Tipo == "cheque_rechazado" || f.Tipo == "ajuste" {
			comprobante = f.Numero
		}
		d.Facturas = append(d.Facturas, pdf.FacturaDeLaOrden{Comprobante: comprobante, Fecha: f.FechaEmision, Aplicado: f.Aplicado,
			// La fecha de una factura es un día (medianoche UTC); la de un
			// cheque o un ajuste, un instante.
			Instante: f.Tipo == "cheque_rechazado" || f.Tipo == "ajuste"})
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
