package correo

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"mjbj/internal/plataforma"
	"mjbj/internal/sqlc"
)

// La casilla compartida (ventas@ la leen varios): cada conversación puede
// tener dueño y estado, para que dos personas no contesten lo mismo, y
// notas internas que el cliente nunca ve. Más los seguimientos («si no
// contesta en N días, avisame»), las respuestas guardadas y el tiempo de
// respuesta por persona.
//
// Todo eso es del correo y vive en sus tablas (correo_*, migración 00080);
// del ERP solo se lee quién es staff. Sin base, nada de esto aparece.
//
// La sesión es de una casilla, no de una persona: en una compartida, quién
// está sentado lo dice la pantalla (la persona elegida, guardada en ese
// navegador) y viaja en cada pedido. Por omisión es el dueño de la casilla.

// Estados de una conversación.
var estadosHilo = map[string]bool{"nuevo": true, "en-curso": true, "esperando": true, "resuelto": true}

// conEquipo corta si no hay base o la casilla no es de staff.
func (a *App) conEquipo(w http.ResponseWriter, r *http.Request, cred Credenciales) bool {
	if a.erp == nil {
		plataforma.EscribirProblema(w, plataforma.NuevoProblema(http.StatusNotFound, "El correo no está conectado con el panel."))
		return false
	}
	if rol, _, _ := a.erp.Staff(r.Context(), cred.Correo); rol == "" {
		plataforma.EscribirProblema(w, plataforma.NuevoProblema(http.StatusNotFound, "Esta casilla no es del equipo."))
		return false
	}
	return true
}

func (a *App) tope(r *http.Request) (context.Context, context.CancelFunc) {
	return context.WithTimeout(r.Context(), topeERP)
}

// persona valida que el id venga de alguien del equipo; si no, vacío.
func (a *App) persona(ctx context.Context, id string) string {
	if id == "" {
		return ""
	}
	personas, err := a.erp.q.PersonasDelCorreo(ctx)
	if err != nil {
		return ""
	}
	for _, p := range personas {
		if p.ID == id {
			return id
		}
	}
	return ""
}

type respuestaEquipo struct {
	Personas []sqlc.PersonasDelCorreoRow `json:"personas"`
	// Dueno es la persona dueña de la casilla, la que se propone por omisión.
	Dueno string `json:"dueno,omitempty"`
}

func (a *App) equipo(w http.ResponseWriter, r *http.Request, cred Credenciales) {
	if !a.conEquipo(w, r, cred) {
		return
	}
	ctx, cancelar := a.tope(r)
	defer cancelar()
	personas, err := a.erp.q.PersonasDelCorreo(ctx)
	if err != nil {
		a.fallarERP(w, r, err)
		return
	}
	_, dueno, _ := a.erp.Staff(r.Context(), cred.Correo)
	plataforma.EscribirJSON(w, http.StatusOK, respuestaEquipo{Personas: personas, Dueno: dueno})
}

func (a *App) fallarERP(w http.ResponseWriter, r *http.Request, err error) {
	a.log.Warn("correo: el ERP", "ruta", r.URL.Path, "error", err)
	plataforma.EscribirProblema(w, plataforma.NuevoProblema(http.StatusServiceUnavailable, "El panel no responde. El correo sigue andando; probá en un rato."))
}

// hilos devuelve el estado y el dueño de las conversaciones pedidas.
func (a *App) hilos(w http.ResponseWriter, r *http.Request, cred Credenciales) {
	if !a.conEquipo(w, r, cred) {
		return
	}
	pedidos := r.URL.Query()["h"]
	if len(pedidos) > 200 {
		pedidos = pedidos[:200]
	}
	ctx, cancelar := a.tope(r)
	defer cancelar()
	filas, err := a.erp.q.HilosDe(ctx, sqlc.HilosDeParams{Casilla: cred.Correo, Hilos: pedidos})
	if err != nil {
		a.fallarERP(w, r, err)
		return
	}
	out := make(map[string]sqlc.HilosDeRow, len(filas))
	for _, f := range filas {
		out[f.Hilo] = f
	}
	plataforma.EscribirJSON(w, http.StatusOK, out)
}

type pedidoHilo struct {
	Hilo      string     `json:"hilo"`
	Asunto    string     `json:"asunto"`
	Remitente string     `json:"remitente"`
	Recibido  *time.Time `json:"recibido"`
	Estado    string     `json:"estado"`
	AsignadoA string     `json:"asignadoA"`
	Soltar    bool       `json:"soltar"`
}

func (a *App) guardarHilo(w http.ResponseWriter, r *http.Request, cred Credenciales) {
	if !a.conEquipo(w, r, cred) {
		return
	}
	var p pedidoHilo
	if prob := plataforma.LeerJSON(w, r, &p, 8<<10); prob != nil {
		plataforma.EscribirProblema(w, prob)
		return
	}
	p.Hilo = strings.Trim(p.Hilo, "<> ")
	if p.Hilo == "" || (p.Estado != "" && !estadosHilo[p.Estado]) {
		plataforma.EscribirProblema(w, plataforma.Invalido(map[string]string{"estado": "Ese estado no existe."}))
		return
	}
	ctx, cancelar := a.tope(r)
	defer cancelar()
	if p.AsignadoA != "" && a.persona(ctx, p.AsignadoA) == "" {
		plataforma.EscribirProblema(w, plataforma.Invalido(map[string]string{"asignadoA": "Esa persona no es del equipo."}))
		return
	}
	err := a.erp.q.GuardarHilo(ctx, sqlc.GuardarHiloParams{
		Casilla: cred.Correo, Hilo: p.Hilo, Asunto: recortar(p.Asunto, 300), Remitente: recortar(p.Remitente, 300),
		Estado: p.Estado, AsignadoA: p.AsignadoA, RecibidoAt: p.Recibido, Soltar: p.Soltar,
	})
	if err != nil {
		a.fallarERP(w, r, err)
		return
	}
	filas, err := a.erp.q.HilosDe(ctx, sqlc.HilosDeParams{Casilla: cred.Correo, Hilos: []string{p.Hilo}})
	if err != nil || len(filas) == 0 {
		a.fallarERP(w, r, errors.Join(err, errors.New("el hilo no quedó guardado")))
		return
	}
	plataforma.EscribirJSON(w, http.StatusOK, filas[0])
}

func recortar(s string, n int) string {
	if r := []rune(s); len(r) > n {
		return string(r[:n])
	}
	return s
}

func (a *App) notas(w http.ResponseWriter, r *http.Request, cred Credenciales) {
	if !a.conEquipo(w, r, cred) {
		return
	}
	ctx, cancelar := a.tope(r)
	defer cancelar()
	filas, err := a.erp.q.NotasDe(ctx, sqlc.NotasDeParams{Casilla: cred.Correo, Hilo: strings.Trim(r.URL.Query().Get("h"), "<> ")})
	if err != nil {
		a.fallarERP(w, r, err)
		return
	}
	plataforma.EscribirJSON(w, http.StatusOK, filas)
}

type pedidoNota struct {
	pedidoHilo
	AutorID string `json:"autorId"`
	Texto   string `json:"texto"`
}

func (a *App) crearNota(w http.ResponseWriter, r *http.Request, cred Credenciales) {
	if !a.conEquipo(w, r, cred) {
		return
	}
	var p pedidoNota
	if prob := plataforma.LeerJSON(w, r, &p, 32<<10); prob != nil {
		plataforma.EscribirProblema(w, prob)
		return
	}
	p.Hilo = strings.Trim(p.Hilo, "<> ")
	p.Texto = strings.TrimSpace(p.Texto)
	if p.Hilo == "" || p.Texto == "" || len([]rune(p.Texto)) > 4000 {
		plataforma.EscribirProblema(w, plataforma.Invalido(map[string]string{"texto": "Escribí la nota (hasta 4000 letras)."}))
		return
	}
	ctx, cancelar := a.tope(r)
	defer cancelar()
	autor := cred.Correo
	id := a.persona(ctx, p.AutorID)
	if id != "" {
		if personas, err := a.erp.q.PersonasDelCorreo(ctx); err == nil {
			for _, x := range personas {
				if x.ID == id {
					autor = x.Nombre
				}
			}
		}
	}
	// La conversación existe aunque nadie la haya asignado todavía.
	if err := a.erp.q.GuardarHilo(ctx, sqlc.GuardarHiloParams{
		Casilla: cred.Correo, Hilo: p.Hilo, Asunto: recortar(p.Asunto, 300), Remitente: recortar(p.Remitente, 300), RecibidoAt: p.Recibido,
	}); err != nil {
		a.fallarERP(w, r, err)
		return
	}
	nota, err := a.erp.q.CrearNota(ctx, sqlc.CrearNotaParams{Casilla: cred.Correo, Hilo: p.Hilo, AutorID: id, Autor: autor, Texto: p.Texto})
	if err != nil {
		a.fallarERP(w, r, err)
		return
	}
	plataforma.EscribirJSON(w, http.StatusCreated, nota)
}

func (a *App) borrarNota(w http.ResponseWriter, r *http.Request, cred Credenciales) {
	if !a.conEquipo(w, r, cred) {
		return
	}
	ctx, cancelar := a.tope(r)
	defer cancelar()
	n, err := a.erp.q.BorrarNota(ctx, sqlc.BorrarNotaParams{ID: r.PathValue("id"), Casilla: cred.Correo})
	if err != nil || n == 0 {
		plataforma.EscribirProblema(w, plataforma.NuevoProblema(http.StatusNotFound, "Esa nota ya no está."))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *App) tiempos(w http.ResponseWriter, r *http.Request, cred Credenciales) {
	if !a.conEquipo(w, r, cred) {
		return
	}
	dias, _ := strconv.Atoi(r.URL.Query().Get("dias"))
	if dias <= 0 || dias > 365 {
		dias = 30
	}
	ctx, cancelar := a.tope(r)
	defer cancelar()
	filas, err := a.erp.q.TiemposDeRespuesta(ctx, sqlc.TiemposDeRespuestaParams{Casilla: cred.Correo, Dias: int32(dias)})
	if err != nil {
		a.fallarERP(w, r, err)
		return
	}
	plataforma.EscribirJSON(w, http.StatusOK, filas)
}

// despuesDeEnviar anota en las tablas del correo lo que dejó un envío: la
// respuesta (para el tiempo de respuesta y el estado) y el seguimiento
// pedido. Si la base no responde, el correo ya salió igual: solo se avisa
// en el registro.
func (a *App) despuesDeEnviar(ctx context.Context, cred Credenciales, b *Borrador, campos func(string) string) {
	if a.erp == nil {
		return
	}
	if rol, _, _ := a.erp.Staff(ctx, cred.Correo); rol == "" {
		return
	}
	ctx, cancelar := context.WithTimeout(context.WithoutCancel(ctx), topeERP)
	defer cancelar()
	persona := a.persona(ctx, campos("persona"))
	hilo := b.MessageID
	if len(b.Referencias) > 0 {
		hilo = b.Referencias[0]
	} else if b.EnRespuestaA != "" {
		hilo = b.EnRespuestaA
	}
	var recibido *time.Time
	if t, err := time.Parse(time.RFC3339, campos("recibido")); err == nil {
		recibido = &t
	}
	if b.EnRespuestaA != "" {
		if err := a.erp.q.AnotarRespuesta(ctx, sqlc.AnotarRespuestaParams{
			Casilla: cred.Correo, Hilo: hilo, Asunto: recortar(b.Asunto, 300), Remitente: recortar(campos("remitente"), 300),
			Persona: persona, RecibidoAt: recibido,
		}); err != nil {
			a.log.Warn("correo: anotando la respuesta", "error", err)
		}
	}
	if dias, _ := strconv.Atoi(campos("seguimiento")); dias > 0 && dias <= 90 && len(b.Para) > 0 {
		ahora := time.Now()
		if _, err := a.erp.q.CrearSeguimiento(ctx, sqlc.CrearSeguimientoParams{
			Casilla: cred.Correo, Hilo: hilo, Para: strings.ToLower(direccionSola(b.Para[0])), Asunto: recortar(b.Asunto, 300),
			EnviadoAt: ahora, VenceAt: ahora.AddDate(0, 0, dias), CreadoPor: persona,
		}); err != nil {
			a.log.Warn("correo: creando el seguimiento", "error", err)
		}
	}
}

// direccionSola saca la dirección de «Nombre <dir>».
func direccionSola(s string) string {
	if i := strings.LastIndexByte(s, '<'); i >= 0 {
		return strings.Trim(s[i:], "<> ")
	}
	return strings.TrimSpace(s)
}
