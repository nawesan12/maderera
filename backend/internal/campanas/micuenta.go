package campanas

import (
	"context"
	"net/http"

	"mjbj/internal/api/campanasapi"
	"mjbj/internal/auth"
	"mjbj/internal/plataforma"
)

// Recibir o no las novedades desde Mi cuenta (app/(public)/mi-cuenta).

func (o respuesta) VisitMisNovedadesResponse(w http.ResponseWriter) error        { return o.escribir(w) }
func (o respuesta) VisitCambiarMisNovedadesResponse(w http.ResponseWriter) error { return o.escribir(w) }

// CorreoDeLaFicha es la dirección de la ficha activa de la cuenta ("" si no
// tiene ficha o no tiene correo).
func (s *Servicio) CorreoDeLaFicha(ctx context.Context, userID string) string {
	var c *string
	_ = s.pool.QueryRow(ctx, `select email from customers where user_id = $1 and active limit 1`, userID).Scan(&c)
	if c == nil {
		return ""
	}
	return *c
}

func sesion(ctx context.Context) (*auth.Sesion, error) {
	ses := auth.DeContexto(ctx)
	if ses == nil {
		return nil, plataforma.NuevoProblema(http.StatusUnauthorized, "Tenés que entrar para hacer esto.")
	}
	return ses, nil
}

func (a *API) MisNovedades(ctx context.Context, _ campanasapi.MisNovedadesRequestObject) (campanasapi.MisNovedadesResponseObject, error) {
	ses, err := sesion(ctx)
	if err != nil {
		return nil, err
	}
	correo := a.s.CorreoDeLaFicha(ctx, ses.UserID)
	if correo == "" {
		correo = ses.Correo
	}
	baja, err := a.s.EstaDadoDeBaja(ctx, correo)
	if err != nil {
		return nil, err
	}
	return ok(map[string]bool{"recibe": !baja}), nil
}

func (a *API) CambiarMisNovedades(ctx context.Context, r campanasapi.CambiarMisNovedadesRequestObject) (campanasapi.CambiarMisNovedadesResponseObject, error) {
	ses, err := sesion(ctx)
	if err != nil {
		return nil, err
	}
	// Las campañas salen a la de la ficha, y quien se da de baja desde su
	// cuenta no tiene por qué saber cuál de las dos tenemos cargada.
	direcciones := []string{ses.Correo}
	if f := a.s.CorreoDeLaFicha(ctx, ses.UserID); f != "" && f != ses.Correo {
		direcciones = append(direcciones, f)
	}
	for _, d := range direcciones {
		if d == "" {
			continue
		}
		if r.Body.Recibir {
			err = a.s.VolverARecibir(ctx, d)
		} else {
			err = a.s.DarDeBaja(ctx, d, "cuenta")
		}
		if err != nil {
			return nil, err
		}
	}
	if r.Body.Recibir {
		return hecho("Te vamos a mandar las novedades."), nil
	}
	return hecho("No te vamos a mandar más novedades."), nil
}
