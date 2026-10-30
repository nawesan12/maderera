// Package productos es la gestión de productos del panel: la ficha (con sus
// medidas, precios y stock), las imágenes, los sugeridos, los rubros y los
// candidatos a dar de baja. Era app/admin/productos y lib/dal/admin/products.ts.
package productos

import (
	"math"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"golang.org/x/text/unicode/norm"

	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
)

// FormProducto es lo que manda el formulario, todo como texto, igual que lo
// leía parsearFormulario del TS. Lo vacío de los opcionales es «no vino».
type FormProducto struct {
	ID                    string         `json:"id"`
	Name                  string         `json:"name"`
	Slug                  string         `json:"slug"`
	CategoryID            string         `json:"categoryId"`
	Subcategory           string         `json:"subcategory"`
	SubcategoryID         string         `json:"subcategoryId"`
	Description           string         `json:"description"`
	Brand                 string         `json:"brand"`
	Unit                  string         `json:"unit"`
	FormaDeVenta          string         `json:"formaDeVenta"`
	PrecioMediaPct        string         `json:"precioMediaPct"`
	AlicuotaIva           string         `json:"alicuotaIva"`
	RecargoElaboracionPct string         `json:"recargoElaboracionPct"`
	Imputacion            string         `json:"imputacion"`
	Featured              bool           `json:"featured"`
	APedido               bool           `json:"aPedido"`
	Active                bool           `json:"active"`
	Imagen                string         `json:"imagen"`
	Variantes             []FormVariante `json:"variantes"`
}

// FormVariante es una medida o presentación, como texto.
type FormVariante struct {
	ID                string `json:"id"`
	SKU               string `json:"sku"`
	Label             string `json:"label"`
	LargoMm           string `json:"largoMm"`
	AnchoMm           string `json:"anchoMm"`
	EspesorMm         string `json:"espesorMm"`
	Material          string `json:"material"`
	Color             string `json:"color"`
	Terminacion       string `json:"terminacion"`
	Calidad           string `json:"calidad"`
	PrecioGeneral     string `json:"precioGeneral"`
	PrecioProfesional string `json:"precioProfesional"`
	StockCentral      string `json:"stockCentral"`
	StockAserradero   string `json:"stockAserradero"`
	MinCentral        string `json:"minCentral"`
	MinAserradero     string `json:"minAserradero"`
	// Lo que había cuando se abrió la ficha: el stock se corrige por
	// diferencia contra esto, no se pisa con un valor viejo.
	StockCentralVisto    string `json:"stockCentralVisto"`
	StockAserraderoVisto string `json:"stockAserraderoVisto"`
}

// Producto es la ficha ya validada (lo que daba productoSchema).
type Producto struct {
	ID, Name, Slug, CategoryID                    string
	Subcategory, SubcategoryID, Brand, Imputacion *string
	Description, Unit, FormaDeVenta, AlicuotaIva  string
	PrecioMediaPct                                float64
	RecargoElaboracionPct                         *float64
	Featured, APedido, Active                     bool
	Imagen                                        string
	Variantes                                     []Variante
}

// Variante ya validada. Las medidas en mm pueden faltar; las cantidades,
// redondeadas a 3 decimales como cantidadDeStock.
type Variante struct {
	ID, SKU, Label                        string
	LargoMm, AnchoMm, EspesorMm           *float64
	Material, Color, Terminacion, Calidad string
	PrecioGeneral, PrecioProfesional      string
	StockCentral, StockAserradero         *float64
	MinCentral, MinAserradero             *float64
	// nil: no vino (un alta, o quien no lo manda).
	StockCentralVisto, StockAserraderoVisto *float64
}

// visto lee lo que la pantalla vio al abrir la ficha. No es un dato del
// usuario: si no se entiende, es como si no hubiera venido.
func visto(s string) *float64 {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	n := jsmath.Numero(reemplazarComa(s))
	if math.IsNaN(n) || math.IsInf(n, 0) {
		return nil
	}
	n = jsmath.Round(n*1000) / 1000
	return &n
}

// UnidadesDeProducto en el orden del enum del TS.
var UnidadesDeProducto = []string{"unidad", "metro_lineal", "metro_cuadrado", "tabla", "placa", "rollo", "par", "juego", "kg", "litro"}

// AdmiteDecimales: las unidades que se fraccionan (lib/unidades.ts).
func AdmiteDecimales(u string) bool {
	switch u {
	case "metro_lineal", "metro_cuadrado", "placa", "kg", "litro":
		return true
	}
	return false
}

// ErrorDeCampo es el primer problema del formulario, como issues[0] de zod:
// el mensaje y el camino del campo («variantes.0.sku»).
type ErrorDeCampo struct{ Mensaje, Campo string }

func (e *ErrorDeCampo) Error() string { return e.Mensaje }

// Problema lo pasa a problem+json con el campo, que el formulario resalta.
func (e *ErrorDeCampo) Problema() *plataforma.Problema {
	return plataforma.Invalido(map[string]string{e.Campo: e.Mensaje})
}

var reSlug = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

// validador junta los problemas en el orden en que zod los encuentra y se
// queda con el primero.
type validador struct{ primero *ErrorDeCampo }

func (v *validador) mal(campo, mensaje string) {
	if v.primero == nil {
		v.primero = &ErrorDeCampo{mensaje, campo}
	}
}

func demasiadoLargo(n int) string {
	return "Too big: expected string to have <=" + strconv.Itoa(n) + " characters"
}

func (v *validador) texto(campo, s string, min, max int, msjMin string) string {
	s = strings.TrimSpace(s)
	switch largo := plataforma.LargoJS(s); {
	case largo < min:
		if msjMin == "" {
			msjMin = "Too small: expected string to have >=" + strconv.Itoa(min) + " characters"
		}
		v.mal(campo, msjMin)
	case max > 0 && largo > max:
		v.mal(campo, demasiadoLargo(max))
	}
	return s
}

// opcional es un texto con trim y tope que puede no venir: "" es nil.
func (v *validador) opcional(campo, s string, max int) *string {
	if s == "" {
		return nil
	}
	t := v.texto(campo, s, 0, max, "")
	return &t
}

func positivo(n float64) bool { return !math.IsNaN(n) && !math.IsInf(n, 0) && n >= 0 }

// reemplazarComa es .replace(",", ".") de JS: solo la primera.
func reemplazarComa(s string) string { return strings.Replace(s, ",", ".", 1) }

func (v *validador) entero(campo, s string) *float64 {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	n := jsmath.Numero(s)
	if !positivo(n) {
		v.mal(campo, "Tiene que ser un número positivo.")
		return nil
	}
	return &n
}

func (v *validador) cantidad(campo, s string) *float64 {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	n := jsmath.Numero(reemplazarComa(s))
	if !positivo(n) {
		v.mal(campo, "Tiene que ser un número positivo.")
		return nil
	}
	n = jsmath.Round(n*1000) / 1000
	return &n
}

func (v *validador) precio(campo, s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return "0"
	}
	s = reemplazarComa(s)
	if !positivo(jsmath.Numero(s)) {
		v.mal(campo, "Revisá el precio.")
	}
	return s
}

func (v *validador) uuid(campo, s, mensaje string) {
	if !plataforma.UUIDValido(s) {
		if mensaje == "" {
			mensaje = "Invalid UUID"
		}
		v.mal(campo, mensaje)
	}
}

// urlValida: lo que aceptaba z.string().url(), pero solo http y https (zod
// también deja pasar «javascript:…»; el mensaje ya pide https).
func urlValida(s string) bool {
	u, err := url.Parse(s)
	return err == nil && (u.Scheme == "https" || u.Scheme == "http") && u.Host != "" && !strings.ContainsAny(s, " \t\n")
}

// Validar es productoSchema.safeParse sobre lo que armaba parsearFormulario.
func Validar(f FormProducto) (Producto, *ErrorDeCampo) {
	var v validador
	p := Producto{Featured: f.Featured, APedido: f.APedido, Active: f.Active}

	if f.ID != "" {
		v.uuid("id", f.ID, "")
		p.ID = f.ID
	}
	p.Name = v.texto("name", f.Name, 2, 160, "El nombre es obligatorio.")
	p.Slug = strings.TrimSpace(f.Slug)
	switch largo := plataforma.LargoJS(p.Slug); {
	case largo < 2:
		v.mal("slug", "Too small: expected string to have >=2 characters")
	case largo > 160:
		v.mal("slug", demasiadoLargo(160))
	case !reSlug.MatchString(p.Slug):
		v.mal("slug", "Solo se pueden usar minúsculas, números y guiones (sin espacios ni acentos).")
	}
	v.uuid("categoryId", f.CategoryID, "Elegí una categoría.")
	p.CategoryID = f.CategoryID
	p.Subcategory = v.opcional("subcategory", f.Subcategory, 80)
	if f.SubcategoryID != "" {
		v.uuid("subcategoryId", f.SubcategoryID, "")
		p.SubcategoryID = &f.SubcategoryID
	}
	p.Description = v.texto("description", f.Description, 0, 2000, "")
	p.Brand = v.opcional("brand", f.Brand, 80)

	p.Unit = f.Unit
	unidadValida := false
	for _, u := range UnidadesDeProducto {
		unidadValida = unidadValida || u == f.Unit
	}
	if !unidadValida {
		v.mal("unit", `Invalid option: expected one of "unidad"|"metro_lineal"|"metro_cuadrado"|"tabla"|"placa"|"rollo"|"par"|"juego"|"kg"|"litro"`)
	}
	p.FormaDeVenta = f.FormaDeVenta
	if p.FormaDeVenta == "" {
		p.FormaDeVenta = "entera"
	}
	if p.FormaDeVenta != "entera" && p.FormaDeVenta != "entera_o_media" && p.FormaDeVenta != "metro_cuadrado" {
		v.mal("formaDeVenta", `Invalid option: expected one of "entera"|"entera_o_media"|"metro_cuadrado"`)
	}
	media := reemplazarComa(f.PrecioMediaPct)
	if f.PrecioMediaPct == "" {
		media = "50"
	}
	switch p.PrecioMediaPct = jsmath.Numero(media); {
	case math.IsNaN(p.PrecioMediaPct):
		v.mal("precioMediaPct", "Invalid input: expected number, received NaN")
	case p.PrecioMediaPct < 1:
		v.mal("precioMediaPct", "El precio de la media tiene que ser mayor a cero.")
	case p.PrecioMediaPct > 100:
		v.mal("precioMediaPct", "La media no puede costar más que la entera.")
	}
	p.AlicuotaIva = f.AlicuotaIva
	if p.AlicuotaIva == "" {
		p.AlicuotaIva = "21"
	}
	if p.AlicuotaIva != "21" && p.AlicuotaIva != "10.5" && p.AlicuotaIva != "0" {
		// El orden es el de las claves de un objeto JS: primero las que
		// parecen enteros.
		v.mal("alicuotaIva", `Invalid option: expected one of "0"|"21"|"10.5"`)
	}
	if f.RecargoElaboracionPct != "" {
		switch r := jsmath.Numero(f.RecargoElaboracionPct); {
		case math.IsNaN(r):
			v.mal("recargoElaboracionPct", "Invalid input: expected number, received NaN")
		case r < 0:
			v.mal("recargoElaboracionPct", "Too small: expected number to be >=0")
		case r > 500:
			v.mal("recargoElaboracionPct", "Too big: expected number to be <=500")
		default:
			p.RecargoElaboracionPct = &r
		}
	}
	p.Imputacion = v.opcional("imputacion", f.Imputacion, 80)
	// .trim().url().or(z.literal("")): el literal se compara sin recortar.
	if f.Imagen != "" {
		p.Imagen = strings.TrimSpace(f.Imagen)
		if !urlValida(p.Imagen) {
			v.mal("imagen", "Pegá la dirección completa de la foto; tiene que empezar con https://")
		}
	}

	if len(f.Variantes) == 0 {
		v.mal("variantes", "Cargá al menos una medida o presentación.")
	}
	for i, fv := range f.Variantes {
		c := "variantes." + strconv.Itoa(i) + "."
		var x Variante
		if fv.ID != "" {
			v.uuid(c+"id", fv.ID, "")
			x.ID = fv.ID
		}
		x.SKU = v.texto(c+"sku", fv.SKU, 2, 60, "El código tiene que tener al menos 2 letras o números.")
		x.Label = v.texto(c+"label", fv.Label, 1, 120, "Poné cómo se muestra la medida.")
		x.LargoMm = v.entero(c+"largoMm", fv.LargoMm)
		x.AnchoMm = v.entero(c+"anchoMm", fv.AnchoMm)
		x.EspesorMm = v.entero(c+"espesorMm", fv.EspesorMm)
		x.Material = v.texto(c+"material", fv.Material, 0, 80, "")
		x.Color = v.texto(c+"color", fv.Color, 0, 80, "")
		x.Terminacion = v.texto(c+"terminacion", fv.Terminacion, 0, 80, "")
		x.Calidad = v.texto(c+"calidad", fv.Calidad, 0, 80, "")
		x.PrecioGeneral = v.precio(c+"precioGeneral", fv.PrecioGeneral)
		x.PrecioProfesional = v.precio(c+"precioProfesional", fv.PrecioProfesional)
		x.StockCentral = v.cantidad(c+"stockCentral", fv.StockCentral)
		x.StockAserradero = v.cantidad(c+"stockAserradero", fv.StockAserradero)
		x.MinCentral = v.cantidad(c+"minCentral", fv.MinCentral)
		x.MinAserradero = v.cantidad(c+"minAserradero", fv.MinAserradero)
		if x.ID != "" {
			x.StockCentralVisto = visto(fv.StockCentralVisto)
			x.StockAserraderoVisto = visto(fv.StockAserraderoVisto)
		}
		p.Variantes = append(p.Variantes, x)
	}
	if v.primero != nil {
		return Producto{}, v.primero
	}

	// El superRefine: solo corre si lo de arriba validó.
	if p.Unit == "placa" && p.FormaDeVenta == "metro_cuadrado" {
		for i, x := range p.Variantes {
			if x.LargoMm == nil || *x.LargoMm == 0 || x.AnchoMm == nil || *x.AnchoMm == 0 {
				nombre := x.Label
				if nombre == "" {
					nombre = x.SKU
				}
				v.mal("variantes."+strconv.Itoa(i)+".largoMm", "Para vender por m², «"+nombre+"» necesita largo y ancho de la placa.")
			}
		}
	}
	if !AdmiteDecimales(p.Unit) {
		for i, x := range p.Variantes {
			for _, c := range []struct {
				nombre string
				valor  *float64
			}{{"stockCentral", x.StockCentral}, {"stockAserradero", x.StockAserradero}, {"minCentral", x.MinCentral}, {"minAserradero", x.MinAserradero}} {
				if c.valor != nil && *c.valor != math.Trunc(*c.valor) {
					v.mal("variantes."+strconv.Itoa(i)+"."+c.nombre, "Este producto se cuenta en unidades enteras: el stock va sin decimales.")
				}
			}
		}
	}
	if v.primero != nil {
		return Producto{}, v.primero
	}
	return p, nil
}

// GenerarSlug es generarSlug: sin tildes, minúsculas y guiones.
func GenerarSlug(s string) string {
	s = strings.ToLower(quitarTildes(s))
	var b strings.Builder
	guion := false
	for _, r := range s {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' {
			if guion && b.Len() > 0 {
				b.WriteByte('-')
			}
			guion = false
			b.WriteRune(r)
		} else {
			guion = true
		}
	}
	return b.String()
}

// quitarTildes es normalize("NFD") y sacar las marcas combinantes.
func quitarTildes(s string) string {
	var b strings.Builder
	for _, r := range norm.NFD.String(s) {
		if r >= 0x300 && r <= 0x36f {
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}
