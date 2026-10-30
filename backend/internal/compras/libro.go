package compras

import (
	"strings"
	"time"

	"mjbj/internal/jsmath"
)

// --- el libro IVA compras ---

// RenglonLibro es un comprobante del libro, con el signo ya puesto (las notas
// de crédito en negativo, para que las columnas se sumen de arriba abajo).
type RenglonLibro struct {
	ID           string    `json:"id"`
	FechaEmision time.Time `json:"fechaEmision"`
	Tipo         string    `json:"tipo"`
	PuntoVenta   int64     `json:"puntoVenta"`
	Numero       int64     `json:"numero"`
	Proveedor    string    `json:"proveedor"`
	Cuit         *string   `json:"cuit"`
	Neto         float64   `json:"neto"`
	Iva21        float64   `json:"iva21"`
	Iva105       float64   `json:"iva105"`
	Iva27        float64   `json:"iva27"`
	Exento       float64   `json:"exento"`
	Percepciones float64   `json:"percepciones"`
	Total        float64   `json:"total"`
	Cae          *string   `json:"cae"`
}

// TotalesLibro son las columnas sumadas.
type TotalesLibro struct {
	Neto         float64 `json:"neto"`
	Iva21        float64 `json:"iva21"`
	Iva105       float64 `json:"iva105"`
	Iva27        float64 `json:"iva27"`
	Exento       float64 `json:"exento"`
	Percepciones float64 `json:"percepciones"`
	Total        float64 `json:"total"`
}

// ConSigno da vuelta las notas de crédito.
func ConSigno(r RenglonLibro) RenglonLibro {
	if strings.HasPrefix(r.Tipo, "nota_credito") {
		r.Neto, r.Iva21, r.Iva105, r.Iva27 = -r.Neto, -r.Iva21, -r.Iva105, -r.Iva27
		r.Exento, r.Percepciones, r.Total = -r.Exento, -r.Percepciones, -r.Total
	}
	return r
}

// SumarLibro suma en el orden del libro, como el reduce del TS.
func SumarLibro(filas []RenglonLibro) TotalesLibro {
	var t TotalesLibro
	for _, f := range filas {
		t.Neto += f.Neto
		t.Iva21 += f.Iva21
		t.Iva105 += f.Iva105
		t.Iva27 += f.Iva27
		t.Exento += f.Exento
		t.Percepciones += f.Percepciones
		t.Total += f.Total
	}
	return t
}

// CsvLibroIva es el archivo de app/admin/arca/libro-iva-compras/exportar.
func CsvLibroIva(filas []RenglonLibro, t TotalesLibro) string {
	salida := make([][]string, len(filas))
	computable := 0.0
	for i, f := range filas {
		credito := "No"
		if DaCreditoFiscal(f.Tipo) {
			credito = "Sí"
			computable = computable + f.Iva21 + f.Iva105 + f.Iva27
		}
		salida[i] = []string{
			fechaCsv(f.FechaEmision), texto(NombreComprobanteCompra(f.Tipo)), texto(NumeroDeCompra(f.PuntoVenta, f.Numero)),
			texto(f.Proveedor), textoCsv(f.Cuit), numeroCsv(f.Neto, 2), numeroCsv(f.Iva21, 2), numeroCsv(f.Iva105, 2),
			numeroCsv(f.Iva27, 2), numeroCsv(f.Exento, 2), numeroCsv(f.Percepciones, 2), numeroCsv(f.Total, 2),
			texto(credito), textoCsv(f.Cae),
		}
	}
	return armarCsv(
		[]string{"Fecha", "Comprobante", "Número", "Proveedor", "CUIT", "Neto", "IVA 21%", "IVA 10,5%", "IVA 27%", "Exento", "Percepciones", "Total", "Da crédito fiscal", "CAE"},
		salida,
		[]string{texto("Totales"), "", "", "", "", numeroCsv(t.Neto, 2), numeroCsv(t.Iva21, 2), numeroCsv(t.Iva105, 2), numeroCsv(t.Iva27, 2),
			numeroCsv(t.Exento, 2), numeroCsv(t.Percepciones, 2), numeroCsv(t.Total, 2), texto("Computable: " + numeroCsv(computable, 2)), ""},
	)
}

// RetencionDelPeriodo es una retención practicada, para el archivo del contador.
type RetencionDelPeriodo struct {
	ID            string    `json:"id"`
	Numero        string    `json:"numero"`
	Fecha         time.Time `json:"fecha"`
	Impuesto      string    `json:"impuesto"`
	CodigoRegimen string    `json:"codigoRegimen"`
	Base          float64   `json:"base"`
	Alicuota      float64   `json:"alicuota"`
	Importe       float64   `json:"importe"`
	Proveedor     string    `json:"proveedor"`
	Cuit          *string   `json:"cuit"`
	// El cálculo; nil en los certificados de antes de la 00089.
	Acumulado     *float64 `json:"acumulado"`
	Imponible     *float64 `json:"imponible"`
	RetenidoAntes *float64 `json:"retenidoAntes"`
}

// CsvRetenciones es el archivo de app/admin/compras/pagos/exportar, con el
// cálculo de cada retención para que el contador lo pueda seguir: base del
// pago, acumulado del mes, monto sujeto, alícuota, lo ya retenido en el mes
// y lo retenido. Los certificados de antes de la 00089 dejan esas columnas
// vacías.
func CsvRetenciones(filas []RetencionDelPeriodo) string { return csvRetenciones(filas, true) }

// csvRetenciones con conCalculo en false es el archivo que armaba el TS
// (el golden lo compara así).
func csvRetenciones(filas []RetencionDelPeriodo, conCalculo bool) string {
	salida := make([][]string, len(filas))
	total := 0.0
	opcional := func(p *float64) string {
		if p == nil {
			return ""
		}
		return numeroCsv(*p, 2)
	}
	for i, f := range filas {
		total += f.Importe
		if conCalculo {
			salida[i] = []string{fechaCsv(f.Fecha), texto(f.Numero), texto(f.Impuesto), texto(f.CodigoRegimen), texto(f.Proveedor),
				textoCsv(f.Cuit), numeroCsv(f.Base, 2), opcional(f.Acumulado), opcional(f.Imponible), numeroCsv(f.Alicuota, 3),
				opcional(f.RetenidoAntes), numeroCsv(f.Importe, 2)}
			continue
		}
		salida[i] = []string{fechaCsv(f.Fecha), texto(f.Numero), texto(f.Impuesto), texto(f.CodigoRegimen), texto(f.Proveedor),
			textoCsv(f.Cuit), numeroCsv(f.Base, 2), numeroCsv(f.Alicuota, 3), numeroCsv(f.Importe, 2)}
	}
	if conCalculo {
		return armarCsv(
			[]string{"Fecha", "Certificado", "Impuesto", "Régimen", "Proveedor", "CUIT", "Base del pago", "Acumulado del mes",
				"Monto sujeto a retención", "Alícuota", "Ya retenido en el mes", "Retenido"},
			salida,
			[]string{texto("Total"), "", "", "", "", "", "", "", "", "", "", numeroCsv(total, 2)},
		)
	}
	return armarCsv(
		[]string{"Fecha", "Certificado", "Impuesto", "Régimen", "Proveedor", "CUIT", "Base", "Alícuota", "Retenido"},
		salida,
		[]string{texto("Total"), "", "", "", "", "", "", "", numeroCsv(total, 2)},
	)
}

// aFloat pasa un numeric que puede ser null.
func aFloat(n *jsmath.Num) *float64 {
	if n == nil {
		return nil
	}
	f := float64(*n)
	return &f
}

// SaldosCorrientes es el libro de la ficha: los movimientos vienen del más
// nuevo al más viejo; el saldo se acumula del más viejo y se devuelve al revés.
func SaldosCorrientes(montos []float64) ([]float64, float64) {
	saldos := make([]float64, len(montos))
	acumulado := 0.0
	for i := len(montos) - 1; i >= 0; i-- {
		acumulado += montos[i]
		saldos[i] = acumulado
	}
	return saldos, acumulado
}

// SaldoDeFactura es lo que le queda a una factura, a centavos.
func SaldoDeFactura(total, imputado float64) float64 { return jsmath.Redondear2(total - imputado) }
