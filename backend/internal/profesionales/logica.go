// Package profesionales es el portal de profesionales y los eventos (tanda
// 10): las solicitudes de acceso y su aprobación (la ficha que gana, la
// lista, el límite y el rol), el estado profesional de quien mira, y los
// eventos con cupo: el panel, la inscripción con el candado por evento y
// los avisos (la confirmación y el recordatorio del día anterior).
//
// El cobro de un evento con precio sigue en TS (Mercado Pago, tanda 6): Go
// reserva el lugar y Next arma la preferencia.
package profesionales

import (
	"fmt"
	"regexp"
	"strings"
	"time"

	"golang.org/x/text/unicode/norm"

	"mjbj/internal/cuit"
	"mjbj/internal/email"
	"mjbj/internal/formato"
	"mjbj/internal/zod"
)

/* ------------------------------ formularios ------------------------------ */

// Rubros del enum de la solicitud (el formulario no ofrece «cementista»).
var rubrosSolicitud = []string{"arquitecto", "constructora", "carpintero", "disenador", "instalador", "woodframer", "otro"}

// Solicitud es lo validado del formulario público.
type Solicitud struct {
	Nombre, DocumentoTipo, DocumentoNumero, Email, Telefono, Rubro string
	RazonSocial, VolumenEstimado, RedSocial, Mensaje               *string
}

func opcional(l *zod.Lector, campo string) *string {
	if !l.Tiene(campo) {
		return nil
	}
	v := l.Texto(campo)
	return &v
}

// DocumentoValido es documentoValido de lib/cuit.ts.
func DocumentoValido(tipo, numero string) bool {
	if numero == "" {
		return false
	}
	if tipo == "cuit" {
		return cuit.Valido(numero)
	}
	return cuit.DniValido(numero)
}

// ValidarSolicitud es el esquema de app/(public)/profesionales/actions.ts.
func ValidarSolicitud(m map[string]any) (Solicitud, *zod.Lector) {
	l := zod.Nuevo(m)
	l.String("nombre", false).Trim().Min(3, "Escribí tu nombre y apellido.").Max(120, "")
	l.String("razonSocial", true).Trim().Max(160, "")
	tipo := l.Enum("documentoTipo", "dni", "cuit")
	l.String("documentoNumero", false).Trim().Min(1, "Dejanos tu DNI o CUIT.")
	l.String("email", false).Trim().Email("Revisá el correo.")
	l.String("telefono", false).Trim().Min(6, "Dejanos un teléfono.").Max(40, "")
	rubro := l.Enum("rubro", rubrosSolicitud...)
	l.String("volumenEstimado", true).Trim().Max(120, "")
	l.String("redSocial", true).Trim().Max(160, "")
	l.String("mensaje", true).Trim().Max(600, "")
	// El refine del objeto corre solo si todo lo demás validó.
	if l.Ok() && !DocumentoValido(tipo, l.Texto("documentoNumero")) {
		l.Mal("documentoNumero", "Revisá el número: no coincide con el tipo de documento.")
	}
	return Solicitud{
		Nombre: l.Texto("nombre"), DocumentoTipo: tipo, DocumentoNumero: l.Texto("documentoNumero"), Email: l.Texto("email"),
		Telefono: l.Texto("telefono"), Rubro: rubro, RazonSocial: opcional(l, "razonSocial"),
		VolumenEstimado: opcional(l, "volumenEstimado"), RedSocial: opcional(l, "redSocial"), Mensaje: opcional(l, "mensaje"),
	}, l
}

// ValidarAprobar es el de la aprobación (id, lista y límite).
func ValidarAprobar(m map[string]any) (id string, lista, limite *string, l *zod.Lector) {
	l = zod.Nuevo(m)
	l.String("id", false).UUID()
	l.String("priceListId", true).UUID()
	l.String("limiteCredito", true)
	return l.Texto("id"), opcional(l, "priceListId"), opcional(l, "limiteCredito"), l
}

// ValidarRechazar es el del rechazo (el motivo es obligatorio).
func ValidarRechazar(m map[string]any) (id, motivo string, l *zod.Lector) {
	l = zod.Nuevo(m)
	l.String("id", false).UUID()
	l.String("motivo", false).Trim().Min(5, "Escribí el motivo: se lo mandamos al solicitante.").Max(300, "")
	return l.Texto("id"), l.Texto("motivo"), l
}

// FormEvento es lo validado del alta de un evento.
type FormEvento struct {
	Titulo, Inicia              string
	Resumen, Descripcion, Lugar *string
	Termina, Precio             *string
	Cupo                        int
	SoloProfesionales           bool
}

// ValidarEvento es el esquema de crearEvento.
func ValidarEvento(m map[string]any) (FormEvento, *zod.Lector) {
	l := zod.Nuevo(m)
	l.String("titulo", false).Trim().Min(4, "Poné un título.").Max(160, "")
	l.String("resumen", true).Trim().Max(300, "")
	l.String("descripcion", true).Trim().Max(4000, "")
	l.String("lugar", true).Trim().Max(200, "")
	l.String("inicia", false).Min(1, "Falta la fecha.")
	l.String("termina", true)
	cupo := l.EnteroCoercido("cupo", 0, 10000)
	l.String("precio", true)
	solo := l.Booleano("soloProfesionales")
	f := FormEvento{Titulo: l.Texto("titulo"), Inicia: l.Texto("inicia"), Resumen: opcional(l, "resumen"),
		Descripcion: opcional(l, "descripcion"), Lugar: opcional(l, "lugar"), Termina: opcional(l, "termina"),
		Precio: opcional(l, "precio"), SoloProfesionales: solo}
	if l.Ok() {
		f.Cupo = int(cupo)
	}
	return f, l
}

// ValidarEstadoEvento es el de publicar, cerrar o cancelar.
func ValidarEstadoEvento(m map[string]any) (id, estado string, l *zod.Lector) {
	l = zod.Nuevo(m)
	l.String("id", false).UUID()
	estado = l.Enum("estado", "borrador", "publicado", "cerrado", "cancelado")
	return l.Texto("id"), estado, l
}

// ValidarAsistencia es el de tomar asistencia.
func ValidarAsistencia(m map[string]any) (id, estado string, l *zod.Lector) {
	l = zod.Nuevo(m)
	l.String("id", false).UUID()
	estado = l.Enum("estado", "asistio", "ausente", "confirmada", "cancelada")
	return l.Texto("id"), estado, l
}

// Anotarse es lo validado de la inscripción pública.
type Anotarse struct {
	EventID, Slug, Nombre, Email string
	Telefono                     *string
}

// ValidarAnotarse es el esquema de app/(public)/eventos/actions.ts.
func ValidarAnotarse(m map[string]any) (Anotarse, *zod.Lector) {
	l := zod.Nuevo(m)
	l.String("eventId", false).UUID()
	l.String("slug", false).Min(1, "")
	l.String("nombre", false).Trim().Min(3, "Escribí tu nombre y apellido.").Max(120, "")
	l.String("email", false).Trim().Email("Revisá el correo.")
	l.String("telefono", true).Trim().Max(40, "")
	return Anotarse{EventID: l.Texto("eventId"), Slug: l.Texto("slug"), Nombre: l.Texto("nombre"), Email: l.Texto("email"),
		Telefono: opcional(l, "telefono")}, l
}

var (
	reMarcas   = regexp.MustCompile(`[\x{0300}-\x{036f}]`)
	reNoSlug   = regexp.MustCompile(`[^a-z0-9]+`)
	reBordeSlg = regexp.MustCompile(`^-|-$`)
)

// ASlug es aSlug de app/admin/eventos/actions.ts: sin tildes, en minúsculas,
// con guiones, hasta 80.
func ASlug(texto string) string {
	s := reMarcas.ReplaceAllString(norm.NFD.String(texto), "")
	s = strings.ToLower(s)
	s = reNoSlug.ReplaceAllString(s, "-")
	s = reBordeSlg.ReplaceAllString(s, "")
	if len(s) > 80 { // ya es ASCII
		s = s[:80]
	}
	return s
}

/* ------------------------------ fichas ------------------------------ */

// Candidata es una ficha encontrada (por CUIT o por la cuenta web).
type Candidata struct {
	ID     string  `json:"id"`
	UserID *string `json:"userId"`
}

// Decision es qué ficha se marca como profesional al aprobar.
type Decision struct {
	Destino           *string `json:"destino"`
	Liberar           *string `json:"liberar"`
	VincularCuentaWeb bool    `json:"vincularCuentaWeb"`
}

// DecidirFicha es decidirFicha de lib/profesionales/fichas.ts: gana la
// ficha con CUIT (la que tiene la historia comercial) y la cuenta web se
// muda a ella solo si está libre.
func DecidirFicha(porCuit, porUsuario *Candidata, userID string) Decision {
	if porCuit == nil && porUsuario == nil {
		return Decision{}
	}
	if porCuit == nil {
		return Decision{Destino: &porUsuario.ID}
	}
	if porUsuario != nil && porUsuario.ID == porCuit.ID {
		return Decision{Destino: &porCuit.ID}
	}
	d := Decision{Destino: &porCuit.ID, VincularCuentaWeb: userID != "" && (porCuit.UserID == nil || *porCuit.UserID == "")}
	if porUsuario != nil {
		d.Liberar = &porUsuario.ID
	}
	return d
}

/* ------------------------------ plantillas ------------------------------ */

// Correo es un aviso armado.
type Correo struct {
	Asunto string `json:"asunto"`
	HTML   string `json:"html"`
	Texto  string `json:"texto"`
}

func armarCorreo(sitio, asunto string, o email.Opciones) Correo {
	h, t := email.Envolver(sitio, o)
	return Correo{Asunto: asunto, HTML: h, Texto: t}
}

// AcuseDeRecibo es el correo de «recibimos tu solicitud».
func AcuseDeRecibo(sitio, nombre string) Correo {
	return armarCorreo(sitio, "Recibimos tu solicitud de acceso profesional", email.Opciones{
		Titulo:   "Recibimos tu solicitud",
		Adelanto: "Estamos revisando tu acceso al portal de profesionales.",
		Saludo:   nombre,
		Parrafos: []string{
			"Un asesor la va a revisar y te contestamos dentro de las próximas 24 horas hábiles.",
			"Si necesitás algo antes, escribinos por WhatsApp y lo vemos.",
		},
	})
}

// Bienvenida es el correo de la aprobación.
func Bienvenida(sitio, nombre string, lista *string, limite float64) Correo {
	parrafos := []string{"Los precios que ves en el catálogo ahora son los tuyos: entrás con tu cuenta y el sitio te muestra la lista profesional, con los descuentos por volumen ya aplicados."}
	var datos []email.Bloque
	if lista != nil && *lista != "" {
		datos = append(datos, email.Bloque{Etiqueta: "Lista de precios", Valor: *lista})
	}
	if limite > 0 {
		parrafos = append(parrafos, "También te habilitamos cuenta corriente, así podés comprar y abonar después.")
		datos = append(datos, email.Bloque{Etiqueta: "Límite de cuenta corriente", Valor: "$ " + formato.Numero(limite)})
	}
	return armarCorreo(sitio, "Tu acceso profesional está activo", email.Opciones{
		Titulo:   "Tu acceso profesional está activo",
		Adelanto: "Ya tenés precios diferenciados en el catálogo.",
		Saludo:   nombre,
		Parrafos: parrafos,
		Datos:    datos,
		CTA:      &email.Enlace{Texto: "Entrar al catálogo", URL: strings.TrimSuffix(sitio, "/") + "/catalogo"},
		Cierre:   "Desde tu cuenta también podés pedir presupuestos express, con respuesta en 24 horas, y descargar la documentación técnica.",
	})
}

// Rechazo es el correo del rechazo, con el motivo.
func Rechazo(sitio, nombre string, motivo *string) Correo {
	parrafos := []string{"Por ahora no pudimos habilitarte el acceso al portal de profesionales."}
	if motivo != nil && *motivo != "" {
		parrafos = append(parrafos, "<strong>Motivo:</strong> "+*motivo)
	}
	parrafos = append(parrafos, "Si creés que hay un error o querés que lo revisemos, contestá este correo o escribinos por WhatsApp: la mayoría de los casos se resuelven hablando.")
	return armarCorreo(sitio, "Sobre tu solicitud de acceso profesional", email.Opciones{
		Titulo:   "Sobre tu solicitud de acceso profesional",
		Adelanto: "Novedades de tu solicitud.",
		Saludo:   nombre,
		Parrafos: parrafos,
	})
}

// DatosDelEvento es lo que va en los avisos de un evento.
type DatosDelEvento struct {
	Nombre, Evento, Cuando, Slug string
	Lugar                        *string
	Precio                       float64
}

// Confirmacion es el correo de «quedaste anotado».
func Confirmacion(sitio string, d DatosDelEvento) Correo {
	datos := []email.Bloque{{Etiqueta: "Cuándo", Valor: d.Cuando}}
	if d.Lugar != nil && *d.Lugar != "" {
		datos = append(datos, email.Bloque{Etiqueta: "Dónde", Valor: *d.Lugar})
	}
	costo := "Sin cargo"
	if d.Precio > 0 {
		costo = formato.MonedaEntera(d.Precio)
	}
	datos = append(datos, email.Bloque{Etiqueta: "Costo", Valor: costo})
	return armarCorreo(sitio, "Anotado: "+d.Evento, email.Opciones{
		Titulo:   "Te esperamos en " + d.Evento,
		Adelanto: "Quedaste anotado para el " + d.Cuando + ".",
		Saludo:   d.Nombre,
		Parrafos: []string{"Quedaste anotado. Guardate la fecha."},
		Datos:    datos,
		CTA:      &email.Enlace{Texto: "Ver los detalles", URL: strings.TrimSuffix(sitio, "/") + "/eventos/" + d.Slug},
		Cierre:   "Si no vas a poder venir, avisanos así le damos el lugar a otra persona.",
	})
}

// Recordatorio es el correo del día anterior.
func Recordatorio(sitio string, d DatosDelEvento) Correo {
	datos := []email.Bloque{{Etiqueta: "Cuándo", Valor: d.Cuando}}
	if d.Lugar != nil && *d.Lugar != "" {
		datos = append(datos, email.Bloque{Etiqueta: "Dónde", Valor: *d.Lugar})
	}
	return armarCorreo(sitio, "Mañana te esperamos: "+d.Evento, email.Opciones{
		Titulo:   "Mañana: " + d.Evento,
		Adelanto: "Te esperamos " + d.Cuando + ".",
		Saludo:   d.Nombre,
		Parrafos: []string{"Es mañana. Te dejamos los datos para que no los busques."},
		Datos:    datos,
		CTA:      &email.Enlace{Texto: "Cómo llegar", URL: strings.TrimSuffix(sitio, "/") + "/eventos/" + d.Slug},
	})
}

var meses = []string{"enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"}

// Zona es la de Buenos Aires.
var Zona = func() *time.Location {
	l, err := time.LoadLocation("America/Argentina/Buenos_Aires")
	if err != nil {
		return time.FixedZone("-03", -3*3600)
	}
	return l
}()

// CuandoSeLee es «5 de noviembre de 2026, 18:00», en hora de Buenos Aires
// (el TS usaba la zona del servidor, UTC en producción).
func CuandoSeLee(t time.Time) string {
	l := t.In(Zona)
	return fmt.Sprintf("%d de %s de %d, %02d:%02d", l.Day(), meses[l.Month()-1], l.Year(), l.Hour(), l.Minute())
}

// PrimeraPalabra es `nombre.split(" ")[0]`.
func PrimeraPalabra(nombre string) string {
	return strings.SplitN(nombre, " ", 2)[0]
}
