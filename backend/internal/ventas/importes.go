// Package ventas son las reglas de una venta sin base de datos: los importes
// del mostrador (lib/mostrador/importes.ts), la forma de venta de las placas
// (lib/ventas/forma-de-venta.ts), el descuento por medio de pago
// (lib/precios/medio-pago.ts), la hora acotada de una venta sin conexión
// (lib/mostrador/offline/numero-provisorio.ts) y el orden de los clientes del
// buscador (lib/mostrador/ranking-clientes.ts). Todo con golden contra el TS
// (scripts/golden/ventas.ts): Go da lo mismo exacto.
//
// La plata va en float64 con jsmath, como el TS: float64(x*y)+z.
package ventas

import (
	"math"
	"regexp"
	"strings"

	"mjbj/internal/cobros"
	"mjbj/internal/jsmath"
)

// Los medios del mostrador (MedioDeMostrador).
const (
	Efectivo        = "efectivo"
	Debito          = "debito"
	Credito         = "credito"
	Transferencia   = "transferencia"
	CuentaCorriente = "cuenta_corriente"
	Cheque          = "cheque"
)

// MediosDeMostrador en el orden del enum de zod.
var MediosDeMostrador = []string{Efectivo, Debito, Credito, Transferencia, CuentaCorriente, Cheque}

// ChequeDePago es el cheque con el que se paga una venta.
type ChequeDePago struct {
	Tipo      string  `json:"tipo"` // fisico | echeq
	Numero    string  `json:"numero"`
	Banco     string  `json:"banco"`
	FechaPago string  `json:"fechaPago"` // AAAA-MM-DD
	Librador  *string `json:"librador,omitempty"`
}

// LineaDeVenta es un renglón. VariantID nil es una línea suelta.
type LineaDeVenta struct {
	VariantID      *string `json:"variantId"`
	Descripcion    string  `json:"descripcion"`
	Unidad         string  `json:"unidad"`
	Cantidad       float64 `json:"cantidad"`
	PrecioUnitario float64 `json:"precioUnitario"`
	Presentacion   *string `json:"presentacion,omitempty"`
}

// PagoDeVenta es un renglón de cómo se pagó.
type PagoDeVenta struct {
	Medio    string        `json:"medio"`
	Importe  float64       `json:"importe"`
	NroLote  *string       `json:"nroLote,omitempty"`
	NroCupon *string       `json:"nroCupon,omitempty"`
	Tarjeta  *string       `json:"tarjeta,omitempty"`
	Cuotas   *float64      `json:"cuotas,omitempty"`
	Cheque   *ChequeDePago `json:"cheque,omitempty"`
}

// ACentavos es Math.round(n * 100) / 100.
func ACentavos(n float64) float64 { return jsmath.Redondear2(n) }

func finito(n float64) bool { return !math.IsNaN(n) && !math.IsInf(n, 0) }

// TotalDeLaVenta redondea cada línea antes de sumarla.
func TotalDeLaVenta(lineas []LineaDeVenta) float64 {
	suma := 0.0
	for _, l := range lineas {
		suma += ACentavos(float64(l.Cantidad * l.PrecioUnitario))
	}
	return ACentavos(suma)
}

// RevisarVenta es revisarVenta: el motivo, o "" si está bien.
func RevisarVenta(lineas []LineaDeVenta, medio string, cliente *string) string {
	if len(lineas) == 0 {
		return "Todavía no cargaste nada para cobrar."
	}
	for _, l := range lineas {
		if !finito(l.Cantidad) || l.Cantidad <= 0 {
			return `La cantidad de "` + l.Descripcion + `" tiene que ser mayor a cero.`
		}
		if !finito(l.PrecioUnitario) || l.PrecioUnitario < 0 {
			return `El precio de "` + l.Descripcion + `" no puede ser negativo.`
		}
	}
	if TotalDeLaVenta(lineas) <= 0 {
		return "El total tiene que ser mayor a cero."
	}
	if medio == CuentaCorriente && cliente == nil {
		return "Para cargar a cuenta corriente hace falta elegir el cliente."
	}
	return ""
}

// NormalizarPagos deja los pagos que valen; sin ninguno, uno solo por el total.
func NormalizarPagos(pagos []PagoDeVenta, medio string, total float64) []PagoDeVenta {
	var con []PagoDeVenta
	for _, p := range pagos {
		if finito(p.Importe) && p.Importe > 0 {
			p.Importe = ACentavos(p.Importe)
			con = append(con, p)
		}
	}
	if len(con) == 0 {
		return []PagoDeVenta{{Medio: medio, Importe: total}}
	}
	return con
}

// RevisarPagos es revisarPagos.
func RevisarPagos(pagos []PagoDeVenta, total float64, cliente *string) string {
	if len(pagos) > 4 {
		return "Una venta no puede partirse en más de cuatro pagos."
	}
	s := 0.0
	for _, p := range pagos {
		s += p.Importe
	}
	suma := ACentavos(s)
	if math.Abs(suma-total) > 0.01 {
		return "Los pagos suman " + jsmath.ToFixed(suma, 2) + " y la venta es de " + jsmath.ToFixed(total, 2) + "."
	}
	if cliente == nil {
		for _, p := range pagos {
			if p.Medio == CuentaCorriente {
				return "Para cargar a cuenta corriente hace falta elegir el cliente."
			}
		}
	}
	for _, p := range pagos {
		if p.Medio != Cheque {
			continue
		}
		if problema := RevisarChequeDePago(p.Cheque); problema != "" {
			return problema
		}
	}
	return ""
}

var reFecha = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

// RevisarChequeDePago es revisarChequeDePago.
func RevisarChequeDePago(c *ChequeDePago) string {
	if c == nil {
		return "Faltan los datos del cheque: banco, número y fecha de pago."
	}
	if p := cobros.RevisarNumeroDeCheque(c.Numero); p != "" {
		return p
	}
	if strings.TrimFunc(c.Banco, espacioJS) == "" {
		return "Poné el banco del cheque."
	}
	if !reFecha.MatchString(c.FechaPago) {
		return "Poné la fecha de pago del cheque."
	}
	return ""
}

// MedioPrincipal es el medio por el que entró más plata (el primero si empatan).
func MedioPrincipal(pagos []PagoDeVenta) string {
	mayor := pagos[0]
	for _, p := range pagos[1:] {
		if p.Importe > mayor.Importe {
			mayor = p
		}
	}
	return mayor.Medio
}

// ImportePorMedio es cuánto entró por un medio.
func ImportePorMedio(pagos []PagoDeVenta, medio string) float64 {
	s := 0.0
	for _, p := range pagos {
		if p.Medio == medio {
			s += p.Importe
		}
	}
	return ACentavos(s)
}

// AplicarDescuento reparte el descuento entre las líneas y devuelve el que
// efectivamente quedó (ver el comentario largo del TS).
func AplicarDescuento(lineas []LineaDeVenta, pedido float64) ([]LineaDeVenta, float64) {
	total := TotalDeLaVenta(lineas)
	if pedido <= 0 || total <= 0 {
		return lineas, 0
	}
	factor := math.Max(0, (total-pedido)/total)
	rebajadas := make([]LineaDeVenta, len(lineas))
	for i, l := range lineas {
		l.PrecioUnitario = ACentavos(float64(l.PrecioUnitario * factor))
		rebajadas[i] = l
	}
	return rebajadas, ACentavos(total - TotalDeLaVenta(rebajadas))
}

func espacioJS(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ', 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff:
		return true
	}
	return r >= 0x2000 && r <= 0x200a
}
