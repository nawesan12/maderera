// Package plataforma tiene lo que comparte cada servicio de MJBJ: la
// configuración, el registro, los errores HTTP y el servidor con su apagado
// ordenado. Nada de lo que hay acá sabe de maderas ni de correo.
package plataforma

import (
	"encoding/json"
	"net/http"
	"reflect"
)

// Problema es un error HTTP con el formato de RFC 9457
// (`application/problem+json`). `Errores` lleva los mensajes por campo, que
// las pantallas muestran al lado de cada input: es lo mismo que devolvía zod
// en las server actions, y por eso los mensajes van en castellano y listos
// para mostrar.
type Problema struct {
	Tipo    string            `json:"type,omitempty"`
	Titulo  string            `json:"title"`
	Estado  int               `json:"status"`
	Detalle string            `json:"detail,omitempty"`
	Errores map[string]string `json:"errores,omitempty"`
}

func (p *Problema) Error() string {
	if p.Detalle != "" {
		return p.Titulo + ": " + p.Detalle
	}
	return p.Titulo
}

// NuevoProblema arma un problema con el título por omisión del código.
func NuevoProblema(estado int, detalle string) *Problema {
	return &Problema{Titulo: http.StatusText(estado), Estado: estado, Detalle: detalle}
}

// Invalido es el 422 de un formulario con errores por campo.
func Invalido(errores map[string]string) *Problema {
	return &Problema{
		Titulo:  "Revisá los datos",
		Estado:  http.StatusUnprocessableEntity,
		Errores: errores,
	}
}

// EscribirProblema manda el problema como respuesta.
func EscribirProblema(w http.ResponseWriter, p *Problema) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(p.Estado)
	_ = json.NewEncoder(w).Encode(p)
}

// EscribirJSON manda un 200 (o el código que se diga) con el cuerpo en JSON.
// Nada de lo que sale de una API de MJBJ se cachea por omisión: lo público y
// cacheable lo declara cada ruta.
func EscribirJSON(w http.ResponseWriter, estado int, cuerpo any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	if w.Header().Get("Cache-Control") == "" {
		w.Header().Set("Cache-Control", "no-store")
	}
	w.WriteHeader(estado)
	_ = json.NewEncoder(w).Encode(SinNulos(cuerpo))
}

// SinNulos cambia una lista nil por una vacía: en JSON, nil sale `null` y
// el contrato (y quien hace `.map`) espera `[]`. sqlc ya devuelve listas
// vacías (emit_empty_slices); esto cubre las que arma el código.
func SinNulos(v any) any {
	r := reflect.ValueOf(v)
	if r.Kind() == reflect.Slice && r.IsNil() {
		return reflect.MakeSlice(r.Type(), 0, 0).Interface()
	}
	return v
}

// LeerJSON decodifica el cuerpo con un tope de tamaño y sin campos de más:
// un campo que la API no conoce casi siempre es un error de quien llama, y es
// mejor que falle a la vista.
func LeerJSON(w http.ResponseWriter, r *http.Request, destino any, tope int64) *Problema {
	r.Body = http.MaxBytesReader(w, r.Body, tope)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(destino); err != nil {
		return NuevoProblema(http.StatusBadRequest, "El cuerpo no es un JSON válido para esta ruta.")
	}
	return nil
}
