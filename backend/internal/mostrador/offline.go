package mostrador

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"

	"mjbj/internal/auth"
	"mjbj/internal/plataforma"
	"mjbj/internal/roles"
)

// Las rutas de siempre de la copia local del mostrador (app/api/mostrador/*):
// **las direcciones, los formatos y la autenticación no cambian**, porque hay
// PC con un sw.js y colas cargadas que les hablan así. Las atiende Go en la
// misma dirección (Caddy y el rewrite de next.config.ts). Quedan en Next
// /api/mostrador/config (lee lo fiscal y las fichas de las sucursales, que
// siguen en TS) y /api/mostrador/ventas (emite el comprobante, tanda 7), que
// le pide la descarga a Go.

// sinCache: nada de esto se guarda en ningún intermediario.
func escribirJSON(w http.ResponseWriter, codigo int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "private, no-store")
	w.WriteHeader(codigo)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
}

// conStaff es la guardia de app/api/mostrador/guardia.ts: 401 sin sesión del
// personal (la cola retiene todo y pide entrar), 403 si no es del mostrador.
// Nunca un redirect: el fetch lo leería como 200.
func conStaff(log *slog.Logger, hacer func(w http.ResponseWriter, r *http.Request, ses *auth.Sesion) (any, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ses := auth.DeContexto(r.Context())
		if !ses.EsStaff() {
			escribirJSON(w, http.StatusUnauthorized, map[string]string{"error": "sesion", "detalle": "Iniciá sesión para seguir."})
			return
		}
		if !roles.PuedeEntrar("/mostrador", ses.RolStaff) {
			escribirJSON(w, http.StatusForbidden, map[string]string{"error": "rol", "detalle": "Este puesto es del mostrador. Entrá con un usuario de ventas."})
			return
		}
		v, err := hacer(w, r, ses)
		if err != nil {
			log.Error("mostrador sin conexión", "ruta", r.URL.Path, "error", err)
			plataforma.EscribirProblema(w, plataforma.NuevoProblema(http.StatusInternalServerError, "Algo falló de nuestro lado. Probá de nuevo en un momento."))
			return
		}
		escribirJSON(w, http.StatusOK, v)
	}
}

// cuerpoJSON es `await request.json().catch(() => fallback)`.
func cuerpoJSON(r *http.Request, fallback any) any {
	b, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		return fallback
	}
	var v any
	if err := json.Unmarshal(b, &v); err != nil {
		return fallback
	}
	return v
}

// Rutas registra las direcciones de siempre en el mux.
func (s *Servicio) Rutas(m *http.ServeMux) {
	m.Handle("POST /api/mostrador/latido", conStaff(s.log, func(_ http.ResponseWriter, r *http.Request, ses *auth.Sesion) (any, error) {
		cuerpo, _ := cuerpoJSON(r, map[string]any{}).(map[string]any)
		if cuerpo == nil {
			cuerpo = map[string]any{}
		}
		return s.Latido(r.Context(), ses, cuerpo)
	}))
	m.Handle("GET /api/mostrador/catalogo", conStaff(s.log, func(_ http.ResponseWriter, r *http.Request, _ *auth.Sesion) (any, error) {
		return s.Copia(r.Context(), LeerDesde(r.URL.Query().Get("desde")))
	}))
	m.Handle("GET /api/mostrador/clientes", conStaff(s.log, func(_ http.ResponseWriter, r *http.Request, _ *auth.Sesion) (any, error) {
		return s.Padron(r.Context(), LeerDesde(r.URL.Query().Get("desde")))
	}))
	m.Handle("POST /api/mostrador/caja/movimientos", conStaff(s.log, func(_ http.ResponseWriter, r *http.Request, ses *auth.Sesion) (any, error) {
		mov, l := LeerMovimientoDiferido(cuerpoJSON(r, nil))
		// Un fallo de forma es definitivo: la cola no lo reintenta.
		if _, m := l.Primero(); m != "" {
			return map[string]string{"error": "datos", "detalle": "El movimiento llegó incompleto."}, nil
		}
		return s.MovimientoDiferido(r.Context(), ses, mov)
	}))
	m.Handle("GET /api/mostrador/caja/vincular", conStaff(s.log, func(_ http.ResponseWriter, r *http.Request, _ *auth.Sesion) (any, error) {
		sucursal := r.URL.Query().Get("branchId")
		if sucursal == "" {
			return map[string]any{"cajas": []any{}}, nil
		}
		cajas, err := s.CajasParaVincular(r.Context(), sucursal)
		return map[string]any{"cajas": cajas}, err
	}))
	m.Handle("POST /api/mostrador/caja/vincular", conStaff(s.log, func(_ http.ResponseWriter, r *http.Request, _ *auth.Sesion) (any, error) {
		cuerpo, _ := cuerpoJSON(r, map[string]any{}).(map[string]any)
		id, _ := cuerpo["cajaId"].(string)
		if id == "" {
			return map[string]string{"error": "Elegí una caja."}, nil
		}
		return s.Vincular(r.Context(), id)
	}))
}
