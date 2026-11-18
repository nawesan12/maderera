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

// SoloQuienCompra devuelve el filtro por proveedor solo para quien entra a
// Compras. La pantalla ya lo escondía a los demás, pero la API lo aceptaba:
// con el id de un proveedor, un vendedor podía deducir qué le compra la
// maderera a quién.
func SoloQuienCompra(ctx context.Context, proveedor string) string {
	if proveedor == "" || !roles.PuedeEntrar("/admin/compras", auth.DeContexto(ctx).RolStaff) {
		return ""
	}
	return proveedor
}
