package correo

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/emersion/go-imap/v2"

	"mjbj/internal/plataforma"
	"mjbj/internal/sqlc"
)

// Seguimientos: al mandar un presupuesto se puede pedir «si no contesta en
// N días, avisame». No hace falta un proceso aparte: cada vez que la
// pantalla pide los pendientes, se mira en el IMAP si llegó algo de esa
// persona o de esa conversación desde que se mandó; si llegó, el
// seguimiento se cierra solo. Los vencidos sin respuesta son el aviso.

// Seguimiento es uno pendiente, como lo ve la pantalla.
type Seguimiento struct {
	ID      string    `json:"id"`
	Hilo    string    `json:"hilo"`
	Para    string    `json:"para"`
	Asunto  string    `json:"asunto"`
	Enviado time.Time `json:"enviado"`
	Vence   time.Time `json:"vence"`
	Vencido bool      `json:"vencido"`
}

// contestaron devuelve, de los seguimientos, los ids de los que ya tienen
// respuesta en la entrada.
func (s *Servidor) contestaron(ctx context.Context, cred Credenciales, lista []sqlc.SeguimientosPendientesRow) (map[string]bool, error) {
	out := map[string]bool{}
	if len(lista) == 0 {
		return out, nil
	}
	cx, err := s.conectar(ctx, cred)
	if err != nil {
		return nil, err
	}
	defer cx.cerrar()
	if _, err := cx.c.Select("INBOX", &imap.SelectOptions{ReadOnly: true}).Wait(); err != nil {
		return nil, err
	}
	for _, sg := range lista {
		deLaConversacion := imap.SearchCriteria{Or: [][2]imap.SearchCriteria{{
			{Header: []imap.SearchCriteriaHeaderField{{Key: "References", Value: sg.Hilo}}},
			{Header: []imap.SearchCriteriaHeaderField{{Key: "In-Reply-To", Value: sg.Hilo}}},
		}}}
		criterio := &imap.SearchCriteria{
			Since: sg.EnviadoAt,
			Or: [][2]imap.SearchCriteria{{
				{Header: []imap.SearchCriteriaHeaderField{{Key: "From", Value: sg.Para}}},
				deLaConversacion,
			}},
		}
		datos, err := cx.c.UIDSearch(criterio, nil).Wait()
		if err != nil {
			return nil, err
		}
		// SINCE es por día: lo que llegó antes del envío ese mismo día no es
		// una respuesta. Se miran las fechas de lo encontrado.
		uids := datos.AllUIDs()
		if len(uids) == 0 {
			continue
		}
		msjs, err := cx.c.Fetch(imap.UIDSetNum(uids...), &imap.FetchOptions{UID: true, InternalDate: true}).Collect()
		if err != nil {
			return nil, err
		}
		for _, m := range msjs {
			if m.InternalDate.After(sg.EnviadoAt) {
				out[sg.ID] = true
				break
			}
		}
	}
	return out, nil
}

func (a *App) seguimientos(w http.ResponseWriter, r *http.Request, cred Credenciales) {
	if !a.conEquipo(w, r, cred) {
		return
	}
	ctx, cancelar := a.tope(r)
	filas, err := a.erp.q.SeguimientosPendientes(ctx, cred.Correo)
	cancelar()
	if err != nil {
		a.fallarERP(w, r, err)
		return
	}
	contestados, err := a.srv.contestaron(r.Context(), cred, filas)
	if err != nil {
		a.fallar(w, r, err)
		return
	}
	ahora := time.Now()
	out := []Seguimiento{}
	for _, f := range filas {
		if contestados[f.ID] {
			ctx, cancelar := a.tope(r)
			_, _ = a.erp.q.ResolverSeguimiento(ctx, sqlc.ResolverSeguimientoParams{Estado: "contesto", ID: f.ID, Casilla: cred.Correo})
			cancelar()
			continue
		}
		out = append(out, Seguimiento{ID: f.ID, Hilo: f.Hilo, Para: f.Para, Asunto: f.Asunto, Enviado: f.EnviadoAt, Vence: f.VenceAt, Vencido: ahora.After(f.VenceAt)})
	}
	plataforma.EscribirJSON(w, http.StatusOK, out)
}

func (a *App) cancelarSeguimiento(w http.ResponseWriter, r *http.Request, cred Credenciales) {
	if !a.conEquipo(w, r, cred) {
		return
	}
	ctx, cancelar := a.tope(r)
	defer cancelar()
	n, err := a.erp.q.ResolverSeguimiento(ctx, sqlc.ResolverSeguimientoParams{Estado: "cancelado", ID: r.PathValue("id"), Casilla: cred.Correo})
	if err != nil || n == 0 {
		plataforma.EscribirProblema(w, plataforma.NuevoProblema(http.StatusNotFound, "Ese seguimiento ya no está."))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- respuestas guardadas ---

// Las respuestas guardadas son de la casilla (las comparte quien la lea) y
// pueden llevar datos vivos entre llaves: {nombre}, {saldo}, {pedido},
// {estado}, {presupuesto}. Los completa la pantalla con la ficha del
// remitente al insertarlas.

type pedidoPlantilla struct {
	Titulo string `json:"titulo"`
	Atajo  string `json:"atajo"`
	Texto  string `json:"texto"`
}

func (a *App) plantillas(w http.ResponseWriter, r *http.Request, cred Credenciales) {
	if !a.conEquipo(w, r, cred) {
		return
	}
	ctx, cancelar := a.tope(r)
	defer cancelar()
	filas, err := a.erp.q.Plantillas(ctx, cred.Correo)
	if err != nil {
		a.fallarERP(w, r, err)
		return
	}
	plataforma.EscribirJSON(w, http.StatusOK, filas)
}

func (a *App) guardarPlantilla(w http.ResponseWriter, r *http.Request, cred Credenciales) {
	if !a.conEquipo(w, r, cred) {
		return
	}
	var p pedidoPlantilla
	if prob := plataforma.LeerJSON(w, r, &p, 32<<10); prob != nil {
		plataforma.EscribirProblema(w, prob)
		return
	}
	p.Titulo = strings.TrimSpace(p.Titulo)
	p.Atajo = strings.TrimSpace(p.Atajo)
	errs := map[string]string{}
	if p.Titulo == "" || len([]rune(p.Titulo)) > 80 {
		errs["titulo"] = "Ponele un nombre (hasta 80 letras)."
	}
	if strings.TrimSpace(p.Texto) == "" || len([]rune(p.Texto)) > 8000 {
		errs["texto"] = "Falta el texto."
	}
	if p.Atajo != "" && (strings.ContainsAny(p.Atajo, " \t\n") || len(p.Atajo) > 20) {
		errs["atajo"] = "El atajo va sin espacios, por ejemplo ;precios."
	}
	if len(errs) > 0 {
		plataforma.EscribirProblema(w, plataforma.Invalido(errs))
		return
	}
	ctx, cancelar := a.tope(r)
	defer cancelar()
	id, err := a.erp.q.GuardarPlantilla(ctx, sqlc.GuardarPlantillaParams{Casilla: cred.Correo, Titulo: p.Titulo, Atajo: p.Atajo, Texto: p.Texto})
	if err != nil {
		a.fallarERP(w, r, err)
		return
	}
	plataforma.EscribirJSON(w, http.StatusOK, map[string]string{"id": id})
}

func (a *App) borrarPlantilla(w http.ResponseWriter, r *http.Request, cred Credenciales) {
	if !a.conEquipo(w, r, cred) {
		return
	}
	ctx, cancelar := a.tope(r)
	defer cancelar()
	n, err := a.erp.q.BorrarPlantilla(ctx, sqlc.BorrarPlantillaParams{ID: r.PathValue("id"), Casilla: cred.Correo})
	if err != nil || n == 0 {
		plataforma.EscribirProblema(w, plataforma.NuevoProblema(http.StatusNotFound, "Esa respuesta ya no está."))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
