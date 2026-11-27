package facturacion

import (
	"context"
	"strings"
	"time"

	"mjbj/internal/csvexcel"
	"mjbj/internal/fiscal"
	"mjbj/internal/pdf"
)

// CsvLibroIva es el libro IVA ventas para el contador. Las mismas columnas
// que app/admin/arca/libro-iva/exportar, ahora con internal/csvexcel como el
// de compras: CRLF, encabezados entre comillas y la fecha en dd/mm/aaaa en
// hora argentina (el TS escribía la fecha UTC en ISO). Lleva además la
// condición frente al IVA del receptor, que el contador necesita para
// separar las ventas a inscriptos de las a consumidores finales.
func CsvLibroIva(l Libro) string {
	n := func(v float64) string { return csvexcel.NumeroCsv(v, 2) }
	filas := make([][]string, len(l.Filas))
	for i, f := range l.Filas {
		fecha := f.FechaEmision
		filas[i] = []string{csvexcel.FechaCsv(&fecha), csvexcel.Texto(fiscal.NombreComprobante(f.Tipo)),
			csvexcel.Texto(fiscal.NumeroFormateado(f.PuntoVenta, f.Numero)), csvexcel.Texto(f.ReceptorNombre), csvexcel.TextoCsv(f.ReceptorCuit),
			csvexcel.Texto(condicionEnPapel(f.ReceptorCondicionIva)), n(f.Neto), n(f.Iva21), n(f.Iva105), n(f.Iva27), n(f.Exento), n(f.Tributos), n(f.Total), csvexcel.TextoCsv(f.Cae)}
	}
	t := l.Totales
	return csvexcel.ArmarCsv(
		[]string{"Fecha", "Tipo", "Numero", "Cliente", "CUIT", "Condicion IVA", "Neto", "IVA 21%", "IVA 10,5%", "IVA 27%", "Exento", "Percepciones", "Total", "CAE"},
		filas,
		[]string{"", "", "", csvexcel.Texto("TOTALES"), "", "", n(t.Neto), n(t.Iva21), n(t.Iva105), n(t.Iva27), n(t.Exento), n(t.Tributos), n(t.Total), ""},
	)
}

func condicionEnPapel(c string) string {
	if n, ok := fiscal.NombreCondicion[c]; ok {
		return n
	}
	return c
}

func dia(t *time.Time) *time.Time {
	if t == nil {
		return nil
	}
	d := DiaArgentino(*t)
	return &d
}

// Pdf arma el comprobante en PDF (internal/pdf, idéntico al de pdf-lib).
// Las fechas van como el día en Argentina, el mismo que se le informó a ARCA.
func (s *Servicio) Pdf(ctx context.Context, c *Completo) ([]byte, string, error) {
	e, err := s.ObtenerEmisor(ctx)
	if err != nil {
		return nil, "", err
	}
	emisor := &pdf.EmisorFiscal{Emisor: pdf.Emisor{RazonSocial: e.RazonSocial, NombreFantasia: de(e.NombreFantasia), Domicilio: de(e.Domicilio),
		Cuit: de(e.Cuit)}, CondicionIva: e.CondicionIva, IngresosBrutos: de(e.IngresosBrutos), InicioActividades: dia(e.InicioActividades)}
	cp := pdf.ComprobantePdf{Tipo: c.Tipo, PuntoVenta: float64(c.PuntoVenta), Numero: float64(c.Numero), ReceptorNombre: c.ReceptorNombre,
		ReceptorCuit: de(c.ReceptorCuit), ReceptorCondicionIva: c.ReceptorCondicionIva, ReceptorDomicilio: de(c.ReceptorDomicilio),
		Neto: c.Neto, Iva21: c.Iva21, Iva27: c.Iva27, Iva105: c.Iva105, Exento: c.Exento, TributosTotal: c.TributosTotal, Total: c.Total,
		Cae: de(c.Cae), CaeVencimiento: dia(c.CaeVencimiento), FechaEmision: DiaArgentino(c.FechaEmision), FechaVencimiento: dia(c.FechaVencimiento),
		Observaciones: de(c.Observaciones), Estado: c.Estado, Items: make([]pdf.ItemComprobante, len(c.Items)),
		Homologacion: c.CaeAmbiente != nil && *c.CaeAmbiente == "homologacion",
		Tributos:     make([]pdf.TributoComprobante, len(c.Tributos))}
	for i, x := range c.Items {
		cp.Items[i] = pdf.ItemComprobante{Descripcion: x.Descripcion, Unidad: x.Unidad, Cantidad: x.Cantidad, PrecioUnitario: x.PrecioUnitario,
			AlicuotaIva: x.AlicuotaIva, Subtotal: x.Subtotal, Neto: x.Neto}
	}
	if strings.HasPrefix(c.Tipo, "factura") {
		cp.CondicionVenta = condicionDeVenta(c)
	}
	// En una nota, el comprobante que corrige va en el lugar del pedido
	// (M3S3-006).
	if c.Asociado != nil {
		cp.Asociado = *c.Asociado
	} else {
		cp.Pedido = de(c.Pedido)
	}
	for i, t := range c.Tributos {
		cp.Tributos[i] = pdf.TributoComprobante{Descripcion: t.Descripcion, Alicuota: t.Alicuota, Importe: t.Importe}
	}
	b, err := pdf.Comprobante(pdf.DatosComprobante{Comprobante: cp, Emisor: emisor}, s.ahora())
	if err != nil {
		return nil, "", err
	}
	nombre := strings.ToUpper(c.Tipo) + "-" + fiscal.NumeroFormateado(c.PuntoVenta, c.Numero) + ".pdf"
	return b, nombre, nil
}

var mediosImpresos = map[string]string{
	"efectivo": "Efectivo", "transferencia": "Transferencia", "deposito": "Depósito", "mercado_pago": "Mercado Pago",
	"tarjeta": "Tarjeta", "debito": "Tarjeta de débito", "credito": "Tarjeta de crédito", "tarjeta_debito": "Tarjeta de débito",
	"tarjeta_credito": "Tarjeta de crédito", "cheque": "Cheque", "echeq": "e-Cheq", "retencion": "Retención",
}

// condicionDeVenta es lo que va en «Condición de venta» del papel: cuenta
// corriente, o contado con los medios con que se cobró (los de la factura y
// los del pedido). Sin ningún cobro, nada: no se sabe todavía.
func condicionDeVenta(c *Completo) string {
	if c.EnCuenta {
		return "Cuenta corriente"
	}
	var medios []string
	visto := map[string]bool{}
	sumar := func(m string) {
		if n, ok := mediosImpresos[m]; ok && !visto[n] {
			visto[n] = true
			medios = append(medios, n)
		}
	}
	for _, p := range c.Cobros {
		sumar(p.Medio)
	}
	for _, p := range c.CobrosDelPedido {
		sumar(p.Medio)
	}
	if len(medios) == 0 {
		return ""
	}
	return "Contado · " + strings.Join(medios, ", ")
}
