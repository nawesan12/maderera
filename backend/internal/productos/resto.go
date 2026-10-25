package productos

import (
	"context"
	"errors"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/plataforma"
	"mjbj/internal/sqlc"
	"mjbj/internal/subidas"
)

// --- rubros ---

// RubroDeCategoria es un rubro en la pantalla de rubros, con cuántos
// productos lo tienen asignado y cuántos lo nombran como texto sin tenerlo
// (lo que queda por enganchar de cuando el rubro era texto libre).
type RubroDeCategoria struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Slug      string `json:"slug"`
	Active    bool   `json:"active"`
	Productos int32  `json:"productos"`
	Sueltos   int32  `json:"sueltos"`
}

// CategoriaConRubros agrupa los rubros.
type CategoriaConRubros struct {
	ID     string             `json:"id"`
	Name   string             `json:"name"`
	Rubros []RubroDeCategoria `json:"rubros"`
}

// RubrosPorCategoria es rubrosPorCategoria.
func (s *Servicio) RubrosPorCategoria(ctx context.Context) ([]CategoriaConRubros, error) {
	cats, err := s.q.CategoriasOrdenadas(ctx)
	if err != nil {
		return nil, err
	}
	rubros, err := s.q.RubrosAdmin(ctx)
	if err != nil {
		return nil, err
	}
	conteos, err := s.q.ConteoPorRubro(ctx)
	if err != nil {
		return nil, err
	}
	sueltos, err := s.q.SueltosPorTexto(ctx)
	if err != nil {
		return nil, err
	}
	porRubro := map[string]int32{}
	for _, c := range conteos {
		if c.SubcategoryID != nil {
			porRubro[*c.SubcategoryID] = c.Cuantos
		}
	}
	porTexto := map[string]int32{}
	for _, x := range sueltos {
		porTexto[x.CategoryID+":"+x.Texto] = x.Cuantos
	}
	out := make([]CategoriaConRubros, 0, len(cats))
	for _, c := range cats {
		g := CategoriaConRubros{ID: c.ID, Name: c.Name, Rubros: []RubroDeCategoria{}}
		for _, r := range rubros {
			if r.CategoryID == c.ID {
				g.Rubros = append(g.Rubros, RubroDeCategoria{r.ID, r.Name, r.Slug, r.Active, porRubro[r.ID],
					porTexto[c.ID+":"+strings.ToLower(quitarTildes(r.Name))]})
			}
		}
		out = append(out, g)
	}
	return out, nil
}

// CrearRubro agrega uno al final de su categoría.
func (s *Servicio) CrearRubro(ctx context.Context, ses *auth.Sesion, categoria, nombre string) error {
	nombre = strings.TrimSpace(nombre)
	switch {
	case !plataforma.UUIDValido(categoria):
		return plataforma.Invalido(map[string]string{"categoryId": "Elegí una categoría."})
	case plataforma.LargoJS(nombre) < 2:
		return plataforma.Invalido(map[string]string{"name": "El nombre es muy corto."})
	case plataforma.LargoJS(nombre) > 80:
		return plataforma.Invalido(map[string]string{"name": demasiadoLargo(80)})
	}
	slug := GenerarSlug(nombre)
	if slug == "" {
		return plataforma.Invalido(map[string]string{"name": "Ese nombre no deja armar una dirección web."})
	}
	if _, err := s.q.RubroExiste(ctx, sqlc.RubroExisteParams{CategoryID: categoria, Slug: slug}); err == nil {
		return plataforma.Invalido(map[string]string{"name": "Esa categoría ya tiene un rubro con ese nombre."})
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	orden, err := s.q.SiguienteOrdenDeRubro(ctx, categoria)
	if err != nil {
		return err
	}
	id, err := s.q.CrearRubro(ctx, sqlc.CrearRubroParams{CategoryID: categoria, Slug: slug, Name: nombre, SortOrder: orden})
	if err != nil {
		return err
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCrear, "producto", id, `Creó el rubro "`+nombre+`"`, nil)
	return nil
}

// ActivarRubro lo da de baja o lo reactiva.
func (s *Servicio) ActivarRubro(ctx context.Context, ses *auth.Sesion, id string, activo bool) error {
	nombre, err := s.q.CambiarRubroActivo(ctx, sqlc.CambiarRubroActivoParams{ID: id, Active: activo})
	if errors.Is(err, pgx.ErrNoRows) {
		return plataforma.NuevoProblema(404, "Ese rubro no existe.")
	}
	if err != nil {
		return err
	}
	accion, verbo := sqlc.AccionAuditoriaEliminar, "Dio de baja"
	if activo {
		accion, verbo = sqlc.AccionAuditoriaEditar, "Reactivó"
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, accion, "producto", id, verbo+` el rubro "`+nombre+`"`, nil)
	return nil
}

// Enganchar les asigna el rubro a los productos de su categoría que lo
// nombran como texto y no tienen rubro. Devuelve el mensaje para la pantalla.
func (s *Servicio) Enganchar(ctx context.Context, id string) (string, error) {
	r, err := s.q.RubroPorID(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", plataforma.NuevoProblema(404, "Ese rubro no existe.")
	}
	if err != nil {
		return "", err
	}
	n, err := s.q.EngancharPorTexto(ctx, sqlc.EngancharPorTextoParams{Rubro: &r.ID, Categoria: r.CategoryID, Nombre: r.Name})
	if err != nil {
		return "", err
	}
	if n == 0 {
		return `No quedaba ningún producto suelto que dijera "` + r.Name + `".`, nil
	}
	plural := "s"
	if n == 1 {
		plural = ""
	}
	return strconv.FormatInt(n, 10) + " producto" + plural + " enganchado" + plural + ` a "` + r.Name + `".`, nil
}

// --- sugeridos ---

// Sugerido es uno cargado.
type Sugerido struct {
	ID               string  `json:"id"`
	RelatedProductID string  `json:"relatedProductId"`
	Nombre           string  `json:"nombre"`
	Categoria        string  `json:"categoria"`
	Imagen           *string `json:"imagen"`
	Activo           bool    `json:"activo"`
	Tipo             string  `json:"tipo"`
	Orden            int32   `json:"orden"`
}

// Sugeridos de un producto, por tipo y orden.
func (s *Servicio) Sugeridos(ctx context.Context, id string) ([]Sugerido, error) {
	filas, err := s.q.SugeridosDelProducto(ctx, id)
	if err != nil {
		return nil, err
	}
	out := make([]Sugerido, len(filas))
	for i, f := range filas {
		cat := "Sin categoría"
		if f.Categoria != nil {
			cat = *f.Categoria
		}
		out[i] = Sugerido{f.ID, f.RelatedProductID, f.Nombre, cat, nulo(f.Imagen), f.Activo, string(f.Tipo), f.Orden}
	}
	return out, nil
}

// AgregarSugerido lo suma al final de su tipo. Devuelve el mensaje.
func (s *Servicio) AgregarSugerido(ctx context.Context, ses *auth.Sesion, producto, sugerido, tipo string) (string, error) {
	if !plataforma.UUIDValido(sugerido) || (tipo != "complementario" && tipo != "similar") {
		return "", plataforma.Invalido(map[string]string{"relatedProductId": "Elegí un producto de la lista."})
	}
	if producto == sugerido {
		return "", plataforma.Invalido(map[string]string{"relatedProductId": "Un producto no puede sugerirse a sí mismo."})
	}
	nombre, err := s.q.NombreDeProducto(ctx, sugerido)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", plataforma.Invalido(map[string]string{"relatedProductId": "Ese producto ya no existe."})
	}
	if err != nil {
		return "", err
	}
	t := sqlc.TipoRelacionProducto(tipo)
	ultimo, err := s.q.UltimoOrdenSugerido(ctx, sqlc.UltimoOrdenSugeridoParams{ProductID: producto, Tipo: t})
	if err != nil {
		return "", err
	}
	_, err = s.q.AgregarSugerido(ctx, sqlc.AgregarSugeridoParams{ProductID: producto, RelatedProductID: sugerido, Tipo: t, Orden: ultimo + 1})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", plataforma.Invalido(map[string]string{"relatedProductId": nombre + " ya estaba en la lista."})
	}
	if err != nil {
		return "", err
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaEditar, "producto", producto, "Agregó "+nombre+" como "+tipo, nil)
	return nombre + " quedó como " + tipo + ".", nil
}

// QuitarSugerido saca una relación.
func (s *Servicio) QuitarSugerido(ctx context.Context, ses *auth.Sesion, producto, relacion string) error {
	n, err := s.q.QuitarSugerido(ctx, sqlc.QuitarSugeridoParams{ID: relacion, ProductID: producto})
	if err != nil {
		return err
	}
	if n == 0 {
		return plataforma.NuevoProblema(404, "Esa relación ya no estaba.")
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaEditar, "producto", producto, "Quitó un producto sugerido", nil)
	return nil
}

// --- imágenes ---

// SubirImagen la guarda y la suma al final de la galería.
func (s *Servicio) SubirImagen(ctx context.Context, producto string, datos []byte, tipo string) (id, url string, err error) {
	if len(datos) == 0 {
		return "", "", plataforma.Invalido(map[string]string{"archivo": "Elegí una imagen."})
	}
	if _, err := s.q.NombreDeProducto(ctx, producto); errors.Is(err, pgx.ErrNoRows) {
		return "", "", plataforma.NuevoProblema(404, "Falta el producto.")
	} else if err != nil {
		return "", "", err
	}
	url, err = s.disco.GuardarImagen(datos, tipo, "producto")
	var e *subidas.ErrSubida
	if errors.As(err, &e) {
		return "", "", plataforma.Invalido(map[string]string{"archivo": e.Mensaje})
	}
	if err != nil {
		return "", "", err
	}
	orden, err := s.q.SiguienteOrdenDeImagen(ctx, producto)
	if err == nil {
		id, err = s.q.CrearImagen(ctx, sqlc.CrearImagenParams{ProductID: producto, Url: url, SortOrder: orden})
	}
	if err != nil {
		_ = s.disco.Borrar(url)
		return "", "", err
	}
	return id, url, nil
}

// BorrarImagen la saca de la galería y del disco. Devuelve el producto.
func (s *Servicio) BorrarImagen(ctx context.Context, id string) (string, error) {
	img, err := s.q.ImagenPorID(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", plataforma.NuevoProblema(404, "Esa imagen ya no está.")
	}
	if err != nil {
		return "", err
	}
	if err := s.q.BorrarImagenDeProducto(ctx, id); err != nil {
		return "", err
	}
	if err := s.disco.Borrar(img.Url); err != nil {
		s.log.Warn("no se pudo borrar la imagen del disco", "url", img.Url, "error", err)
	}
	return img.ProductID, nil
}

// HacerPrincipal la pone primera y corre las demás, en una transacción.
func (s *Servicio) HacerPrincipal(ctx context.Context, id string) (string, error) {
	img, err := s.q.ImagenPorID(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", plataforma.NuevoProblema(404, "Esa imagen ya no está.")
	}
	if err != nil {
		return "", err
	}
	return img.ProductID, pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		todas, err := q.ImagenesDelProducto(ctx, img.ProductID)
		if err != nil {
			return err
		}
		orden := []string{id}
		for _, i := range todas {
			if i.ID != id {
				orden = append(orden, i.ID)
			}
		}
		for pos, iid := range orden {
			if err := q.OrdenarImagen(ctx, sqlc.OrdenarImagenParams{ID: iid, ProductID: img.ProductID, SortOrder: int32(pos)}); err != nil {
				return err
			}
		}
		return nil
	})
}
