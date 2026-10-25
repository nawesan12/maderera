package correo

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/x509"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"mime"
	"net/http"
	"net/mail"
	"os"
	"path"
	"strconv"
	"strings"
	"time"

	"mjbj/internal/plataforma"
)

// Config es la configuración del webmail, de las variables de entorno.
type Config struct {
	Escuchar   string `env:"CORREO_ESCUCHAR" envDefault:":8090"`
	IMAP       string `env:"CORREO_IMAP,required"` // mail.mjbj.com.ar:993
	SMTP       string `env:"CORREO_SMTP,required"` // mail.mjbj.com.ar
	PuertoSMTP int    `env:"CORREO_PUERTO_SMTP" envDefault:"587"`
	NombreTLS  string `env:"CORREO_NOMBRE_TLS,required"`
	// Clave de 32 bytes en base64 para sellar las sesiones. Cambiarla cierra
	// todas las sesiones abiertas, que es lo que se quiere si se filtró.
	Clave string `env:"CORREO_CLAVE,required"`
	// Falso solo en desarrollo, sin HTTPS.
	Segura bool `env:"CORREO_SEGURA" envDefault:"true"`
	// Un PEM con la CA del certificado del servidor de correo, solo para
	// probar contra uno con certificado propio. En producción va vacío.
	CA string `env:"CORREO_CA"`
	// La conexión, opcional, con el ERP (erp.go).
	ERP ConfigERP
}

// App es el webmail: la API y la SPA.
type App struct {
	srv      *Servidor
	sesiones *Sellador
	intentos *Intentos
	log      *slog.Logger
	estatico fs.FS
	// erp es nil si no hay base: el correo anda igual, sin fichas.
	erp *ERP
}

// ConERP conecta la app con el ERP (puede ser nil).
func (a *App) ConERP(e *ERP) { a.erp = e }

// Nueva arma la app. `estatico` es la SPA ya compilada.
func Nueva(cfg Config, estatico fs.FS, log *slog.Logger) (*App, error) {
	clave, err := base64.StdEncoding.DecodeString(cfg.Clave)
	if err != nil {
		return nil, fmt.Errorf("CORREO_CLAVE no es base64: %w", err)
	}
	sellador, err := NuevoSellador(clave, cfg.Segura)
	if err != nil {
		return nil, err
	}
	srv := &Servidor{IMAP: cfg.IMAP, SMTP: cfg.SMTP, PuertoSMTP: cfg.PuertoSMTP, NombreTLS: cfg.NombreTLS}
	if cfg.CA != "" {
		pem, err := os.ReadFile(cfg.CA)
		if err != nil {
			return nil, fmt.Errorf("CORREO_CA: %w", err)
		}
		srv.CAs = x509.NewCertPool()
		if !srv.CAs.AppendCertsFromPEM(pem) {
			return nil, fmt.Errorf("CORREO_CA: %s no tiene ningún certificado PEM", cfg.CA)
		}
	}
	return &App{
		srv:      srv,
		sesiones: sellador,
		// Cinco claves mal en un cuarto de hora: por IP y por casilla.
		// Mientras la casilla está bloqueada no entra ni la clave buena: es
		// lo que frena un ataque repartido entre muchas IP, a cambio de que
		// alguien pueda dejar afuera a una casilla durante ese rato.
		intentos: NuevosIntentos(5, 15*time.Minute),
		log:      log,
		estatico: estatico,
	}, nil
}

// Rutas devuelve el manejador completo, con la cadena de plataforma.
func (a *App) Rutas() http.Handler {
	m := http.NewServeMux()
	m.HandleFunc("GET /salud", func(w http.ResponseWriter, _ *http.Request) { _, _ = io.WriteString(w, "ok") })

	m.HandleFunc("POST /api/sesion", a.entrar)
	m.HandleFunc("GET /api/sesion", a.conSesion(a.sesion))
	m.HandleFunc("DELETE /api/sesion", a.salir)

	m.HandleFunc("GET /api/carpetas", a.conSesion(a.carpetas))
	m.HandleFunc("GET /api/carpetas/{carpeta}/mensajes", a.conSesion(a.lista))
	m.HandleFunc("GET /api/carpetas/{carpeta}/mensajes/{uid}", a.conSesion(a.mensaje))
	m.HandleFunc("GET /api/carpetas/{carpeta}/mensajes/{uid}/html", a.conSesion(a.html))
	m.HandleFunc("GET /api/carpetas/{carpeta}/mensajes/{uid}/adjuntos/{indice}", a.conSesion(a.adjunto))
	m.HandleFunc("GET /api/carpetas/{carpeta}/mensajes/{uid}/adjuntos.zip", a.conSesion(a.zip))
	m.HandleFunc("POST /api/carpetas/{carpeta}/acciones", a.conSesion(a.acciones))
	m.HandleFunc("POST /api/enviar", a.conSesion(a.enviar))

	m.HandleFunc("GET /api/remitentes", a.conSesion(a.remitentes))
	m.HandleFunc("GET /api/cliente", a.conSesion(a.cliente))
	m.HandleFunc("GET /api/contactos", a.conSesion(a.contactos))

	m.HandleFunc("POST /api/presupuesto", a.conSesion(a.presupuesto))

	m.HandleFunc("GET /api/equipo", a.conSesion(a.equipo))
	m.HandleFunc("GET /api/hilos", a.conSesion(a.hilos))
	m.HandleFunc("PUT /api/hilos", a.conSesion(a.guardarHilo))
	m.HandleFunc("GET /api/hilos/notas", a.conSesion(a.notas))
	m.HandleFunc("POST /api/hilos/notas", a.conSesion(a.crearNota))
	m.HandleFunc("DELETE /api/hilos/notas/{id}", a.conSesion(a.borrarNota))
	m.HandleFunc("GET /api/tiempos", a.conSesion(a.tiempos))
	m.HandleFunc("GET /api/seguimientos", a.conSesion(a.seguimientos))
	m.HandleFunc("DELETE /api/seguimientos/{id}", a.conSesion(a.cancelarSeguimiento))
	m.HandleFunc("GET /api/plantillas", a.conSesion(a.plantillas))
	m.HandleFunc("PUT /api/plantillas", a.conSesion(a.guardarPlantilla))
	m.HandleFunc("DELETE /api/plantillas/{id}", a.conSesion(a.borrarPlantilla))

	m.Handle("GET /", a.spa())
	return plataforma.Cadena(m, a.log)
}

// Barrer borra de memoria los intentos viejos. Se llama cada tanto.
func (a *App) Barrer() {
	a.intentos.mu.Lock()
	defer a.intentos.mu.Unlock()
	ahora := a.intentos.ahora()
	for clave := range a.intentos.fallos {
		a.intentos.vigentes(clave, ahora)
	}
}

type manejadorConSesion func(http.ResponseWriter, *http.Request, Credenciales)

func (a *App) conSesion(h manejadorConSesion) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cred, err := a.sesiones.Leer(w, r)
		if err != nil {
			plataforma.EscribirProblema(w, plataforma.NuevoProblema(http.StatusUnauthorized, "La sesión se cerró. Volvé a entrar."))
			return
		}
		h(w, r, cred)
	}
}

// fallar traduce los errores del correo a respuestas.
func (a *App) fallar(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrCredenciales):
		// La clave cambió desde otro lado mientras la sesión seguía abierta.
		a.sesiones.Cerrar(w)
		plataforma.EscribirProblema(w, plataforma.NuevoProblema(http.StatusUnauthorized, "La clave de la casilla cambió. Volvé a entrar."))
	case errors.Is(err, ErrBloqueado):
		plataforma.EscribirProblema(w, plataforma.NuevoProblema(http.StatusForbidden, "Ese adjunto es un programa y no se puede bajar: puede ser un virus."))
	case errors.Is(err, ErrNoExiste):
		plataforma.EscribirProblema(w, plataforma.NuevoProblema(http.StatusNotFound, "Ese mensaje o carpeta ya no está."))
	case errors.Is(err, ErrRechazado):
		plataforma.EscribirProblema(w, plataforma.NuevoProblema(http.StatusUnprocessableEntity, "El servidor no aceptó el envío. Revisá los destinatarios."))
	case errors.Is(err, context.Canceled):
		// Quien pidió se fue; no hay a quién contestarle.
	default:
		a.log.Error("correo", "id", plataforma.IDDelPedido(r.Context()), "ruta", r.URL.Path, "error", err)
		plataforma.EscribirProblema(w, plataforma.NuevoProblema(http.StatusBadGateway, "No pudimos hablar con el servidor de correo. Probá de nuevo en un rato."))
	}
}

// --- sesión ---

type pedidoEntrar struct {
	Correo string `json:"correo"`
	Clave  string `json:"clave"`
}

type respuestaSesion struct {
	Correo string `json:"correo"`
	// Panel es la dirección del panel para «Volver al panel».
	Panel string `json:"panel,omitempty"`
	// Fichas dice si la casilla ve las fichas de clientes del ERP.
	Fichas bool `json:"fichas"`
	// Persona es quién del staff es dueño de la casilla, si se sabe.
	Persona string `json:"persona,omitempty"`
	// Equipo dice si están las funciones de casilla compartida (asignar,
	// notas, seguimientos, respuestas guardadas): base y casilla de staff.
	Equipo bool `json:"equipo"`
}

func (a *App) datosSesion(ctx context.Context, correo string) respuestaSesion {
	r := respuestaSesion{Correo: correo}
	if a.erp == nil {
		return r
	}
	if p := a.erp.Panel(); p != "" {
		r.Panel = p + "/admin"
	}
	rol, _, nombre := a.erp.Staff(ctx, correo)
	r.Fichas = rol == "admin" || rol == "vendedor"
	r.Equipo = rol != ""
	r.Persona = nombre
	return r
}

func (a *App) entrar(w http.ResponseWriter, r *http.Request) {
	var p pedidoEntrar
	if prob := plataforma.LeerJSON(w, r, &p, 4<<10); prob != nil {
		plataforma.EscribirProblema(w, prob)
		return
	}
	p.Correo = strings.ToLower(strings.TrimSpace(p.Correo))
	errs := map[string]string{}
	if _, err := mail.ParseAddress(p.Correo); err != nil || !strings.Contains(p.Correo, "@") {
		errs["correo"] = "Escribí la dirección completa, por ejemplo ventas@mjbj.com.ar."
	}
	if p.Clave == "" {
		errs["clave"] = "Falta la clave."
	}
	if len(errs) > 0 {
		plataforma.EscribirProblema(w, plataforma.Invalido(errs))
		return
	}
	ip := "ip:" + plataforma.IPDelCliente(r)
	casilla := "casilla:" + p.Correo
	if !a.intentos.Permitido(ip, casilla) {
		w.Header().Set("Retry-After", "900")
		plataforma.EscribirProblema(w, plataforma.NuevoProblema(http.StatusTooManyRequests,
			"Hubo demasiados intentos con clave equivocada. Esperá un cuarto de hora y probá de nuevo."))
		return
	}
	cred := Credenciales{Correo: p.Correo, Clave: p.Clave}
	if err := a.srv.Probar(r.Context(), cred); err != nil {
		if errors.Is(err, ErrCredenciales) {
			a.intentos.Fallo(ip, casilla)
			a.log.Warn("entrada fallida", "casilla", p.Correo, "ip", plataforma.IPDelCliente(r))
			plataforma.EscribirProblema(w, plataforma.Invalido(map[string]string{"clave": "La casilla o la clave no son correctas."}))
			return
		}
		a.fallar(w, r, err)
		return
	}
	a.intentos.Limpiar(casilla)
	if err := a.sesiones.Iniciar(w, cred); err != nil {
		a.fallar(w, r, err)
		return
	}
	plataforma.EscribirJSON(w, http.StatusOK, a.datosSesion(r.Context(), cred.Correo))
}

func (a *App) sesion(w http.ResponseWriter, r *http.Request, cred Credenciales) {
	plataforma.EscribirJSON(w, http.StatusOK, a.datosSesion(r.Context(), cred.Correo))
}

// --- el ERP ---

// conFichas corta acá si no hay ERP o si la casilla no puede ver clientes.
// Para afuera, «no podés» y «no hay base» son lo mismo: un 404, sin datos.
func (a *App) conFichas(w http.ResponseWriter, r *http.Request, cred Credenciales) bool {
	if a.erp == nil || !a.erp.VeFichas(r.Context(), cred.Correo) {
		plataforma.EscribirProblema(w, plataforma.NuevoProblema(http.StatusNotFound, "No hay fichas para mostrar."))
		return false
	}
	return true
}

func (a *App) remitentes(w http.ResponseWriter, r *http.Request, cred Credenciales) {
	if !a.conFichas(w, r, cred) {
		return
	}
	correos := r.URL.Query()["correo"]
	if len(correos) > 200 {
		correos = correos[:200]
	}
	for i, c := range correos {
		correos[i] = strings.ToLower(strings.TrimSpace(c))
	}
	son, err := a.erp.Clientes(r.Context(), correos)
	if err != nil {
		a.log.Warn("correo: remitentes", "error", err)
		son = []string{}
	}
	plataforma.EscribirJSON(w, http.StatusOK, son)
}

func (a *App) cliente(w http.ResponseWriter, r *http.Request, cred Credenciales) {
	if !a.conFichas(w, r, cred) {
		return
	}
	f, err := a.erp.FichaDe(r.Context(), r.URL.Query().Get("correo"))
	if err != nil {
		if !errors.Is(err, ErrSinFicha) {
			a.log.Warn("correo: ficha", "error", err)
		}
		plataforma.EscribirProblema(w, plataforma.NuevoProblema(http.StatusNotFound, "No es cliente."))
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=60")
	plataforma.EscribirJSON(w, http.StatusOK, f)
}

func (a *App) contactos(w http.ResponseWriter, r *http.Request, cred Credenciales) {
	if !a.conFichas(w, r, cred) {
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if len([]rune(q)) < 2 {
		plataforma.EscribirJSON(w, http.StatusOK, []Contacto{})
		return
	}
	lista, err := a.erp.Contactos(r.Context(), q)
	if err != nil {
		a.log.Warn("correo: contactos", "error", err)
		lista = []Contacto{}
	}
	plataforma.EscribirJSON(w, http.StatusOK, lista)
}

func (a *App) salir(w http.ResponseWriter, _ *http.Request) {
	a.sesiones.Cerrar(w)
	w.WriteHeader(http.StatusNoContent)
}

// --- carpetas y mensajes ---

func (a *App) carpetas(w http.ResponseWriter, r *http.Request, cred Credenciales) {
	lista, err := a.srv.Carpetas(r.Context(), cred)
	if err != nil {
		a.fallar(w, r, err)
		return
	}
	plataforma.EscribirJSON(w, http.StatusOK, lista)
}

func (a *App) lista(w http.ResponseWriter, r *http.Request, cred Credenciales) {
	q := r.URL.Query()
	f := Filtro{
		Texto:        strings.TrimSpace(q.Get("q")),
		SinLeer:      q.Get("filtro") == "sin-leer",
		SinResponder: q.Get("filtro") == "sin-responder",
		Destacados:   q.Get("filtro") == "destacados",
		ConAdjuntos:  q.Get("adjuntos") == "si",
		De:           strings.TrimSpace(q.Get("de")),
	}
	if dias, err := strconv.Atoi(q.Get("dias")); err == nil && dias > 0 && dias <= 3650 {
		f.Desde = time.Now().AddDate(0, 0, -dias)
	}
	pagina, _ := strconv.Atoi(q.Get("pagina"))
	res, err := a.srv.Lista(r.Context(), cred, r.PathValue("carpeta"), f, pagina)
	if err != nil {
		a.fallar(w, r, err)
		return
	}
	plataforma.EscribirJSON(w, http.StatusOK, res)
}

func uidDe(r *http.Request) (uint32, bool) {
	n, err := strconv.ParseUint(r.PathValue("uid"), 10, 32)
	return uint32(n), err == nil && n > 0
}

func (a *App) mensaje(w http.ResponseWriter, r *http.Request, cred Credenciales) {
	uid, ok := uidDe(r)
	if !ok {
		a.fallar(w, r, ErrNoExiste)
		return
	}
	m, err := a.srv.Abrir(r.Context(), cred, r.PathValue("carpeta"), uid)
	if err != nil {
		a.fallar(w, r, err)
		return
	}
	plataforma.EscribirJSON(w, http.StatusOK, m)
}

// El documento que va adentro del iframe. Lo que lo hace seguro no es el
// saneo sino la CSP: sin scripts, sin formularios, sin pedidos a ningún lado
// salvo las imágenes remotas cuando la persona las permite.
const documentoHTML = `<!doctype html><html lang="es"><head><meta charset="utf-8"><base target="_blank">
<style>html{color-scheme:light}body{margin:0;padding:16px;font:15px/1.5 system-ui,sans-serif;color:#1c1917;background:#fff;overflow-wrap:anywhere}img{max-width:100%%;height:auto}table{max-width:100%%}blockquote{margin:0 0 0 .5em;padding-left:.75em;border-left:3px solid #e7e5e4;color:#57534e}a[data-enganoso]{position:relative;color:#a8480a;text-decoration-style:dotted;text-underline-offset:3px}a[data-enganoso]:hover::after,a[data-enganoso]:focus::after{content:attr(data-enganoso);position:absolute;left:0;top:calc(100%% + 8px);z-index:2;width:max-content;max-width:320px;padding:10px 12px;border-radius:10px;background:#fff;color:#b3261e;font:600 14px/1.45 system-ui,sans-serif;box-shadow:0 20px 50px -12px rgb(40 30 20/.35),0 0 0 1px #e8e4de;white-space:normal}</style>
</head><body>%s</body></html>`

func (a *App) html(w http.ResponseWriter, r *http.Request, cred Credenciales) {
	uid, ok := uidDe(r)
	if !ok {
		a.fallar(w, r, ErrNoExiste)
		return
	}
	cuerpo, err := a.srv.HTML(r.Context(), cred, r.PathValue("carpeta"), uid)
	if err != nil {
		a.fallar(w, r, err)
		return
	}
	imagenes := "data:"
	if r.URL.Query().Get("imagenes") == "si" {
		imagenes = "data: https: http:"
	}
	h := w.Header()
	h.Set("Content-Type", "text/html; charset=utf-8")
	h.Set("Cache-Control", "private, no-store")
	h.Set("Content-Security-Policy",
		"default-src 'none'; style-src 'unsafe-inline'; img-src "+imagenes+"; font-src data:; "+
			"sandbox allow-popups allow-popups-to-escape-sandbox; frame-ancestors 'self'; base-uri 'none'; form-action 'none'")
	h.Set("X-Frame-Options", "SAMEORIGIN")
	_, _ = fmt.Fprintf(w, documentoHTML, cuerpo)
}

// Los tipos que se pueden mostrar en el navegador en vez de bajarse. Todo lo
// demás se baja: un HTML adjunto abierto en el mismo origen podría leer la
// sesión.
var seVenEnElNavegador = map[string]bool{
	"image/png": true, "image/jpeg": true, "image/gif": true, "image/webp": true,
	"application/pdf": true, "text/plain": true,
}

func (a *App) adjunto(w http.ResponseWriter, r *http.Request, cred Credenciales) {
	uid, ok := uidDe(r)
	indice, err := strconv.Atoi(r.PathValue("indice"))
	if !ok || err != nil || indice < 0 {
		a.fallar(w, r, ErrNoExiste)
		return
	}
	parte, err := a.srv.Adjunto(r.Context(), cred, r.PathValue("carpeta"), uid, indice, "")
	if err != nil {
		a.fallar(w, r, err)
		return
	}
	tipo := strings.ToLower(parte.Tipo)
	disposicion := "attachment"
	if r.URL.Query().Get("ver") == "si" && seVenEnElNavegador[tipo] {
		disposicion = "inline"
	} else {
		tipo = "application/octet-stream"
	}
	h := w.Header()
	h.Set("Content-Type", tipo)
	h.Set("Content-Disposition", mime.FormatMediaType(disposicion, map[string]string{"filename": path.Base(parte.Nombre)}))
	h.Set("Content-Length", strconv.Itoa(len(parte.Datos)))
	h.Set("Cache-Control", "private, max-age=3600")
	csp := "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'; sandbox"
	if tipo == "application/pdf" {
		// El visor de PDF de Chrome no arranca en un documento con
		// `sandbox`, y el visor del correo (2i) lo muestra en un iframe. Un
		// PDF no ejecuta nada en este origen: lo dibuja el navegador.
		csp = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'"
	}
	h.Set("Content-Security-Policy", csp)
	_, _ = w.Write(parte.Datos)
}

// zip baja varios adjuntos juntos (2g, «Descargar todo»). Se arma en
// memoria —los adjuntos ya están en memoria al desarmar el mensaje, y el
// servidor de correo no acepta más de 25 MB— para mandar el largo y que la
// pantalla muestre el avance.
func (a *App) zip(w http.ResponseWriter, r *http.Request, cred Credenciales) {
	uid, ok := uidDe(r)
	if !ok {
		a.fallar(w, r, ErrNoExiste)
		return
	}
	var indices []int
	for _, t := range strings.Split(r.URL.Query().Get("i"), ",") {
		if n, err := strconv.Atoi(strings.TrimSpace(t)); err == nil && n >= 0 {
			indices = append(indices, n)
		}
	}
	partes, err := a.srv.Varios(r.Context(), cred, r.PathValue("carpeta"), uid, indices)
	if err != nil {
		a.fallar(w, r, err)
		return
	}
	var buf bytes.Buffer
	z := zip.NewWriter(&buf)
	usados := map[string]int{}
	for _, p := range partes {
		nombre := nombreUnico(path.Base(p.Nombre), usados)
		f, err := z.CreateHeader(&zip.FileHeader{Name: nombre, Method: zip.Deflate, Modified: time.Now()})
		if err == nil {
			_, err = f.Write(p.Datos)
		}
		if err != nil {
			a.fallar(w, r, err)
			return
		}
	}
	if err := z.Close(); err != nil {
		a.fallar(w, r, err)
		return
	}
	h := w.Header()
	h.Set("Content-Type", "application/zip")
	h.Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": "adjuntos.zip"}))
	h.Set("Content-Length", strconv.Itoa(buf.Len()))
	h.Set("Cache-Control", "private, no-store")
	_, _ = w.Write(buf.Bytes())
}

// nombreUnico evita que dos adjuntos con el mismo nombre se pisen en el
// .zip: el segundo «foto.jpg» pasa a «foto (2).jpg».
func nombreUnico(nombre string, usados map[string]int) string {
	if nombre == "" || nombre == "." || nombre == "/" {
		nombre = "adjunto"
	}
	usados[nombre]++
	if n := usados[nombre]; n > 1 {
		ext := path.Ext(nombre)
		return fmt.Sprintf("%s (%d)%s", strings.TrimSuffix(nombre, ext), n, ext)
	}
	return nombre
}

type pedidoAcciones struct {
	UIDs    []uint32 `json:"uids"`
	Accion  Accion   `json:"accion"`
	Destino string   `json:"destino,omitempty"`
}

var accionesValidas = map[Accion]bool{
	AccionLeido: true, AccionNoLeido: true, AccionDestacar: true, AccionNoDestacar: true,
	AccionArchivar: true, AccionPapelera: true, AccionSpam: true, AccionMover: true, AccionRestaurar: true,
	AccionEtiquetar: true, AccionDesetiquetar: true,
}

func (a *App) acciones(w http.ResponseWriter, r *http.Request, cred Credenciales) {
	var p pedidoAcciones
	if prob := plataforma.LeerJSON(w, r, &p, 64<<10); prob != nil {
		plataforma.EscribirProblema(w, prob)
		return
	}
	if !accionesValidas[p.Accion] {
		plataforma.EscribirProblema(w, plataforma.Invalido(map[string]string{"accion": "Esa acción no existe."}))
		return
	}
	if len(p.UIDs) > 1000 {
		plataforma.EscribirProblema(w, plataforma.Invalido(map[string]string{"uids": "Son demasiados de una vez: hasta 1000."}))
		return
	}
	if err := a.srv.Aplicar(r.Context(), cred, r.PathValue("carpeta"), p.UIDs, p.Accion, p.Destino); err != nil {
		a.fallar(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func separarDirecciones(s string) []string {
	var out []string
	for _, d := range strings.FieldsFunc(s, func(r rune) bool { return r == ',' || r == ';' || r == '\n' }) {
		if d = strings.TrimSpace(d); d != "" {
			out = append(out, d)
		}
	}
	return out
}

func (a *App) enviar(w http.ResponseWriter, r *http.Request, cred Credenciales) {
	r.Body = http.MaxBytesReader(w, r.Body, TopeAdjuntos+2<<20)
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		plataforma.EscribirProblema(w, plataforma.Invalido(map[string]string{"adjuntos": "Los adjuntos pasan los 18 MB."}))
		return
	}
	defer func() { _ = r.MultipartForm.RemoveAll() }()
	f := r.MultipartForm.Value
	valor := func(k string) string {
		if v := f[k]; len(v) > 0 {
			return v[0]
		}
		return ""
	}
	uid, _ := strconv.ParseUint(valor("uid"), 10, 32)
	b := &Borrador{
		Nombre:       strings.TrimSpace(valor("nombre")),
		Para:         separarDirecciones(valor("para")),
		CC:           separarDirecciones(valor("cc")),
		CCO:          separarDirecciones(valor("cco")),
		Asunto:       strings.TrimSpace(valor("asunto")),
		Texto:        valor("texto"),
		HTML:         politica.Sanitize(valor("html")),
		EnRespuestaA: strings.Trim(valor("enRespuestaA"), "<> "),
		Referencias:  strings.Fields(strings.NewReplacer("<", " ", ">", " ").Replace(valor("referencias"))),
		Carpeta:      valor("carpeta"),
		UID:          uint32(uid),
	}
	for _, archivo := range r.MultipartForm.File["adjuntos"] {
		fh, err := archivo.Open()
		if err != nil {
			a.fallar(w, r, err)
			return
		}
		datos, err := io.ReadAll(fh)
		_ = fh.Close()
		if err != nil {
			a.fallar(w, r, err)
			return
		}
		b.Adjuntos = append(b.Adjuntos, ArchivoAdjunto{
			Nombre: path.Base(archivo.Filename), Tipo: archivo.Header.Get("Content-Type"), Datos: datos,
		})
	}
	if errs := b.Validar(); len(errs) > 0 {
		plataforma.EscribirProblema(w, plataforma.Invalido(errs))
		return
	}
	registrar := func(que string, err error) {
		a.log.Warn("después de enviar", "que", que, "casilla", cred.Correo, "error", err)
	}
	if err := a.srv.Enviar(r.Context(), cred, b, registrar); err != nil {
		a.fallar(w, r, err)
		return
	}
	a.despuesDeEnviar(r.Context(), cred, b, valor)
	w.WriteHeader(http.StatusNoContent)
}

// --- la SPA ---

// La política de la página principal. `frame-src 'self'` es por el iframe
// del cuerpo HTML; `img-src` deja las imágenes de adjuntos (mismo origen) y
// las vistas previas que arma el navegador (blob:).
const cspSPA = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; " +
	"frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"

func (a *App) spa() http.Handler {
	archivos := http.FileServerFS(a.estatico)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ruta := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if strings.HasPrefix(ruta, "api/") {
			plataforma.EscribirProblema(w, plataforma.NuevoProblema(http.StatusNotFound, "Esa ruta no existe."))
			return
		}
		w.Header().Set("Content-Security-Policy", cspSPA)
		if ruta != "" {
			if _, err := fs.Stat(a.estatico, ruta); err == nil {
				// Los archivos de Vite llevan el hash en el nombre: no cambian nunca.
				if strings.HasPrefix(ruta, "_app/immutable/") || strings.HasPrefix(ruta, "assets/") {
					w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
				}
				archivos.ServeHTTP(w, r)
				return
			}
		}
		// Cualquier otra ruta es de la SPA: se sirve el index y la resuelve el
		// router del navegador.
		w.Header().Set("Cache-Control", "no-cache")
		r2 := r.Clone(r.Context())
		r2.URL.Path = "/"
		archivos.ServeHTTP(w, r2)
	})
}
