package campanas

import (
	"regexp"
	"strconv"
	"time"

	"mjbj/internal/zod"
)

// Los formularios de app/admin/campanas/actions.ts y app/admin/avisos/
// acciones.ts, validados como sus esquemas de zod (golden form-*.json).

const mensajeEnlace = "Tiene que empezar con https:// o con / (una página del sitio)."

// FormCampana es lo que se guarda de una campaña.
type FormCampana struct {
	Asunto     string
	Adelanto   *string
	Cuerpo     string
	ImagenURL  *string
	BotonTexto *string
	BotonURL   *string
}

func opcional(l *zod.Lector, campo string) *string {
	if !l.Tiene(campo) {
		return nil
	}
	v := l.Texto(campo)
	return &v
}

// ValidarCampana es el esquema de la campaña.
func ValidarCampana(m map[string]any) (FormCampana, *zod.Lector) {
	l := zod.Nuevo(m)
	l.String("asunto", false).Trim().Min(3, "Falta el asunto.").Max(150, "El asunto es demasiado largo: en el celular se corta a los 40 caracteres.")
	l.String("adelanto", true).Trim().Max(150, "")
	l.String("cuerpo", false).Trim().Min(10, "Falta el texto de la campaña.").Max(10000, "")
	l.String("imagenUrl", true).Trim().Max(500, "").Refinar(zod.EsEnlace, mensajeEnlace)
	l.String("botonTexto", true).Trim().Max(40, "")
	l.String("botonUrl", true).Trim().Max(500, "").Refinar(zod.EsEnlace, mensajeEnlace)
	return FormCampana{
		Asunto: l.Texto("asunto"), Adelanto: opcional(l, "adelanto"), Cuerpo: l.Texto("cuerpo"),
		ImagenURL: opcional(l, "imagenUrl"), BotonTexto: opcional(l, "botonTexto"), BotonURL: opcional(l, "botonUrl"),
	}, l
}

// ValidarAvisoActivo es el de prender o apagar un aviso.
func ValidarAvisoActivo(m map[string]any) (id string, activo bool, l *zod.Lector) {
	l = zod.Nuevo(m)
	l.String("id", false).UUID()
	a := l.Enum("activo", "si", "no")
	return l.Texto("id"), a == "si", l
}

// ValidarAvisoTexto es el del asunto y el encabezado de un aviso.
func ValidarAvisoTexto(m map[string]any) (id, asunto string, encabezado *string, l *zod.Lector) {
	l = zod.Nuevo(m)
	l.String("id", false).UUID()
	l.String("asunto", false).Trim().Min(3, "El asunto no puede quedar vacío.").Max(120, "")
	l.String("encabezado", true).Trim().Max(160, "")
	return l.Texto("id"), l.Texto("asunto"), opcional(l, "encabezado"), l
}

var reLocal = regexp.MustCompile(`^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$`)

// zonaFija es -03:00, como `new Date(`${cuando}:00-03:00`)` del TS (la
// Argentina no tiene horario de verano desde 2009).
var zonaFija = time.FixedZone("-03", -3*3600)

// LeerHoraLocal lee lo que manda un `datetime-local` como hora de Buenos
// Aires. Como el Date de JS, un día que no existe (30/2) pasa al siguiente
// y 24:00 es la medianoche del día siguiente.
func LeerHoraLocal(cuando string) (time.Time, bool) {
	m := reLocal.FindStringSubmatch(cuando)
	if m == nil {
		return time.Time{}, false
	}
	n := make([]int, 5)
	for i := range n {
		n[i], _ = strconv.Atoi(m[i+1])
	}
	anio, mes, dia, hora, minuto := n[0], n[1], n[2], n[3], n[4]
	if mes < 1 || mes > 12 || dia < 1 || dia > 31 || hora > 24 || minuto > 59 || (hora == 24 && minuto != 0) {
		return time.Time{}, false
	}
	return time.Date(anio, time.Month(mes), dia, hora, minuto, 0, 0, zonaFija), true
}
