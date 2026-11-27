// Package listado arma los WHERE de los listados largos del panel (productos,
// precios y stock): la búsqueda por palabras, los filtros por categoría,
// marca y proveedor, y la página.
//
// Antes cada listado traía todo y Next filtraba y recortaba. Con el
// inventario entero cargado son miles de filas por pantalla: el filtro y la
// página van en la consulta, y lo que viaja es una página y los totales.
package listado

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"mjbj/internal/auth"
	"mjbj/internal/plataforma"
	"mjbj/internal/roles"
)

// Filtros son los de la URL de las tres pantallas.
type Filtros struct {
	Busqueda  string
	Categoria string
	// Estado es propio de cada pantalla («sin-precio», «sin-stock»…); lo
	// interpreta cada servicio.
	Estado    string
	Marca     string
	Proveedor string
	Limite    int
	Desde     int
}

// SoloQuienCompra borra el filtro por proveedor si la sesión no entra a
// Compras: qué medida trae cada proveedor es información de compras, y filtrar
// por él dejaría deducirla desde otra pantalla.
func SoloQuienCompra(ses *auth.Sesion, f *Filtros) {
	if ses == nil || !roles.PuedeEntrar("/admin/compras", ses.RolStaff) {
		f.Proveedor = ""
	}
}

// Pagina normaliza el límite y el desplazamiento: sin límite, el de la
// pantalla; nunca más de 200 ni un desplazamiento negativo.
func (f Filtros) Pagina(porOmision int) (limite, desde int) {
	limite, desde = f.Limite, f.Desde
	if limite <= 0 {
		limite = porOmision
	}
	if limite > 200 {
		limite = 200
	}
	if desde < 0 {
		desde = 0
	}
	return limite, desde
}

// Consulta junta condiciones y argumentos numerados ($1, $2…).
type Consulta struct {
	cond []string
	args []any
}

// Arg suma un argumento y devuelve su marcador.
func (c *Consulta) Arg(v any) string {
	c.args = append(c.args, v)
	return fmt.Sprintf("$%d", len(c.args))
}

// Y suma una condición.
func (c *Consulta) Y(cond string) { c.cond = append(c.cond, cond) }

// Args son los argumentos, en orden.
func (c *Consulta) Args() []any { return c.args }

// Donde es «WHERE …», o "" sin condiciones.
func (c *Consulta) Donde() string {
	if len(c.cond) == 0 {
		return ""
	}
	return "WHERE " + strings.Join(c.cond, " AND ")
}

// Terminos son las palabras de la búsqueda: hasta seis, como coincideBusqueda.
func Terminos(texto string) []string {
	t := strings.Fields(texto)
	if len(t) > 6 {
		t = t[:6]
	}
	return t
}

// Busqueda exige que cada palabra aparezca en alguna de las columnas, sin
// tildes. `exacto` suma columnas que tienen que coincidir enteras (el código
// de barras: el lector escribe el número completo).
func (c *Consulta) Busqueda(texto string, columnas []string, exacto ...string) {
	for _, t := range Terminos(texto) {
		patron := c.Arg("%" + t + "%")
		var col []string
		for _, x := range columnas {
			col = append(col, "f_unaccent("+x+") ILIKE f_unaccent("+patron+")")
		}
		for _, x := range exacto {
			col = append(col, x+" = "+c.Arg(t))
		}
		c.Y("(" + strings.Join(col, " OR ") + ")")
	}
}

// compactar es la forma en que se escribe una medida «a la apurada»: sin
// espacios, comillas ni tildes, y con «×» como «x». Así «2x4» encuentra el
// `Tirante Pino 2" x 4"` (mes simulado, H221), que es como lo pide todo el
// mundo. La misma expresión se aplica al texto de la fila y al término.
func compactar(expr string) string {
	return `regexp_replace(translate(lower(f_unaccent(` + expr + `)), '×', 'x'), '[[:space:]"''´` + "`" + `]+', '', 'g')`
}

// BusquedaFlexible es Busqueda, y además cada palabra puede coincidir con
// las columnas pegadas y compactadas (ver compactar).
func (c *Consulta) BusquedaFlexible(texto string, columnas []string, exacto ...string) {
	pegadas := "concat_ws(' ', " + strings.Join(columnas, ", ") + ")"
	for _, t := range Terminos(texto) {
		patron := c.Arg("%" + t + "%")
		var col []string
		for _, x := range columnas {
			col = append(col, "f_unaccent("+x+") ILIKE f_unaccent("+patron+")")
		}
		col = append(col, compactar(pegadas)+" LIKE '%' || "+compactar(c.Arg(t)+"::text")+" || '%'")
		for _, x := range exacto {
			col = append(col, x+" = "+c.Arg(t))
		}
		c.Y("(" + strings.Join(col, " OR ") + ")")
	}
}

// PrimeroPalabrasEnteras es una expresión para ORDER BY … DESC: cuántas
// palabras de la búsqueda arrancan una palabra de `expr`. Buscando «laca»,
// la Laca va antes que las placas, que la contienen en el medio (H295).
//
// Y cuántas coinciden enteras, sin otra cifra pegada: buscando «MDF 18», el
// «18» arrancaba también el «1830» de la placa de 3 mm, que salía primero y
// Enter la elegía (mes simulado, M3S3-049). El «18mm» sí cuenta.
func (c *Consulta) PrimeroPalabrasEnteras(texto, expr string) string {
	var partes []string
	for _, t := range Terminos(texto) {
		arg := c.Arg(regexp.QuoteMeta(t))
		partes = append(partes, "(f_unaccent("+expr+") ~* ('\\m' || f_unaccent("+arg+"::text)))::int",
			"(f_unaccent("+expr+") ~* ('\\m' || f_unaccent("+arg+"::text) || '(?![0-9])'))::int")
	}
	if len(partes) == 0 {
		// «0» a secas en un ORDER BY es «la columna cero»: un error.
		return "0::int"
	}
	return strings.Join(partes, " + ")
}

// Comunes suma categoría, marca y proveedor. `variante` es la expresión que
// identifica la medida para el proveedor: «v.id» en los listados por medida;
// vacío en el de productos, donde basta con que lo provea una de sus medidas.
func (c *Consulta) Comunes(f Filtros, variante string) {
	if f.Categoria != "" && f.Categoria != "todos" {
		c.Y("c.slug = " + c.Arg(f.Categoria))
	}
	if m := strings.TrimSpace(f.Marca); m != "" && m != "todas" {
		c.Y("lower(trim(p.brand)) = lower(" + c.Arg(m) + ")")
	}
	if f.Proveedor != "" && f.Proveedor != "todos" {
		// Un proveedor que no es un uuid no provee nada: la lista sale vacía
		// en vez de un 500 por el cast.
		if !plataforma.UUIDValido(f.Proveedor) {
			c.Y("false")
			return
		}
		prov := c.Arg(f.Proveedor)
		if variante != "" {
			c.Y("EXISTS (SELECT 1 FROM supplier_variant_codes sc WHERE sc.variant_id = " + variante + " AND sc.supplier_id = " + prov + "::uuid)")
		} else {
			c.Y("EXISTS (SELECT 1 FROM supplier_variant_codes sc JOIN product_variants pv ON pv.id = sc.variant_id WHERE pv.product_id = p.id AND sc.supplier_id = " + prov + "::uuid)")
		}
	}
}

// ProveedorSiCompra es SoloQuienCompra para quien tiene el contexto y el
// filtro suelto: los listados de productos, precios y stock.
func ProveedorSiCompra(ctx context.Context, proveedor string) string {
	f := Filtros{Proveedor: proveedor}
	SoloQuienCompra(auth.DeContexto(ctx), &f)
	return f.Proveedor
}
