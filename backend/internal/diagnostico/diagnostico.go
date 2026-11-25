// Package diagnostico recibe los errores de hidratación que reporta el
// navegador (POST /api/diagnostico, la misma dirección que tenía Next:
// lib/diagnostico/registro.ts y app/api/diagnostico/route.ts) y los deja en
// el log. Solo los de hidratación: el resto lo ve el servidor solo.
package diagnostico

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"unicode/utf16"

	"mjbj/internal/limites"
	"mjbj/internal/plataforma"
)

var codigoReact = regexp.MustCompile(`(?i)(react\.dev/errors/|React error #)(418|419|421|422|423|425)`)
var textoDeHidratacion = regexp.MustCompile(`(?i)Hydration|hydrat|could not finish this Suspense boundary|did not finish this Suspense boundary`)

// EsErrorDeHidratacion es esErrorDeHidratacion. El `(?!\d)` del TS (que
// «4180» no pase por 418) va a mano: RE2 no tiene lookahead.
func EsErrorDeHidratacion(m string) bool {
	if textoDeHidratacion.MatchString(m) {
		return true
	}
	for _, i := range codigoReact.FindAllStringIndex(m, -1) {
		if i[1] >= len(m) || m[i[1]] < '0' || m[i[1]] > '9' {
			return true
		}
	}
	return false
}

var saltos = regexp.MustCompile(`[\r\n]+`)

// texto es el del TS: sin saltos de línea, recortado y cortado a `largo`
// unidades de UTF-16 (el slice de JS); "" si no es texto o queda vacío.
func texto(v any, largo int) string {
	s, ok := v.(string)
	if !ok {
		return ""
	}
	s = strings.TrimSpace(saltos.ReplaceAllString(s, " "))
	u := utf16.Encode([]rune(s))
	if len(u) > largo {
		s = string(utf16.Decode(u[:largo]))
	}
	return s
}

// Reporte es lo que manda el navegador.
type Reporte struct {
	Ruta    string `json:"ruta"`
	Mensaje string `json:"mensaje"`
	Pila    string `json:"pila,omitempty"`
	Build   string `json:"build,omitempty"`
}

// Leer es leerReporte: nil si no es un error de hidratación bien formado.
func Leer(cuerpo any) *Reporte {
	d, ok := cuerpo.(map[string]any)
	if !ok {
		return nil
	}
	r := Reporte{Ruta: texto(d["ruta"], 300), Mensaje: texto(d["mensaje"], 500)}
	if r.Ruta == "" || !strings.HasPrefix(r.Ruta, "/") || r.Mensaje == "" || !EsErrorDeHidratacion(r.Mensaje) {
		return nil
	}
	r.Pila, r.Build = texto(d["pila"], 1000), texto(d["build"], 40)
	return &r
}

// Handler es POST /api/diagnostico: 413 si pasa de 4000 bytes, 400 si no se
// entiende, 429 pasado el freno (20 por hora por IP), 204 si quedó anotado.
func Handler(lim *limites.Limitador, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		crudo, err := io.ReadAll(io.LimitReader(r.Body, 4001))
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if len(crudo) > 4000 {
			w.WriteHeader(http.StatusRequestEntityTooLarge)
			return
		}
		var cuerpo any
		if json.Unmarshal(crudo, &cuerpo) != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		rep := Leer(cuerpo)
		if rep == nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if v := lim.Permitido(r.Context(), limites.Diagnostico, plataforma.IPDelCliente(r)); !v.Permitido {
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		log.Error("diagnostico.navegador", "ruta", rep.Ruta, "mensaje", rep.Mensaje, "pila", rep.Pila, "build", rep.Build)
		w.WriteHeader(http.StatusNoContent)
	}
}
