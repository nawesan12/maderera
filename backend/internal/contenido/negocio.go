package contenido

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
	"mjbj/internal/sqlc"
)

// Las reseñas del negocio: las de Google y las que se cargan a mano, que la
// portada muestra (lib/google/resenas.ts del TS).

// ResenaDelNegocio es la que se publica.
type ResenaDelNegocio struct {
	ID        string    `json:"id"`
	Autor     string    `json:"autor"`
	Estrellas int32     `json:"estrellas"`
	Texto     string    `json:"texto"`
	Fecha     time.Time `json:"fecha"`
	Origen    string    `json:"origen"`
	FotoURL   *string   `json:"fotoUrl"`
}

// ResenasDelNegocio son las publicadas, hasta 12.
func (s *Servicio) ResenasDelNegocio(ctx context.Context) ([]ResenaDelNegocio, error) {
	filas, err := s.q.ResenasDelNegocio(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]ResenaDelNegocio, len(filas))
	for i, f := range filas {
		out[i] = ResenaDelNegocio{f.ID, f.Autor, f.Estrellas, f.Texto, f.Fecha, string(f.Origen), f.FotoUrl}
	}
	return out, nil
}

// ResumenNegocio es el promedio y cuántas hay publicadas.
type ResumenNegocio struct {
	Promedio float64 `json:"promedio"`
	Cuantas  int32   `json:"cuantas"`
}

// ResumenDelNegocio es nil si no hay ninguna publicada.
func (s *Servicio) ResumenDelNegocio(ctx context.Context) (*ResumenNegocio, error) {
	f, err := s.q.ResumenDelNegocio(ctx)
	if err != nil || f.Cuantas == 0 {
		return nil, err
	}
	var prom jsmath.Num
	if err := prom.Scan(f.Promedio); err != nil {
		return nil, err
	}
	return &ResumenNegocio{Promedio: jsmath.Round(float64(prom)*10) / 10, Cuantas: f.Cuantas}, nil
}

// FormResenaNegocio es el formulario del panel.
type FormResenaNegocio struct {
	ID, Autor, Texto, Fecha string
	Estrellas               int
	Publicada               bool
}

// GuardarResenaNegocio crea o edita una reseña cargada a mano.
func (s *Servicio) GuardarResenaNegocio(ctx context.Context, ses *auth.Sesion, f FormResenaNegocio) (bool, error) {
	f.Autor, f.Texto = strings.TrimSpace(f.Autor), strings.TrimSpace(f.Texto)
	largo := utf8.RuneCountInString
	switch {
	case largo(f.Autor) < 2 || largo(f.Autor) > 120:
		return false, plataforma.Invalido(map[string]string{"autor": "Poné quién la escribió."})
	case f.Estrellas < 1 || f.Estrellas > 5:
		return false, plataforma.Invalido(map[string]string{"estrellas": "De una a cinco estrellas."})
	case largo(f.Texto) < 10 || largo(f.Texto) > 1500:
		return false, plataforma.Invalido(map[string]string{"texto": "Copiá el texto de la reseña."})
	}
	// El mediodía de ese día en Buenos Aires: así ninguna zona horaria la
	// corre de fecha.
	fecha := time.Now()
	if d, err := fechaDelFormulario(f.Fecha, 12, 0, 0); err != nil {
		return false, plataforma.Invalido(map[string]string{"fecha": "Revisá la fecha."})
	} else if d != nil {
		fecha = *d
	}
	accion, id := sqlc.AccionAuditoriaEditar, f.ID
	if f.ID == "" {
		nuevo, err := s.q.CrearResenaDelNegocio(ctx, sqlc.CrearResenaDelNegocioParams{
			Autor: f.Autor, Estrellas: int32(f.Estrellas), Texto: f.Texto, Fecha: fecha, Publicada: f.Publicada,
		})
		if err != nil {
			return false, err
		}
		accion, id = sqlc.AccionAuditoriaCrear, nuevo
	} else if n, err := s.q.EditarResenaDelNegocio(ctx, sqlc.EditarResenaDelNegocioParams{
		ID: f.ID, Autor: f.Autor, Estrellas: int32(f.Estrellas), Texto: f.Texto, Fecha: fecha, Publicada: f.Publicada,
	}); err != nil {
		return false, err
	} else if n == 0 {
		return false, plataforma.NuevoProblema(404, "Esa reseña ya no está.")
	}
	sufijo := ""
	if f.Publicada {
		sufijo = " (publicada)"
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, accion, "resena", id, "Reseña del negocio de "+f.Autor+sufijo, nil)
	return f.Publicada, nil
}

// PublicarResenaNegocio la pone o la saca del sitio.
func (s *Servicio) PublicarResenaNegocio(ctx context.Context, ses *auth.Sesion, id string, publicada bool) error {
	n, err := s.q.PublicarResenaDelNegocio(ctx, sqlc.PublicarResenaDelNegocioParams{ID: id, Publicada: publicada})
	if err != nil {
		return err
	}
	if n == 0 {
		return plataforma.NuevoProblema(404, "Esa reseña ya no está.")
	}
	desc := "Sacó del sitio una reseña del negocio"
	if publicada {
		desc = "Publicó una reseña del negocio"
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCambiarEstado, "resena", id, desc, nil)
	return nil
}

// BorrarResenaNegocio la borra.
func (s *Servicio) BorrarResenaNegocio(ctx context.Context, ses *auth.Sesion, id string) error {
	if _, err := s.q.BorrarResenaDelNegocio(ctx, id); err != nil {
		return err
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaEliminar, "resena", id, "Borró una reseña del negocio", nil)
	return nil
}

// ConfigGoogle es la clave de Places y el lugar de la maderera.
type ConfigGoogle struct {
	Clave string `env:"GOOGLE_PLACES_API_KEY"`
	Lugar string `env:"GOOGLE_PLACE_ID"`
	// Para las pruebas: otra dirección en vez de la de Google.
	URL string `env:"GOOGLE_PLACES_URL" envDefault:"https://places.googleapis.com/v1/places/"`
}

// Sincronizacion es lo que trajo una pasada.
type Sincronizacion struct {
	Traidas int `json:"traidas"`
	Nuevas  int `json:"nuevas"`
}

// ErrGoogle es un problema con Google que se le explica a la persona.
type ErrGoogle struct{ Mensaje string }

func (e *ErrGoogle) Error() string { return e.Mensaje }

// SincronizarGoogle trae las reseñas del lugar (Places API v1) y guarda las
// nuevas sin publicar: alguien las revisa antes de mostrarlas.
func (s *Servicio) SincronizarGoogle(ctx context.Context, cfg ConfigGoogle) (Sincronizacion, error) {
	if cfg.Clave == "" || cfg.Lugar == "" {
		return Sincronizacion{}, &ErrGoogle{"Faltan GOOGLE_PLACES_API_KEY y GOOGLE_PLACE_ID. Mientras tanto, las reseñas se cargan a mano."}
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, cfg.URL+url.PathEscape(cfg.Lugar), nil)
	req.Header.Set("X-Goog-Api-Key", cfg.Clave)
	req.Header.Set("X-Goog-FieldMask", "reviews")
	resp, err := (&http.Client{Timeout: 20 * time.Second}).Do(req)
	if err != nil {
		return Sincronizacion{}, &ErrGoogle{"No se pudo hablar con Google. Probá de nuevo en un rato."}
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return Sincronizacion{}, &ErrGoogle{fmt.Sprintf("Google contestó %d. Revisá la clave y el id del lugar.", resp.StatusCode)}
	}
	var datos struct {
		Reviews []struct {
			Name         string                 `json:"name"`
			Rating       float64                `json:"rating"`
			Text         *struct{ Text string } `json:"text"`
			OriginalText *struct{ Text string } `json:"originalText"`
			PublishTime  string                 `json:"publishTime"`
			Autor        *struct {
				DisplayName string `json:"displayName"`
				PhotoURI    string `json:"photoUri"`
			} `json:"authorAttribution"`
		} `json:"reviews"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&datos); err != nil {
		return Sincronizacion{}, &ErrGoogle{"Google devolvió algo que no se entiende."}
	}
	r := Sincronizacion{Traidas: len(datos.Reviews)}
	for _, g := range datos.Reviews {
		texto := ""
		if g.OriginalText != nil {
			texto = g.OriginalText.Text
		} else if g.Text != nil {
			texto = g.Text.Text
		}
		texto = strings.TrimSpace(texto)
		if texto == "" || g.Name == "" {
			continue
		}
		autor, foto := "Cliente de Google", (*string)(nil)
		if g.Autor != nil {
			if g.Autor.DisplayName != "" {
				autor = g.Autor.DisplayName
			}
			if g.Autor.PhotoURI != "" {
				foto = &g.Autor.PhotoURI
			}
		}
		estrellas := int32(jsmath.Round(g.Rating))
		if g.Rating == 0 {
			estrellas = 5
		}
		fecha := time.Now()
		if t, err := time.Parse(time.RFC3339, g.PublishTime); err == nil {
			fecha = t
		}
		nombre := g.Name
		_, err := s.q.GuardarResenaDeGoogle(ctx, sqlc.GuardarResenaDeGoogleParams{
			Autor: autor, Estrellas: estrellas, Texto: texto, Fecha: fecha, ExternoID: &nombre, FotoUrl: foto,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			continue // ya estaba
		}
		if err != nil {
			return r, err
		}
		r.Nuevas++
	}
	return r, nil
}
