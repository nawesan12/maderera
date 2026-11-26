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
	"time"

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
	// PrecioLista es el de la lista del cliente, que pone el servidor (T3):
	// nil en un renglón sin variante o sin precio cargado.
	PrecioLista *float64 `json:"precioLista,omitempty"`
	// Corte es el despiece de la venta del que salió el renglón (su índice
	// en VentaPedida.Cortes): la placa, las pasadas y el tapacanto de cada
	// corte se controlan contra su propio plano (comité final, A2). Nil en
	// todo lo que no viene de un corte.
	Corte *int `json:"corte,omitempty"`
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
		// Los renglones guardan la cantidad con dos decimales: con una tercera
		// el papel diría 2,38 × precio y el subtotal sería el de 2,375.
		if math.Abs(float64(l.Cantidad*100)-jsmath.Round(float64(l.Cantidad*100))) > 1e-6 {
			return `La cantidad de "` + l.Descripcion + `" va con dos decimales como mucho.`
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
	if _, ok := cobros.LeerFechaDeCheque(c.FechaPago); !ok {
		return "La fecha de pago del cheque no existe."
	}
	return ""
}

// RevisarFechasDeCheques es el rango de cobros.RevisarFechaDeCheque para los
// cheques de una venta. Va aparte de RevisarPagos (el revisarPagos del TS,
// con su golden) porque depende de hoy.
func RevisarFechasDeCheques(pagos []PagoDeVenta, ahora time.Time) string {
	for _, p := range pagos {
		if p.Medio != Cheque || p.Cheque == nil {
			continue
		}
		if f, ok := cobros.LeerFechaDeCheque(p.Cheque.FechaPago); ok {
			if m := cobros.RevisarFechaDeCheque(f, ahora); m != "" {
				return m
			}
		}
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
//
// **Al centavo** (mes simulado, H425): el reparto redondea cada precio, y un
// descuento tipeado de $5.000 quedaba en $5.000,01 (3 × $87.033,33). Lo que
// sobra o falta lo toma un renglón de a uno; si no hay, uno de cantidad
// entera se parte en dos (q − 1 al precio repartido y 1 con el centavo). Si
// ni así cierra, queda el reparto de siempre.
func AplicarDescuento(lineas []LineaDeVenta, pedido float64) ([]LineaDeVenta, float64) {
	rebajadas, _, descuento := aplicarDescuento(lineas, pedido)
	return rebajadas, descuento
}

// EsElegibleParaLaEscala: el descuento por forma de pago va sobre lo que se
// vende del catálogo y el corte, no sobre un renglón a mano (un flete, una
// diferencia): el flete de $15.000 se guardaba a $13.500 (mes simulado,
// H168).
func EsElegibleParaLaEscala(l LineaDeVenta) bool { return l.VariantID != nil || l.Corte != nil }

// TodoEsElegible es la base de la escala con la regla descuento_al_flete en
// «si»: el descuento por forma de pago va también sobre el renglón a mano.
func TodoEsElegible(LineaDeVenta) bool { return true }

// FaltaLoteOCupon es el problema de un pago con tarjeta sin el lote o el
// cupón de la terminal (regla lote_y_cupon, H032). Vacío si no falta nada.
func FaltaLoteOCupon(pagos []PagoDeVenta) string {
	for _, p := range pagos {
		if p.Medio != "debito" && p.Medio != "credito" {
			continue
		}
		if p.NroLote == nil || strings.TrimSpace(*p.NroLote) == "" || p.NroCupon == nil || strings.TrimSpace(*p.NroCupon) == "" {
			return "Falta el lote o el cupón de la tarjeta."
		}
	}
	return ""
}

// AplicarDescuentoSobre reparte el descuento solo entre las líneas elegibles
// (el resto sale como está) y devuelve todas, en su orden.
func AplicarDescuentoSobre(lineas []LineaDeVenta, pedido float64, elegible func(LineaDeVenta) bool) ([]LineaDeVenta, float64) {
	var sub []LineaDeVenta
	for _, l := range lineas {
		if elegible(l) {
			sub = append(sub, l)
		}
	}
	rebajadas, origen, descuento := aplicarDescuento(sub, pedido)
	out := make([]LineaDeVenta, 0, len(lineas)+1)
	k, j := 0, 0
	for _, l := range lineas {
		if !elegible(l) {
			out = append(out, l)
			continue
		}
		for j < len(rebajadas) && origen[j] == k {
			out = append(out, rebajadas[j])
			j++
		}
		k++
	}
	return out, descuento
}

// aplicarDescuento devuelve además, por cada línea rebajada, el índice de la
// línea de entrada de la que sale (una partida da dos).
func aplicarDescuento(lineas []LineaDeVenta, pedido float64) ([]LineaDeVenta, []int, float64) {
	origen := make([]int, len(lineas))
	for i := range origen {
		origen[i] = i
	}
	total := TotalDeLaVenta(lineas)
	if pedido <= 0 || total <= 0 {
		return lineas, origen, 0
	}
	factor := math.Max(0, (total-pedido)/total)
	rebajadas := make([]LineaDeVenta, len(lineas))
	for i, l := range lineas {
		l.PrecioUnitario = ACentavos(float64(l.PrecioUnitario * factor))
		rebajadas[i] = l
	}
	rebajadas, origen = alCentavo(rebajadas, origen, ACentavos(math.Max(0, total-pedido)))
	return rebajadas, origen, ACentavos(total - TotalDeLaVenta(rebajadas))
}

// alCentavo lleva la suma de los renglones a `objetivo` (ver AplicarDescuento).
func alCentavo(ls []LineaDeVenta, origen []int, objetivo float64) ([]LineaDeVenta, []int) {
	r := ACentavos(objetivo - TotalDeLaVenta(ls))
	if r == 0 || objetivo <= 0 {
		return ls, origen
	}
	// Primero un renglón de a uno, después cualquiera cuya cantidad divida
	// la diferencia en centavos justos.
	for _, deAUno := range []bool{true, false} {
		for i, l := range ls {
			if (l.Cantidad == 1) != deAUno || !(l.Cantidad > 0) {
				continue
			}
			nuevo := ACentavos(l.PrecioUnitario + r/l.Cantidad)
			if nuevo <= 0 {
				continue
			}
			prueba := append([]LineaDeVenta{}, ls...)
			prueba[i].PrecioUnitario = nuevo
			if TotalDeLaVenta(prueba) == objetivo {
				return prueba, origen
			}
		}
	}
	// Un renglón de cantidad entera se parte: q − 1 como está y uno con la
	// diferencia.
	for i, l := range ls {
		if l.Cantidad < 2 || l.Cantidad != math.Trunc(l.Cantidad) {
			continue
		}
		uno := l
		uno.Cantidad = 1
		uno.PrecioUnitario = ACentavos(l.PrecioUnitario + r)
		if uno.PrecioUnitario <= 0 {
			continue
		}
		resto := l
		resto.Cantidad = l.Cantidad - 1
		prueba := append(append(append([]LineaDeVenta{}, ls[:i]...), resto, uno), ls[i+1:]...)
		if TotalDeLaVenta(prueba) == objetivo {
			o := append(append(append([]int{}, origen[:i]...), origen[i], origen[i]), origen[i+1:]...)
			return prueba, o
		}
	}
	return ls, origen
}

func espacioJS(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ', 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff:
		return true
	}
	return r >= 0x2000 && r <= 0x200a
}
