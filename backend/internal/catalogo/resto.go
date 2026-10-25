package catalogo

import (
	"context"
	"time"

	"mjbj/internal/sqlc"
)

// Categoria es una categoría con cuántos productos activos tiene.
type Categoria struct {
	ID           string  `json:"id"`
	Slug         string  `json:"slug"`
	Name         string  `json:"name"`
	Description  string  `json:"description"`
	Icon         *string `json:"icon"`
	Image        *string `json:"image"`
	ProductCount int32   `json:"productCount"`
}

// Categorias es listarCategorias.
func (s *Servicio) Categorias(ctx context.Context) ([]Categoria, error) {
	filas, err := s.q.Categorias(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]Categoria, len(filas))
	for i, f := range filas {
		out[i] = Categoria(f)
	}
	return out, nil
}

// Marca es una marca con su cantidad de productos.
type Marca struct {
	Nombre       string `json:"nombre"`
	ProductCount int32  `json:"productCount"`
}

// Marcas es marcasDelCatalogo (todas, o las de una categoría).
func (s *Servicio) Marcas(ctx context.Context, categoria string) ([]Marca, error) {
	var cat *string
	if categoria != "" {
		cat = &categoria
	}
	filas, err := s.q.Marcas(ctx, cat)
	if err != nil {
		return nil, err
	}
	out := make([]Marca, len(filas))
	for i, f := range filas {
		out[i] = Marca{Nombre: f.Nombre, ProductCount: f.ProductCount}
	}
	return out, nil
}

// Rubro es una subcategoría con productos.
type Rubro struct {
	Slug         string `json:"slug"`
	Name         string `json:"name"`
	ProductCount int32  `json:"productCount"`
}

// Rubros es rubrosDeCategoria: solo los que tienen algo cargado.
func (s *Servicio) Rubros(ctx context.Context, categoria string) ([]Rubro, error) {
	filas, err := s.q.RubrosDeCategoria(ctx, categoria)
	if err != nil {
		return nil, err
	}
	out := make([]Rubro, len(filas))
	for i, f := range filas {
		out[i] = Rubro(f)
	}
	return out, nil
}

// AnioFundacion es ANIO_FUNDACION (lib/empresa.ts).
const AnioFundacion = 1981

// Numeros son los de la página «Nosotros».
type Numeros struct {
	Anios      int   `json:"anios"`
	Productos  int32 `json:"productos"`
	Medidas    int32 `json:"medidas"`
	Sucursales int32 `json:"sucursales"`
	Rubros     int32 `json:"rubros"`
}

// NumerosDeLaEmpresa cuenta en una sola consulta. Los años, contra el
// calendario de Buenos Aires (getFullYear del TS corre en hora local del
// servidor, que es la de Argentina).
func (s *Servicio) NumerosDeLaEmpresa(ctx context.Context) (Numeros, error) {
	f, err := s.q.NumerosDeLaEmpresa(ctx)
	if err != nil {
		return Numeros{}, err
	}
	return Numeros{
		Anios: time.Now().In(argentina).Year() - AnioFundacion, Productos: f.Productos,
		Medidas: f.Medidas, Sucursales: f.Sucursales, Rubros: f.Rubros,
	}, nil
}

var argentina = func() *time.Location {
	l, err := time.LoadLocation("America/Argentina/Buenos_Aires")
	if err != nil {
		return time.FixedZone("ART", -3*3600)
	}
	return l
}()

// Sugeridos son los de la ficha.
type Sugeridos struct {
	Complementarios       []ProductoListado `json:"complementarios"`
	Similares             []ProductoListado `json:"similares"`
	SimilaresPorCategoria bool              `json:"similaresPorCategoria"`
}

// Sugeridos es productosSugeridos: los que cargó el vendedor, en su orden; si
// no cargó similares, otros de la misma categoría. A precio de público, como
// la ficha que los muestra.
func (s *Servicio) Sugeridos(ctx context.Context, productID, categoria, excluirSlug string, limite int) (Sugeridos, error) {
	vinculos, err := s.q.Vinculos(ctx, productID)
	if err != nil {
		return Sugeridos{}, err
	}
	var comp, sim []string
	for _, v := range vinculos {
		switch v.Tipo {
		case sqlc.TipoRelacionProductoComplementario:
			comp = append(comp, v.RelatedProductID)
		case sqlc.TipoRelacionProductoSimilar:
			sim = append(sim, v.RelatedProductID)
		}
	}
	general, err := s.General(ctx)
	if err != nil {
		return Sugeridos{}, err
	}
	cargados, err := s.Productos(ctx, Filtros{IDs: append(append([]string{}, comp...), sim...)}, general)
	if err != nil {
		return Sugeridos{}, err
	}
	enOrden := func(ids []string) []ProductoListado {
		out := []ProductoListado{}
		for _, id := range ids {
			for _, p := range cargados {
				if p.ID == id {
					out = append(out, p)
					break
				}
			}
			if len(out) == limite {
				break
			}
		}
		return out
	}
	r := Sugeridos{Complementarios: enOrden(comp), Similares: enOrden(sim), SimilaresPorCategoria: len(sim) == 0}
	if len(r.Similares) == 0 {
		r.Similares = []ProductoListado{}
		if len(sim) == 0 {
			deCategoria, err := s.Productos(ctx, Filtros{Categoria: categoria}, general)
			if err != nil {
				return Sugeridos{}, err
			}
			for _, p := range deCategoria {
				if p.Slug != excluirSlug && len(r.Similares) < limite {
					r.Similares = append(r.Similares, p)
				}
			}
		}
	}
	return r, nil
}

// Complementos es complementosDelCarrito: los complementarios de lo que ya
// está en el carrito, sin lo que ya está, con stock, a la lista de quien mira.
func (s *Servicio) Complementos(ctx context.Context, variantes []string, limite int, lista Lista) ([]ProductoListado, error) {
	var ids []string
	for _, v := range variantes {
		if v != "" {
			ids = append(ids, v)
		}
	}
	if len(ids) == 0 {
		return []ProductoListado{}, nil
	}
	propios, err := s.q.ProductosDeVariantes(ctx, ids)
	if err != nil || len(propios) == 0 {
		return []ProductoListado{}, err
	}
	vinculos, err := s.q.ComplementariosDe(ctx, propios)
	if err != nil {
		return nil, err
	}
	yaEsta := map[string]bool{}
	for _, p := range propios {
		yaEsta[p] = true
	}
	var candidatos []string
	for _, v := range vinculos {
		if !yaEsta[v] {
			yaEsta[v] = true // también saca los repetidos
			candidatos = append(candidatos, v)
		}
	}
	if len(candidatos) == 0 {
		return []ProductoListado{}, nil
	}
	productos, err := s.Productos(ctx, Filtros{IDs: candidatos}, lista)
	if err != nil {
		return nil, err
	}
	out := []ProductoListado{}
	for _, p := range productos {
		if p.HayStock && len(out) < limite {
			out = append(out, p)
		}
	}
	return out, nil
}

// Portada es datosDePortada.
type Portada struct {
	Categorias     []Categoria       `json:"categorias"`
	Ofertas        []ProductoListado `json:"ofertas"`
	Destacados     []ProductoListado `json:"destacados"`
	TotalProductos int               `json:"totalProductos"`
	ConStock       int               `json:"conStock"`
}

// Portada arma todo lo de la portada de una pasada, a precio de público.
func (s *Servicio) Portada(ctx context.Context) (Portada, error) {
	cats, err := s.Categorias(ctx)
	if err != nil {
		return Portada{}, err
	}
	general, err := s.General(ctx)
	if err != nil {
		return Portada{}, err
	}
	todos, err := s.Productos(ctx, Filtros{}, general)
	if err != nil {
		return Portada{}, err
	}
	p := Portada{Categorias: cats, Ofertas: []ProductoListado{}, Destacados: []ProductoListado{}, TotalProductos: len(todos)}
	enOfertas := map[string]bool{}
	for _, x := range todos {
		if x.Descuento != nil && len(p.Ofertas) < 4 {
			p.Ofertas = append(p.Ofertas, x)
			enOfertas[x.ID] = true
		}
		if x.HayStock {
			p.ConStock++
		}
	}
	for _, x := range todos {
		if x.Featured && x.HayStock && !enOfertas[x.ID] && len(p.Destacados) < 4 {
			p.Destacados = append(p.Destacados, x)
		}
	}
	// Sin destacados, la sección se llena con lo que hay en stock: una portada
	// con un hueco se lee como que algo falló.
	if len(p.Destacados) == 0 {
		for _, x := range todos {
			if x.HayStock && len(p.Destacados) < 4 {
				p.Destacados = append(p.Destacados, x)
			}
		}
	}
	return p, nil
}
