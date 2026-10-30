package contenido

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/email"
	"mjbj/internal/plataforma"
	"mjbj/internal/sqlc"
)

// Lo que queda del sitio público: los documentos técnicos, las lecturas de
// los eventos, los datos del sitemap y el formulario de contacto.
//
// La inscripción a eventos y su panel siguen en TS (lib/eventos): cobran por
// Mercado Pago (tanda 6) y avisan con las plantillas de profesionales (tanda
// 10). Comparten la tabla; quien decide si hay lugar es la transacción del TS.

// --- documentos ---

// DocumentoTecnico es uno de la documentación.
type DocumentoTecnico struct {
	ID                string  `json:"id"`
	Titulo            string  `json:"titulo"`
	Descripcion       *string `json:"descripcion"`
	Categoria         string  `json:"categoria"`
	URL               string  `json:"url"`
	Formato           string  `json:"formato"`
	TamanoBytes       *int32  `json:"tamanoBytes"`
	SoloProfesionales bool    `json:"soloProfesionales"`
}

// esProfesional: la ficha de quien pide es de un profesional activo.
func (s *Servicio) esProfesional(ctx context.Context, ses *auth.Sesion) (bool, error) {
	if ses == nil {
		return false, nil
	}
	return s.q.EsProfesionalAprobado(ctx, &ses.UserID)
}

// Documentos son los que esta persona puede ver.
func (s *Servicio) Documentos(ctx context.Context, ses *auth.Sesion) ([]DocumentoTecnico, error) {
	pro, err := s.esProfesional(ctx, ses)
	if err != nil {
		return nil, err
	}
	filas, err := s.q.DocumentosVisibles(ctx, pro)
	if err != nil {
		return nil, err
	}
	out := make([]DocumentoTecnico, len(filas))
	for i, f := range filas {
		out[i] = DocumentoTecnico{f.ID, f.Titulo, f.Descripcion, f.Categoria, URLDelDocumento(f.ID), f.Formato, f.TamanoBytes, f.SoloProfesionales}
	}
	return out, nil
}

// --- eventos ---

// EventoPublico es uno publicado. Inscriptos son los que ocupan lugar.
type EventoPublico struct {
	ID                string     `json:"id"`
	Slug              string     `json:"slug"`
	Titulo            string     `json:"titulo"`
	Resumen           *string    `json:"resumen"`
	ImagenURL         *string    `json:"imagenUrl"`
	Lugar             *string    `json:"lugar"`
	Inicia            time.Time  `json:"inicia"`
	Termina           *time.Time `json:"termina"`
	Cupo              int32      `json:"cupo"`
	Precio            float64    `json:"precio"`
	SoloProfesionales bool       `json:"soloProfesionales"`
	Inscriptos        int32      `json:"inscriptos"`
}

// EventosProximos son los publicados que no pasaron. El conteo es para
// mostrar; quien decide si hay lugar es la inscripción, dentro de su
// transacción.
func (s *Servicio) EventosProximos(ctx context.Context) ([]EventoPublico, error) {
	filas, err := s.q.EventosProximos(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]EventoPublico, len(filas))
	for i, f := range filas {
		out[i] = EventoPublico{f.ID, f.Slug, f.Titulo, f.Resumen, f.ImagenUrl, f.Lugar, f.Inicia, f.Termina, f.Cupo,
			float64(f.Precio), f.SoloProfesionales, f.Inscriptos}
	}
	return out, nil
}

// Inscripcion es la de quien mira.
type Inscripcion struct {
	ID     string `json:"id"`
	Estado string `json:"estado"`
}

// EventoConDetalle es la ficha.
type EventoConDetalle struct {
	EventoPublico
	Descripcion   *string      `json:"descripcion"`
	Estado        string       `json:"estado"`
	MiInscripcion *Inscripcion `json:"miInscripcion"`
	YaPaso        bool         `json:"yaPaso"`
}

// EventoPorSlug es nil si no existe o es un borrador: un borrador no existe
// para el público.
func (s *Servicio) EventoPorSlug(ctx context.Context, ses *auth.Sesion, slug string) (*EventoConDetalle, error) {
	f, err := s.q.EventoPorSlug(ctx, slug)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && f.Estado == sqlc.EstadoEventoBorrador) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	e := &EventoConDetalle{
		EventoPublico: EventoPublico{f.ID, f.Slug, f.Titulo, f.Resumen, f.ImagenUrl, f.Lugar, f.Inicia, f.Termina, f.Cupo,
			float64(f.Precio), f.SoloProfesionales, f.Inscriptos},
		Descripcion: f.Descripcion, Estado: string(f.Estado), YaPaso: f.Inicia.Before(time.Now()),
	}
	if ses != nil {
		mia, err := s.q.MiInscripcion(ctx, sqlc.MiInscripcionParams{EventID: f.ID, UserID: &ses.UserID})
		if err == nil {
			e.MiInscripcion = &Inscripcion{mia.ID, mia.Estado}
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
	}
	return e, nil
}

// --- sitemap ---

// RutaSitemap es una entrada del sitemap.
type RutaSitemap struct {
	Ruta        string    `json:"ruta"`
	Actualizada time.Time `json:"actualizada"`
	Imagenes    []string  `json:"imagenes"`
}

// Sitemap son las rutas de una sección: catalogo, categorias o eventos.
func (s *Servicio) Sitemap(ctx context.Context, seccion string) ([]RutaSitemap, error) {
	var out []RutaSitemap
	switch seccion {
	case "catalogo":
		filas, err := s.q.SitemapCatalogo(ctx)
		if err != nil {
			return nil, err
		}
		for _, f := range filas {
			img := f.Imagenes
			if len(img) > 10 {
				img = img[:10]
			}
			out = append(out, RutaSitemap{"/catalogo/" + f.Slug, f.Actualizada.Time, img})
		}
	case "categorias":
		filas, err := s.q.SitemapCategorias(ctx)
		if err != nil {
			return nil, err
		}
		for _, f := range filas {
			r := RutaSitemap{Ruta: "/catalogo?cat=" + f.Categoria, Actualizada: f.Actualizada.Time, Imagenes: []string{}}
			if f.Rubro != nil {
				r.Ruta += "&rubro=" + *f.Rubro
			}
			if f.Imagen != "" {
				r.Imagenes = []string{f.Imagen}
			}
			out = append(out, r)
		}
	case "eventos":
		filas, err := s.q.SitemapEventos(ctx)
		if err != nil {
			return nil, err
		}
		for _, f := range filas {
			r := RutaSitemap{Ruta: "/eventos/" + f.Slug, Actualizada: f.Actualizada, Imagenes: []string{}}
			if f.ImagenUrl != nil && *f.ImagenUrl != "" {
				r.Imagenes = []string{*f.ImagenUrl}
			}
			out = append(out, r)
		}
	}
	return out, nil
}

// --- contacto ---

// ConfigContacto es a dónde llegan las consultas y la URL del sitio para el
// pie del correo.
type ConfigContacto struct {
	Casilla     string `env:"EMAIL_CONTACTO" envDefault:"info@mjbj.com.ar"`
	Sitio       string `env:"APP_URL"`
	SitioPublic string `env:"NEXT_PUBLIC_APP_URL"`
}

// URLDelSitio es urlBase() del TS.
func (c ConfigContacto) URLDelSitio() string {
	for _, u := range []string{c.Sitio, c.SitioPublic} {
		if u != "" {
			return strings.TrimSuffix(u, "/")
		}
	}
	return "http://localhost:3000"
}

// Motivos del formulario, en el orden del select.
var Motivos = map[string]string{
	"presupuesto": "Pedido de presupuesto",
	"stock":       "Consulta de stock",
	"envio":       "Envíos y entregas",
	"corte":       "Servicio de corte",
	"profesional": "Cuenta de profesional",
	"otro":        "Otra consulta",
}

// Consulta es lo que manda alguien desde /contacto.
type Consulta struct {
	Nombre, Email, Telefono, Motivo, Mensaje string
}

// ResultadoConsulta: enviada, simulada (no hay correo conectado: que use
// WhatsApp) o fallida.
type ResultadoConsulta string

// validar sigue el esquema de zod del TS, con los mismos mensajes.
func (c *Consulta) validar() error {
	c.Nombre, c.Email, c.Telefono, c.Mensaje = strings.TrimSpace(c.Nombre), strings.TrimSpace(c.Email),
		strings.TrimSpace(c.Telefono), strings.TrimSpace(c.Mensaje)
	largo := utf8.RuneCountInString
	if n := largo(c.Nombre); n < 3 || n > 120 {
		return plataforma.Invalido(map[string]string{"nombre": "Escribí tu nombre."})
	}
	if !plataforma.CorreoValido(c.Email) {
		return plataforma.Invalido(map[string]string{"email": "Revisá el correo: es por donde te contestamos."})
	}
	if largo(c.Telefono) > 40 {
		return plataforma.Invalido(map[string]string{"telefono": "Revisá el teléfono."})
	}
	if _, ok := Motivos[c.Motivo]; !ok {
		return plataforma.Invalido(map[string]string{"motivo": "Elegí el motivo de la consulta."})
	}
	if n := largo(c.Mensaje); n < 10 || n > 2000 {
		return plataforma.Invalido(map[string]string{"mensaje": "Contanos un poco más para poder ayudarte."})
	}
	return nil
}

// recortar son los primeros n caracteres (no bytes), como slice() de JS
// sobre texto sin emojis.
func recortar(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		return string(r[:n])
	}
	return s
}

// EnviarConsulta manda la consulta a la casilla de la maderera, con
// Responder-A de quien escribió, y la anota en notifications_log.
func (s *Servicio) EnviarConsulta(ctx context.Context, envio email.Proveedor, cfg ConfigContacto, c Consulta) (ResultadoConsulta, error) {
	if err := c.validar(); err != nil {
		return "", err
	}
	motivo := Motivos[c.Motivo]
	asunto := motivo + " — " + c.Nombre
	datos := []email.Bloque{{Etiqueta: "Nombre", Valor: c.Nombre}, {Etiqueta: "Correo", Valor: c.Email}}
	if c.Telefono != "" {
		datos = append(datos, email.Bloque{Etiqueta: "Teléfono", Valor: c.Telefono})
	}
	html, texto := email.Envolver(cfg.URLDelSitio(), email.Opciones{
		Titulo:   "Consulta desde el sitio",
		Adelanto: c.Nombre + ": " + recortar(c.Mensaje, 90),
		Saludo:   motivo,
		Parrafos: []string{strings.ReplaceAll(email.Escapar(c.Mensaje), "\n", "<br>")},
		Datos:    datos,
	})
	r := envio.Enviar(ctx, email.Mensaje{Para: cfg.Casilla, Asunto: asunto, HTML: html, Texto: texto, ResponderA: c.Email})
	estado := ResultadoConsulta("fallida")
	switch {
	case r.Simulado:
		estado = "simulada"
	case r.Enviado:
		estado = "enviada"
	}
	var id, falla *string
	if r.ID != "" {
		id = &r.ID
	}
	if r.Error != "" {
		falla = &r.Error
	}
	if err := s.q.RegistrarConsultaWeb(ctx, sqlc.RegistrarConsultaWebParams{
		Destinatario: cfg.Casilla, Asunto: &asunto, Estado: sqlc.EstadoNotificacion(estado), ProveedorMensajeID: id, Error: falla,
	}); err != nil {
		s.log.Error("no se pudo anotar la consulta", "error", err)
	}
	return estado, nil
}
