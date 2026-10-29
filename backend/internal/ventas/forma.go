package ventas

import (
	"errors"
	"sort"
	"strings"
	"sync"
	"time"

	"golang.org/x/text/collate"
	"golang.org/x/text/language"
	"golang.org/x/text/unicode/norm"

	"mjbj/internal/jsmath"
)

// --- lib/ventas/forma-de-venta.ts ---

// ProductoQueSeVende es lo que hace falta del producto para vender una línea.
type ProductoQueSeVende struct {
	Unit           string
	FormaDeVenta   string // entera | entera_o_media | metro_cuadrado
	PrecioMediaPct float64
	LargoMm        *int
	AnchoMm        *int
}

// EsPresentacion: media_largo o media_ancho.
func EsPresentacion(p *string) bool {
	return p != nil && (*p == "media_largo" || *p == "media_ancho")
}

// AdmiteMedia: una placa que se vende entera o por la mitad.
func AdmiteMedia(p ProductoQueSeVende) bool {
	return p.Unit == "placa" && p.FormaDeVenta == "entera_o_media"
}

// SeVendePorM2: una placa por metro cuadrado.
func SeVendePorM2(p ProductoQueSeVende) bool {
	return p.Unit == "placa" && p.FormaDeVenta == "metro_cuadrado"
}

// AreaDePlacaM2 es la superficie en m², o 0 si no tiene medidas.
func AreaDePlacaM2(largo, ancho *int) float64 {
	if largo == nil || ancho == nil || *largo <= 0 || *ancho <= 0 {
		return 0
	}
	return float64(float64(*largo)*float64(*ancho)) / 1_000_000
}

// ErrSinMedidas es el error de factorDeStock para la placa por m² sin medidas.
var ErrSinMedidas = errors.New("La placa se vende por m² pero la variante no tiene largo y ancho cargados.")

// FactorDeStock es cuánto stock descuenta cada unidad vendida.
func FactorDeStock(p ProductoQueSeVende, presentacion *string) (float64, error) {
	if presentacion != nil && *presentacion != "" && AdmiteMedia(p) {
		return 0.5, nil
	}
	if SeVendePorM2(p) {
		area := AreaDePlacaM2(p.LargoMm, p.AnchoMm)
		if area == 0 {
			return 0, ErrSinMedidas
		}
		return 1 / area, nil
	}
	return 1, nil
}

// CantidadDeStock es cantidadDeStock: a tres decimales.
func CantidadDeStock(v float64) float64 { return jsmath.Round(float64(v*1000)) / 1000 }

// UnidadesDeStock es cantidad × factor, a tres decimales.
func UnidadesDeStock(cantidad, stockPorUnidad float64) float64 {
	return CantidadDeStock(float64(cantidad * stockPorUnidad))
}

// PrecioDeMedia es el precio de media placa, al peso.
func PrecioDeMedia(precioEntera, pct float64) float64 {
	return jsmath.Round(float64(precioEntera*pct) / 100)
}

// NombreDePresentacion: «Media placa, al largo».
func NombreDePresentacion(p *string) string {
	if p == nil {
		return ""
	}
	switch *p {
	case "media_largo":
		return "Media placa, al largo"
	case "media_ancho":
		return "Media placa, al ancho"
	}
	return ""
}

// DescripcionConPresentacion: la descripción con la presentación al final.
func DescripcionConPresentacion(descripcion string, p *string) string {
	if n := NombreDePresentacion(p); n != "" {
		return descripcion + " — " + n
	}
	return descripcion
}

// --- lib/precios/medio-pago.ts ---

// EscalaDePago es un escalón de descuento por medio de pago.
type EscalaDePago struct {
	Medio      string  `json:"medio"`
	DesdeMonto float64 `json:"desdeMonto"`
	Porcentaje float64 `json:"porcentaje"`
	Etiqueta   string  `json:"etiqueta"`
}

const topeDescuento = 90

// DescuentoPorMedioDePago es el escalón más alto que el total alcanza (nil si
// no hay o es cero), con el porcentaje topeado en 90.
func DescuentoPorMedioDePago(escalas []EscalaDePago, medio string, total float64) *EscalaDePago {
	var aplicables []EscalaDePago
	for _, e := range escalas {
		if e.Medio == medio && total >= e.DesdeMonto {
			aplicables = append(aplicables, e)
		}
	}
	sort.SliceStable(aplicables, func(i, j int) bool {
		a, b := aplicables[i], aplicables[j]
		if a.DesdeMonto != b.DesdeMonto {
			return a.DesdeMonto > b.DesdeMonto
		}
		return a.Porcentaje > b.Porcentaje
	})
	if len(aplicables) == 0 || aplicables[0].Porcentaje <= 0 {
		return nil
	}
	e := aplicables[0]
	if e.Porcentaje > topeDescuento {
		e.Porcentaje = topeDescuento
	}
	return &e
}

// MontoDelDescuentoDePago es Math.round(total * min(p, 90)) / 100.
func MontoDelDescuentoDePago(total, porcentaje float64) float64 {
	if total <= 0 || porcentaje <= 0 {
		return 0
	}
	p := porcentaje
	if p > topeDescuento {
		p = topeDescuento
	}
	return jsmath.Round(float64(total*p)) / 100
}

var mediosMayorista = map[string]bool{"transferencia": true, "debito": true, "efectivo": true, "cuenta_corriente": true}

// MedioPermitido: el precio mayorista se paga de contado.
func MedioPermitido(medio string, mayorista bool) bool {
	return !mayorista || mediosMayorista[medio]
}

// --- lib/mostrador/offline/numero-provisorio.ts ---

const sieteDias = 7 * 24 * time.Hour

// FechaAcotada: nunca en el futuro y nunca más de una semana atrás.
func FechaAcotada(reclamada, ahora time.Time) time.Time {
	if reclamada.After(ahora) {
		return ahora
	}
	if reclamada.Before(ahora.Add(-sieteDias)) {
		return ahora.Add(-sieteDias)
	}
	return reclamada
}

// --- lib/mostrador/ranking-clientes.ts ---

// ClienteOrdenable es lo que mira el orden.
type ClienteOrdenable struct {
	ID          string
	Nombre      string
	RazonSocial *string
	Cuit        *string
}

func soloDigitos(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// Normalizar es normalizar de busqueda-local.ts: minúsculas, sin tildes, un
// espacio entre palabras.
func Normalizar(texto string) string {
	t := norm.NFD.String(strings.ToLower(texto))
	var b strings.Builder
	espacio := false
	for _, r := range t {
		if r >= 0x300 && r <= 0x36f {
			continue
		}
		if espacioJS(r) {
			if !espacio {
				b.WriteByte(' ')
			}
			espacio = true
			continue
		}
		espacio = false
		b.WriteRune(r)
	}
	return strings.TrimFunc(b.String(), espacioJS)
}

// PuntajeDeCliente: 0 el documento exacto, 1 el documento contenido, 2 el
// nombre que empieza, 3 una palabra que empieza, 4 el resto.
func PuntajeDeCliente(c ClienteOrdenable, consulta string) int {
	digitos := soloDigitos(consulta)
	cuit := ""
	if c.Cuit != nil {
		cuit = soloDigitos(*c.Cuit)
	}
	if len(digitos) >= 7 && cuit != "" && (cuit == digitos || cortar(cuit, 2, 10) == digitos) {
		return 0
	}
	if len(digitos) >= 4 && strings.Contains(cuit, digitos) {
		return 1
	}
	q := Normalizar(consulta)
	razon := ""
	if c.RazonSocial != nil {
		razon = *c.RazonSocial
	}
	nombres := []string{Normalizar(c.Nombre), Normalizar(razon)}
	for _, n := range nombres {
		if strings.HasPrefix(n, q) {
			return 2
		}
	}
	for _, n := range nombres {
		for _, p := range strings.Split(n, " ") {
			if strings.HasPrefix(p, q) {
				return 3
			}
		}
	}
	return 4
}

func cortar(s string, desde, hasta int) string {
	if desde > len(s) {
		return ""
	}
	if hasta > len(s) {
		hasta = len(s)
	}
	return s[desde:hasta]
}

var coladores = sync.Pool{New: func() any { return collate.New(language.Spanish) }}

// OrdenarClientes ordena por puntaje, después por cuán reciente se atendió y
// después por nombre (localeCompare "es").
func OrdenarClientes[T any](clientes []T, de func(T) ClienteOrdenable, consulta string, recientes []string) []T {
	lugar := map[string]int{}
	for i, id := range recientes {
		lugar[id] = i
	}
	type fila struct {
		c T
		o ClienteOrdenable
		p int
		r int
	}
	filas := make([]fila, len(clientes))
	for i, c := range clientes {
		o := de(c)
		r, ok := lugar[o.ID]
		if !ok {
			r = int(^uint(0) >> 1)
		}
		filas[i] = fila{c, o, PuntajeDeCliente(o, consulta), r}
	}
	col := coladores.Get().(*collate.Collator)
	defer coladores.Put(col)
	sort.SliceStable(filas, func(i, j int) bool {
		a, b := filas[i], filas[j]
		if a.p != b.p {
			return a.p < b.p
		}
		if a.r != b.r {
			return a.r < b.r
		}
		return col.CompareString(a.o.Nombre, b.o.Nombre) < 0
	})
	out := make([]T, len(filas))
	for i, f := range filas {
		out[i] = f.c
	}
	return out
}
