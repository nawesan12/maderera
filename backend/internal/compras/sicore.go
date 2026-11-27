package compras

import (
	"context"
	"fmt"
	"strings"
	"time"
	"unicode"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/fiscal"
	"mjbj/internal/jsmath"
)

// Las retenciones practicadas en el TXT de importación de SICORE (M2S1-145).
// Sale solo con la regla exportar_sicore en «si»: hasta que el estudio
// confirme el diseño de registro, el archivo de siempre es el CSV (un TXT
// que el aplicativo rechaza es peor que no tener TXT).
//
// El diseño es el de importación de retenciones de SICORE, de ancho fijo y
// sin separadores, un renglón por certificado y \r\n al final de cada uno:
//
//	 1  2  código de comprobante (06: orden de pago)
//	 2 10  fecha del comprobante, dd/mm/aaaa
//	 3 16  número del comprobante (el del certificado, solo dígitos)
//	 4 16  importe del comprobante (el pago entero), con coma
//	 5  3  código de impuesto (217 Ganancias, 767 IVA)
//	 6  3  código de régimen
//	 7  1  código de operación (1: retención)
//	 8 14  base de cálculo, con coma
//	 9 10  fecha de la retención
//	10  2  condición (01 inscripto, 02 no inscripto)
//	11  1  retención a sujeto suspendido (0)
//	12 14  importe retenido, con coma
//	13  6  porcentaje de exclusión (000,00)
//	14 10  fecha de publicación (en blanco)
//	15  2  tipo de documento del retenido (80: CUIT)
//	16 20  número de documento
//	17 14  número de certificado original (ceros)
//
// IIBB no va: no es de SICORE (cada provincia tiene su aplicativo).

// RetencionParaSicore es un renglón del TXT.
type RetencionParaSicore struct {
	Fecha         time.Time
	Numero        string
	Impuesto      string
	CodigoRegimen string
	Base          float64
	Importe       float64
	TotalDelPago  float64
	Cuit          string
	Inscripto     bool
}

// CodigoDeImpuestoSicore es el código de SICORE de cada impuesto; "" si no va.
func CodigoDeImpuestoSicore(impuesto string) string {
	switch impuesto {
	case "ganancias":
		return "217"
	case "iva":
		return "767"
	}
	return ""
}

func soloDigitos(t string) string {
	var b strings.Builder
	for _, r := range t {
		if unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func aIzquierda(t string, n int) string {
	if len(t) >= n {
		return t[len(t)-n:]
	}
	return strings.Repeat("0", n-len(t)) + t
}

func importeSicore(v float64, n int) string {
	t := strings.Replace(jsmath.ToFixed(v, 2), ".", ",", 1)
	if len(t) >= n {
		return t[len(t)-n:]
	}
	return strings.Repeat(" ", n-len(t)) + t
}

func fechaArgentina(t time.Time) string {
	t = t.In(fiscal.Argentina)
	return fmt.Sprintf("%02d/%02d/%d", t.Day(), int(t.Month()), t.Year())
}

// TxtSicore arma el archivo. Los que no son de SICORE (IIBB) o tienen un
// régimen que no es un número no entran.
func TxtSicore(filas []RetencionParaSicore) string {
	var b strings.Builder
	for _, f := range filas {
		impuesto := CodigoDeImpuestoSicore(f.Impuesto)
		regimen := soloDigitos(f.CodigoRegimen)
		if impuesto == "" || regimen == "" || len(regimen) > 3 {
			continue
		}
		condicion := "02"
		if f.Inscripto {
			condicion = "01"
		}
		fecha := fechaArgentina(f.Fecha)
		b.WriteString("06")
		b.WriteString(fecha)
		b.WriteString(aIzquierda(soloDigitos(f.Numero), 16))
		b.WriteString(importeSicore(f.TotalDelPago, 16))
		b.WriteString(impuesto)
		b.WriteString(aIzquierda(regimen, 3))
		b.WriteString("1")
		b.WriteString(importeSicore(f.Base, 14))
		b.WriteString(fecha)
		b.WriteString(condicion)
		b.WriteString("0")
		b.WriteString(importeSicore(f.Importe, 14))
		b.WriteString("000,00")
		b.WriteString(strings.Repeat(" ", 10))
		b.WriteString("80")
		cuit := soloDigitos(f.Cuit)
		b.WriteString(cuit + strings.Repeat(" ", max(0, 20-len(cuit))))
		b.WriteString(strings.Repeat("0", 14))
		b.WriteString("\r\n")
	}
	return b.String()
}

// RetencionesParaSicore son las del período con lo que pide el TXT.
func (s *Servicio) RetencionesParaSicore(ctx context.Context, desde, hasta time.Time) ([]RetencionParaSicore, error) {
	filas, err := s.pool.Query(ctx, `
		SELECT r.fecha, r.numero, r.impuesto::text, r.codigo_regimen, r.base, r.importe, p.total, coalesce(s.cuit, ''),
		  CASE WHEN r.impuesto = 'ganancias' THEN coalesce(s.condicion_ganancias, '') <> 'no_inscripto' ELSE true END
		FROM retenciones_practicadas r JOIN suppliers s ON s.id = r.supplier_id JOIN supplier_payments p ON p.id = r.payment_id
		WHERE r.fecha >= $1 AND r.fecha < $2 AND r.anulada_at IS NULL ORDER BY r.fecha, r.numero`, desde, hasta)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, func(r pgx.CollectableRow) (RetencionParaSicore, error) {
		var x RetencionParaSicore
		var base, importe, total jsmath.Num
		err := r.Scan(&x.Fecha, &x.Numero, &x.Impuesto, &x.CodigoRegimen, &base, &importe, &total, &x.Cuit, &x.Inscripto)
		x.Base, x.Importe, x.TotalDelPago = float64(base), float64(importe), float64(total)
		return x, err
	})
}

// MesArgentino es el mes del período en hora argentina: un pago del 30 a
// las 22 es de ese mes, no del siguiente (M2S2-012, M2S3-004).
func MesArgentino(p Periodo) (time.Time, time.Time) {
	desde := time.Date(p.Anio, time.Month(p.Mes), 1, 0, 0, 0, 0, fiscal.Argentina)
	return desde, desde.AddDate(0, 1, 0)
}
