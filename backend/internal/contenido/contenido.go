// Package contenido es lo que la maderera edita del sitio sin un despliegue:
// los ajustes (textos, teléfonos), las promociones bancarias, los banners y
// las reseñas de productos. Es lib/dal/contenido.ts, banners.ts, resenas.ts y
// las acciones de app/admin/contenido, con las mismas formas de respuesta.
package contenido

import (
	"context"
	"errors"
	"log/slog"
	"math"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
	"mjbj/internal/sqlc"
	"mjbj/internal/subidas"
)

// Servicio lee y edita el contenido.
type Servicio struct {
	pool  *pgxpool.Pool
	q     *sqlc.Queries
	disco *subidas.Disco
	log   *slog.Logger
}

// Nuevo arma el servicio.
func Nuevo(pool *pgxpool.Pool, disco *subidas.Disco, log *slog.Logger) *Servicio {
	return &Servicio{pool: pool, q: sqlc.New(pool), disco: disco, log: log}
}

var argentina = func() *time.Location {
	l, err := time.LoadLocation("America/Argentina/Buenos_Aires")
	if err != nil {
		return time.FixedZone("ART", -3*3600)
	}
	return l
}()

// --- lo público ---

// Ajustes es ajustesDelSitio: clave → valor.
func (s *Servicio) Ajustes(ctx context.Context) (map[string]string, error) {
	filas, err := s.q.Ajustes(ctx)
	if err != nil {
		return nil, err
	}
	out := make(map[string]string, len(filas))
	for _, f := range filas {
		out[f.Clave] = f.Valor
	}
	return out, nil
}

// PromoVigente es la de la portada y el mostrador.
type PromoVigente struct {
	ID            string  `json:"id"`
	Medio         string  `json:"medio"`
	Titulo        string  `json:"titulo"`
	Detalle       string  `json:"detalle"`
	Dias          string  `json:"dias"`
	VigenciaHasta string  `json:"vigenciaHasta"`
	QuienPaga     string  `json:"quienPaga"`
	ImagenURL     *string `json:"imagenUrl"`
}

// Promos es promosVigentes: activas y sin vencer. La fecha va escrita
// «dd/mm/aa» en hora de Buenos Aires (el TS la escribía en la hora del
// servidor, que en el contenedor es UTC: una promo que vence a las 23 de acá
// figuraba con el día siguiente).
func (s *Servicio) Promos(ctx context.Context) ([]PromoVigente, error) {
	filas, err := s.q.PromosVigentes(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]PromoVigente, len(filas))
	for i, f := range filas {
		p := PromoVigente{ID: f.ID, Medio: f.Medio, Titulo: f.Titulo, Detalle: f.Detalle, Dias: f.Dias,
			QuienPaga: string(f.QuienPaga), ImagenURL: f.ImagenUrl}
		if f.VigenciaHasta != nil {
			p.VigenciaHasta = f.VigenciaHasta.In(argentina).Format("02/01/06")
		}
		out[i] = p
	}
	return out, nil
}

// Banner es el que se publica.
type Banner struct {
	ID          string    `json:"id"`
	Etiqueta    string    `json:"etiqueta"`
	Titulo      string    `json:"titulo"`
	Bajada      string    `json:"bajada"`
	Enlace      *string   `json:"enlace"`
	TextoEnlace string    `json:"textoEnlace"`
	ImagenURL   *string   `json:"imagenUrl"`
	Actualizado time.Time `json:"actualizado"`
}

// Banners es bannersDe: los de una ubicación, dentro de sus fechas.
func (s *Servicio) Banners(ctx context.Context, ubicacion string) ([]Banner, error) {
	filas, err := s.q.BannersPublicados(ctx, sqlc.UbicacionBanner(ubicacion))
	if err != nil {
		return nil, err
	}
	out := make([]Banner, len(filas))
	for i, f := range filas {
		out[i] = Banner{ID: f.ID, Etiqueta: f.Etiqueta, Titulo: f.Titulo, Bajada: f.Bajada, Enlace: f.Enlace,
			TextoEnlace: f.TextoEnlace, ImagenURL: f.ImagenUrl, Actualizado: f.UpdatedAt}
	}
	return out, nil
}

// Resena es una reseña publicada.
type Resena struct {
	ID        string    `json:"id"`
	Nombre    string    `json:"nombre"`
	Estrellas int32     `json:"estrellas"`
	Texto     string    `json:"texto"`
	Fecha     time.Time `json:"fecha"`
}

// Resenas es resenasDelProducto: las publicadas, las 50 más nuevas.
func (s *Servicio) Resenas(ctx context.Context, productID string) ([]Resena, error) {
	filas, err := s.q.ResenasPublicadas(ctx, productID)
	if err != nil {
		return nil, err
	}
	out := make([]Resena, len(filas))
	for i, f := range filas {
		out[i] = Resena(f)
	}
	return out, nil
}

// Resumen es el promedio y el reparto por estrellas.
type Resumen struct {
	Promedio float64          `json:"promedio"`
	Cantidad int              `json:"cantidad"`
	Reparto  map[string]int32 `json:"reparto"`
}

// ResumenDeResenas es resumenDeResenas: nil si no hay ninguna publicada. El
// promedio con un decimal, redondeado como Math.round.
func (s *Servicio) ResumenDeResenas(ctx context.Context, productID string) (*Resumen, error) {
	filas, err := s.q.RepartoDeResenas(ctx, productID)
	if err != nil || len(filas) == 0 {
		return nil, err
	}
	r := &Resumen{Reparto: map[string]int32{"1": 0, "2": 0, "3": 0, "4": 0, "5": 0}}
	suma := 0.0
	for _, f := range filas {
		r.Reparto[string(rune('0'+f.Estrellas))] = f.Cuantas
		r.Cantidad += int(f.Cuantas)
		suma = float64(suma + float64(f.Estrellas)*float64(f.Cuantas))
	}
	r.Promedio = jsmath.Round(float64(suma/float64(r.Cantidad)*10)) / 10
	if math.IsNaN(r.Promedio) {
		r.Promedio = 0
	}
	return r, nil
}

// --- las reseñas del cliente ---

// cliente es la ficha de quien pide (clienteDeLaSesion del TS).
func (s *Servicio) cliente(ctx context.Context, ses *auth.Sesion) (*sqlc.ClienteDelUsuarioRow, error) {
	c, err := s.q.ClienteDelUsuario(ctx, &ses.UserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &c, err
}

// Resenables es productosQuePuedoResenar: lo comprado en pedidos entregados,
// con si ya se reseñó.
func (s *Servicio) Resenables(ctx context.Context, ses *auth.Sesion) ([]sqlc.ProductosResenablesRow, error) {
	c, err := s.cliente(ctx, ses)
	if err != nil || c == nil {
		return []sqlc.ProductosResenablesRow{}, err
	}
	filas, err := s.q.ProductosResenables(ctx, c.ID)
	if filas == nil {
		filas = []sqlc.ProductosResenablesRow{}
	}
	return filas, err
}

// NuevaResena es lo que manda el cliente.
type NuevaResena struct {
	ProductID, OrderID string
	Estrellas          int
	Texto              string
}

// DejarResena es dejarResena: solo de un producto de un pedido entregado,
// una por compra, y queda pendiente hasta que alguien la publica. Devuelve el
// slug del producto, para que Next revalide su ficha.
func (s *Servicio) DejarResena(ctx context.Context, ses *auth.Sesion, r NuevaResena) (string, error) {
	c, err := s.cliente(ctx, ses)
	if err != nil {
		return "", err
	}
	if c == nil {
		return "", plataforma.NuevoProblema(403, "Entrá con tu cuenta para dejar una reseña.")
	}
	if r.Estrellas < 1 || r.Estrellas > 5 {
		return "", plataforma.Invalido(map[string]string{"estrellas": "Elegí de una a cinco estrellas."})
	}
	texto := strings.TrimSpace(r.Texto)
	if utf8.RuneCountInString(texto) > 1000 {
		return "", plataforma.Invalido(map[string]string{"texto": "Quedó muy largo."})
	}
	ok, err := s.q.PuedeResenar(ctx, sqlc.PuedeResenarParams{CustomerID: &c.ID, ID: r.OrderID, ProductID: r.ProductID})
	if err != nil {
		return "", err
	}
	if !ok {
		return "", plataforma.NuevoProblema(422, "Solo se pueden reseñar los productos de un pedido que ya recibiste.")
	}
	if _, err := s.q.CrearResena(ctx, sqlc.CrearResenaParams{
		ProductID: r.ProductID, CustomerID: c.ID, OrderID: r.OrderID, Estrellas: int32(r.Estrellas), Texto: texto, Nombre: c.Nombre,
	}); errors.Is(err, pgx.ErrNoRows) {
		return "", plataforma.NuevoProblema(409, "Ya dejaste una reseña de este producto en esa compra.")
	} else if err != nil {
		return "", err
	}
	slug, err := s.q.SlugDeProducto(ctx, r.ProductID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	return slug, nil
}

// --- el panel ---

// GuardarAjuste cambia un texto del sitio.
func (s *Servicio) GuardarAjuste(ctx context.Context, clave, valor string) error {
	if clave == "" || utf8.RuneCountInString(clave) > 60 || utf8.RuneCountInString(valor) > 500 {
		return plataforma.Invalido(map[string]string{"valor": "No se pudo guardar: el texto no puede pasar de 500 letras."})
	}
	n, err := s.q.GuardarAjuste(ctx, sqlc.GuardarAjusteParams{Clave: clave, Valor: valor})
	if err != nil {
		return err
	}
	if n == 0 {
		return plataforma.NuevoProblema(404, "Ese ajuste no existe.")
	}
	return nil
}

// Moderar publica, rechaza o devuelve a pendiente una reseña. Devuelve el
// slug del producto.
func (s *Servicio) Moderar(ctx context.Context, ses *auth.Sesion, id, estado, motivo string) (string, error) {
	var motivoRechazo *string
	if estado == "rechazada" {
		if m := strings.TrimSpace(motivo); m != "" {
			if utf8.RuneCountInString(m) > 300 {
				return "", plataforma.Invalido(map[string]string{"motivo": "El motivo es muy largo."})
			}
			motivoRechazo = &m
		}
	}
	productID, err := s.q.ModerarResena(ctx, sqlc.ModerarResenaParams{
		ID: id, Estado: sqlc.EstadoResena(estado), MotivoRechazo: motivoRechazo, ResueltoPor: &ses.UserID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", plataforma.NuevoProblema(404, "Esa reseña no existe.")
	}
	if err != nil {
		return "", err
	}
	slug, _ := s.q.SlugDeProducto(ctx, productID)
	return slug, nil
}

// fechaDelFormulario convierte «2026-10-24» en esa hora del día en Buenos
// Aires (el TS usaba la hora del servidor, UTC en el contenedor).
func fechaDelFormulario(v string, hora, minuto, segundo int) (*time.Time, error) {
	v = strings.TrimSpace(v)
	if v == "" {
		return nil, nil
	}
	d, err := time.ParseInLocation("2006-01-02", v, argentina)
	if err != nil {
		return nil, err
	}
	t := time.Date(d.Year(), d.Month(), d.Day(), hora, minuto, segundo, 0, argentina)
	return &t, nil
}

// Imagen es una imagen subida con el formulario.
type Imagen struct {
	Datos []byte
	Tipo  string
}

// guardarImagen sube la imagen (si vino) y devuelve la URL nueva.
func (s *Servicio) guardarImagen(img *Imagen, prefijo string) (*string, error) {
	if img == nil || len(img.Datos) == 0 {
		return nil, nil
	}
	url, err := s.disco.GuardarImagen(img.Datos, img.Tipo, prefijo)
	if err != nil {
		return nil, subidaInvalida("imagen", err)
	}
	return &url, nil
}

// subidaInvalida: un archivo que el disco rechaza (vacío, pesado, de otro
// tipo) es un error del formulario, con su mensaje en el campo.
func subidaInvalida(campo string, err error) error {
	var e *subidas.ErrSubida
	if errors.As(err, &e) {
		return plataforma.Invalido(map[string]string{campo: e.Mensaje})
	}
	return err
}

func (s *Servicio) borrarImagenVieja(previa *string, nueva *string) {
	if previa != nil && (nueva == nil || *previa != *nueva) {
		if err := s.disco.Borrar(*previa); err != nil {
			s.log.Warn("no se pudo borrar la imagen vieja", "url", *previa, "error", err)
		}
	}
}

// --- banners ---

// FormBanner es el formulario del banner.
type FormBanner struct {
	ID                                          string
	Ubicacion, Etiqueta, Titulo, Bajada, Enlace string
	TextoEnlace, Desde, Hasta                   string
	Orden                                       int
	Activo                                      bool
	Imagen                                      *Imagen
}

// GuardarBanner crea o edita un banner, con su imagen.
func (s *Servicio) GuardarBanner(ctx context.Context, ses *auth.Sesion, f FormBanner) error {
	recorte := func(v string) string { return strings.TrimSpace(v) }
	f.Etiqueta, f.Titulo, f.Bajada, f.Enlace, f.TextoEnlace = recorte(f.Etiqueta), recorte(f.Titulo), recorte(f.Bajada), recorte(f.Enlace), recorte(f.TextoEnlace)
	largo := utf8.RuneCountInString
	switch {
	case f.Ubicacion != "franja" && f.Ubicacion != "portada" && f.Ubicacion != "catalogo":
		return plataforma.Invalido(map[string]string{"ubicacion": "Elegí dónde va el aviso."})
	case largo(f.Titulo) < 2 || largo(f.Titulo) > 120:
		return plataforma.Invalido(map[string]string{"titulo": "Poné el texto del aviso."})
	case largo(f.Etiqueta) > 30 || largo(f.Bajada) > 200 || largo(f.Enlace) > 300 || largo(f.TextoEnlace) > 40:
		return plataforma.Invalido(map[string]string{"titulo": "Revisá los datos: algún texto quedó muy largo."})
	case f.Orden < 0 || f.Orden > 99:
		return plataforma.Invalido(map[string]string{"orden": "El orden va de 0 a 99."})
	}
	desde, err1 := fechaDelFormulario(f.Desde, 0, 0, 0)
	hasta, err2 := fechaDelFormulario(f.Hasta, 0, 0, 0)
	if err1 != nil || err2 != nil {
		return plataforma.Invalido(map[string]string{"desde": "Revisá la fecha."})
	}
	if desde != nil && hasta != nil && hasta.Before(*desde) {
		return plataforma.Invalido(map[string]string{"hasta": "La fecha de fin es anterior a la de inicio."})
	}
	var enlace *string
	if f.Enlace != "" {
		enlace = &f.Enlace
	}
	nueva, err := s.guardarImagen(f.Imagen, "banner")
	if err != nil {
		return err
	}
	detalle := map[string]any{"ubicacion": f.Ubicacion, "etiqueta": f.Etiqueta, "titulo": f.Titulo, "bajada": f.Bajada,
		"enlace": enlace, "textoEnlace": f.TextoEnlace, "desde": desde, "hasta": hasta, "orden": f.Orden, "activo": f.Activo}
	if f.ID == "" {
		id, err := s.q.CrearBanner(ctx, sqlc.CrearBannerParams{
			Ubicacion: sqlc.UbicacionBanner(f.Ubicacion), Etiqueta: f.Etiqueta, Titulo: f.Titulo, Bajada: f.Bajada,
			Enlace: enlace, TextoEnlace: f.TextoEnlace, Desde: desde, Hasta: hasta, Orden: int32(f.Orden), Activo: f.Activo, ImagenUrl: nueva,
		})
		if err != nil {
			return err
		}
		bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCrear, "banner", id, `Banner en `+f.Ubicacion+`: "`+f.Titulo+`"`, detalle)
		return nil
	}
	previo, err := s.q.BannerPorID(ctx, f.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return plataforma.NuevoProblema(404, "Ese banner ya no está.")
	}
	if err != nil {
		return err
	}
	imagen := previo.ImagenUrl
	if nueva != nil {
		imagen = nueva
	}
	if err := s.q.EditarBanner(ctx, sqlc.EditarBannerParams{
		ID: f.ID, Ubicacion: sqlc.UbicacionBanner(f.Ubicacion), Etiqueta: f.Etiqueta, Titulo: f.Titulo, Bajada: f.Bajada,
		Enlace: enlace, TextoEnlace: f.TextoEnlace, Desde: desde, Hasta: hasta, Orden: int32(f.Orden), Activo: f.Activo, ImagenUrl: imagen,
	}); err != nil {
		return err
	}
	if nueva != nil {
		s.borrarImagenVieja(previo.ImagenUrl, nueva)
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaEditar, "banner", f.ID, `Banner en `+f.Ubicacion+`: "`+f.Titulo+`"`, detalle)
	return nil
}

// BorrarBanner borra el banner y su imagen.
func (s *Servicio) BorrarBanner(ctx context.Context, ses *auth.Sesion, id string) error {
	previo, err := s.q.BannerPorID(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return plataforma.NuevoProblema(404, "Ese banner ya no está.")
	}
	if err != nil {
		return err
	}
	if err := s.q.BorrarBanner(ctx, id); err != nil {
		return err
	}
	s.borrarImagenVieja(previo.ImagenUrl, nil)
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaEliminar, "banner", id, `Banner borrado: "`+previo.Titulo+`"`, nil)
	return nil
}

// --- promociones bancarias ---

// FormPromo es el formulario de la promoción.
type FormPromo struct {
	ID                                      string
	Medio, Titulo, Detalle, Dias, QuienPaga string
	VigenciaHasta                           string
	Orden                                   int
	Activo, QuitarImagen                    bool
	Imagen                                  *Imagen
}

// GuardarPromo crea o edita una promoción bancaria.
func (s *Servicio) GuardarPromo(ctx context.Context, ses *auth.Sesion, f FormPromo) error {
	f.Medio, f.Titulo, f.Detalle, f.Dias = strings.TrimSpace(f.Medio), strings.TrimSpace(f.Titulo), strings.TrimSpace(f.Detalle), strings.TrimSpace(f.Dias)
	largo := utf8.RuneCountInString
	switch {
	case largo(f.Medio) < 2 || largo(f.Medio) > 60:
		return plataforma.Invalido(map[string]string{"medio": "Poné con qué se paga."})
	case largo(f.Titulo) < 2 || largo(f.Titulo) > 120:
		return plataforma.Invalido(map[string]string{"titulo": "Poné el beneficio en una línea."})
	case largo(f.Detalle) > 600 || largo(f.Dias) > 60:
		return plataforma.Invalido(map[string]string{"detalle": "Revisá los datos: algún texto quedó muy largo."})
	case f.QuienPaga != "banco" && f.QuienPaga != "nosotros":
		return plataforma.Invalido(map[string]string{"quienPaga": "Decí quién pone el descuento: el banco o la maderera."})
	case f.Orden < 0 || f.Orden > 99:
		return plataforma.Invalido(map[string]string{"orden": "El orden va de 0 a 99."})
	}
	// La promo vale todo el último día.
	hasta, err := fechaDelFormulario(f.VigenciaHasta, 23, 59, 59)
	if err != nil {
		return plataforma.Invalido(map[string]string{"vigenciaHasta": "Revisá la fecha."})
	}
	nueva, err := s.guardarImagen(f.Imagen, "promo")
	if err != nil {
		return err
	}
	detalle := map[string]any{"medio": f.Medio, "titulo": f.Titulo, "detalle": f.Detalle, "dias": f.Dias,
		"quienPaga": f.QuienPaga, "vigenciaHasta": hasta, "orden": f.Orden, "activo": f.Activo}
	if f.ID == "" {
		imagen := nueva
		if f.QuitarImagen {
			imagen = nil
		}
		id, err := s.q.CrearPromo(ctx, sqlc.CrearPromoParams{
			Medio: f.Medio, Titulo: f.Titulo, Detalle: f.Detalle, Dias: f.Dias, QuienPaga: sqlc.QuienPagaPromo(f.QuienPaga),
			VigenciaHasta: hasta, Orden: int32(f.Orden), Activo: f.Activo, ImagenUrl: imagen,
		})
		if err != nil {
			return err
		}
		bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCrear, "promo_bancaria", id, "Promoción de "+f.Medio+`: "`+f.Titulo+`"`, detalle)
		return nil
	}
	previa, err := s.q.PromoPorID(ctx, f.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return plataforma.NuevoProblema(404, "Esa promoción ya no está.")
	}
	if err != nil {
		return err
	}
	imagen := previa.ImagenUrl
	cambio := false
	if nueva != nil {
		imagen, cambio = nueva, true
	}
	if f.QuitarImagen {
		imagen, cambio = nil, true
	}
	if err := s.q.EditarPromo(ctx, sqlc.EditarPromoParams{
		ID: f.ID, Medio: f.Medio, Titulo: f.Titulo, Detalle: f.Detalle, Dias: f.Dias, QuienPaga: sqlc.QuienPagaPromo(f.QuienPaga),
		VigenciaHasta: hasta, Orden: int32(f.Orden), Activo: f.Activo, ImagenUrl: imagen,
	}); err != nil {
		return err
	}
	if cambio {
		s.borrarImagenVieja(previa.ImagenUrl, imagen)
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaEditar, "promo_bancaria", f.ID, "Promoción de "+f.Medio+`: "`+f.Titulo+`"`, detalle)
	return nil
}

// BorrarPromo borra la promoción y su imagen.
func (s *Servicio) BorrarPromo(ctx context.Context, ses *auth.Sesion, id string) error {
	previa, err := s.q.PromoPorID(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return plataforma.NuevoProblema(404, "Esa promoción ya no está.")
	}
	if err != nil {
		return err
	}
	if err := s.q.BorrarPromo(ctx, id); err != nil {
		return err
	}
	s.borrarImagenVieja(previa.ImagenUrl, nil)
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaEliminar, "promo_bancaria", id, "Promoción borrada: "+previa.Medio+` — "`+previa.Titulo+`"`, nil)
	return nil
}
