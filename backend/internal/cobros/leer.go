package cobros

import (
	"encoding/json"
	"regexp"
	"slices"
	"strings"
	"time"

	"mjbj/internal/plataforma"
	"mjbj/internal/precios"
)

var reFecha = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

var argentina = func() *time.Location {
	l, err := time.LoadLocation("America/Argentina/Buenos_Aires")
	if err != nil {
		return time.FixedZone("ART", -3*3600)
	}
	return l
}()

type parteCruda struct {
	Medio      *string          `json:"medio"`
	Importe    *string          `json:"importe"`
	Referencia *string          `json:"referencia"`
	ChequeID   *string          `json:"chequeId"`
	Cheque     *json.RawMessage `json:"cheque"`
}

type chequeCrudo struct {
	Numero    *string `json:"numero"`
	Banco     *string `json:"banco"`
	Librador  *string `json:"librador"`
	FechaPago *string `json:"fechaPago"`
}

// LeerPartes es leerPartes: el JSON que manda el formulario de cobro, con
// las reglas y los mensajes del esquema de zod. Devuelve las partes o el
// primer error.
func LeerPartes(crudo string) ([]Parte, string) {
	var lista []parteCruda
	if err := json.Unmarshal([]byte(crudo), &lista); err != nil {
		return nil, "No se pudo leer cómo paga. Volvé a cargarlo."
	}
	var out []Parte
	for _, p := range lista {
		medio := ""
		if p.Medio != nil {
			medio = *p.Medio
		}
		if !slices.Contains(Medios, Medio(medio)) {
			return nil, `Invalid option: expected one of "efectivo"|"transferencia"|"deposito"|"cheque"|"echeq"|"tarjeta_debito"|"tarjeta_credito"|"mercado_pago"|"retencion"`
		}
		if p.Importe == nil {
			return nil, "Invalid input: expected string, received undefined"
		}
		x := Parte{Medio: Medio(medio), Importe: precios.ParsearImporte(*p.Importe)}
		if p.Referencia != nil {
			r := strings.TrimSpace(*p.Referencia)
			if plataforma.LargoJS(r) > 120 {
				return nil, "Too big: expected string to have <=120 characters"
			}
			if r != "" {
				x.Referencia = &r
			}
		}
		if p.ChequeID != nil && *p.ChequeID != "" {
			if !plataforma.UUIDValido(*p.ChequeID) {
				return nil, "Invalid UUID"
			}
			x.ChequeID = p.ChequeID
		} else if p.ChequeID != nil {
			// zod valida la forma aunque esté vacío: "" no es un UUID.
			return nil, "Invalid UUID"
		}
		if p.Cheque != nil && string(*p.Cheque) != "null" {
			var c chequeCrudo
			if err := json.Unmarshal(*p.Cheque, &c); err != nil {
				return nil, "Revisá cómo paga."
			}
			numero, banco := strings.TrimSpace(deref(c.Numero)), strings.TrimSpace(deref(c.Banco))
			switch {
			case plataforma.LargoJS(numero) > 40:
				return nil, "Too big: expected string to have <=40 characters"
			case plataforma.LargoJS(banco) > 80:
				return nil, "Too big: expected string to have <=80 characters"
			}
			var librador *string
			if c.Librador != nil {
				l := strings.TrimSpace(*c.Librador)
				if plataforma.LargoJS(l) > 120 {
					return nil, "Too big: expected string to have <=120 characters"
				}
				if l != "" {
					librador = &l
				}
			}
			f := deref(c.FechaPago)
			if !reFecha.MatchString(f) {
				return nil, "Poné la fecha de pago del cheque."
			}
			// new Date(`${v}T12:00:00`): el mediodía de ese día, acá.
			fecha, err := time.ParseInLocation("2006-01-02T15:04:05", f+"T12:00:00", argentina)
			if err != nil {
				return nil, "Poné la fecha de pago del cheque."
			}
			x.Cheque = &ChequeNuevo{Numero: numero, Banco: banco, Librador: librador, FechaPago: fecha}
		}
		out = append(out, x)
	}
	if len(lista) > 20 {
		return nil, "Son demasiados medios en un solo cobro."
	}
	if out == nil {
		out = []Parte{}
	}
	return out, ""
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
