// Package clientes es la cartera de clientes del panel: el alta (rápida y
// completa), la ficha, los vendedores, el seguimiento y el documento.
package clientes

import (
	"strings"

	"mjbj/internal/cuit"
)

// Documento es el CUIT o el DNI de un cliente, ya validado.
type Documento struct {
	Tipo    string `json:"tipo"` // cuit | dni | ninguno
	Digitos string `json:"digitos,omitempty"`
}

// LeerDocumento es leerDocumento: lo vacío es «ninguno»; once dígitos, un
// CUIT; siete u ocho, un DNI. Devuelve el documento o el error.
func LeerDocumento(texto string) (Documento, string) {
	d := cuit.SoloDigitos(texto)
	switch {
	case len(d) == 0:
		return Documento{Tipo: "ninguno"}, ""
	case len(d) == 11:
		if cuit.Valido(d) {
			return Documento{"cuit", d}, ""
		}
		return Documento{}, "El CUIT no es válido: revisá los números, el último es el verificador."
	case len(d) == 7 || len(d) == 8:
		if cuit.DniValido(d) {
			return Documento{"dni", d}, ""
		}
		return Documento{}, "El DNI no es válido."
	}
	return Documento{}, "Un CUIT tiene 11 números y un DNI, 7 u 8."
}

// SugerirCondicionIva: un CUIT de empresa (30, 33, 34) suele ser responsable
// inscripto; lo demás, consumidor final.
func SugerirCondicionIva(doc Documento) string {
	if doc.Tipo != "cuit" {
		return "consumidor_final"
	}
	switch doc.Digitos[:2] {
	case "30", "33", "34":
		return "responsable_inscripto"
	}
	return "consumidor_final"
}

// PrecargaDelAlta: lo que se buscó y no se encontró precarga el alta, en el
// nombre o en el documento según parezca.
func PrecargaDelAlta(busqueda string) (nombre, documento string) {
	limpio := strings.TrimSpace(busqueda)
	d := cuit.SoloDigitos(limpio)
	sinSeparadores := strings.NewReplacer(" ", "", "\t", "", "\n", "", ".", "", "-", "").Replace(limpio)
	if len(d) >= 7 && len(d) >= len([]rune(sinSeparadores)) {
		return "", limpio
	}
	return limpio, ""
}
