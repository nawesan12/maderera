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
// hora argentina (el TS escribía la fecha UTC en ISO).
func CsvLibroIva(l Libro) string {
	n := func(v float64) string { return csvexcel.NumeroCsv(v, 2) }
	filas := make([][]string, len(l.Filas))
	for i, f := range l.Filas {
		fecha := f.FechaEmision
		filas[i] = []string{csvexcel.FechaCsv(&fecha), csvexcel.Texto(fiscal.NombreComprobante(f.Tipo)),
			csvexcel.Texto(fiscal.NumeroFormateado(f.PuntoVenta, f.Numero)), csvexcel.Texto(f.ReceptorNombre), csvexcel.TextoCsv(f.ReceptorCuit),
			n(f.Neto), n(f.Iva21), n(f.Iva105), n(f.Iva27), n(f.Exento), n(f.Tributos), n(f.Total), csvexcel.TextoCsv(f.Cae)}
	}
	t := l.Totales
	return csvexcel.ArmarCsv(
		[]string{"Fecha", "Tipo", "Numero", "Cliente", "CUIT", "Neto", "IVA 21%", "IVA 10,5%", "IVA 27%", "Exento", "Percepciones", "Total", "CAE"},
		filas,
		[]string{"", "", "", csvexcel.Texto("TOTALES"), "", n(t.Neto), n(t.Iva21), n(t.Iva105), n(t.Iva27), n(t.Exento), n(t.Tributos), n(t.Total), ""},
	)
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
		Cuit: de(e.Cuit)}, IngresosBrutos: de(e.IngresosBrutos), InicioActividades: e.InicioActividades}
	cp := pdf.ComprobantePdf{Tipo: c.Tipo, PuntoVenta: float64(c.PuntoVenta), Numero: float64(c.Numero), ReceptorNombre: c.ReceptorNombre,
		ReceptorCuit: de(c.ReceptorCuit), ReceptorCondicionIva: c.ReceptorCondicionIva, ReceptorDomicilio: de(c.ReceptorDomicilio),
		Neto: c.Neto, Iva21: c.Iva21, Iva27: c.Iva27, Iva105: c.Iva105, Exento: c.Exento, TributosTotal: c.TributosTotal, Total: c.Total,
		Cae: de(c.Cae), CaeVencimiento: dia(c.CaeVencimiento), FechaEmision: DiaArgentino(c.FechaEmision), FechaVencimiento: dia(c.FechaVencimiento),
		Observaciones: de(c.Observaciones), Estado: c.Estado, Items: make([]pdf.ItemComprobante, len(c.Items)),
		Tributos: make([]pdf.TributoComprobante, len(c.Tributos))}
	for i, x := range c.Items {
		cp.Items[i] = pdf.ItemComprobante{Descripcion: x.Descripcion, Unidad: x.Unidad, Cantidad: x.Cantidad, PrecioUnitario: x.PrecioUnitario,
			AlicuotaIva: x.AlicuotaIva, Subtotal: x.Subtotal}
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
