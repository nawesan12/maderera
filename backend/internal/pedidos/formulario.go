package pedidos

import (
	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
	"mjbj/internal/zodjs"
)

// El alta de un presupuesto desde el panel (crearPresupuesto de
// app/admin/ventas-actions.ts). Next manda lo mismo que la acción le pasaba a
// safeParse —los campos del FormData con sus `|| undefined`— más las líneas
// ya leídas con JSON.parse; acá se validan con las mismas reglas y mensajes.
// Golden: crear.json.

// DiasDeValidez son quince, igual que los que nacen en el sitio.
const DiasDeValidez = 15

// CabeceraDePresupuesto es la cabecera ya leída.
type CabeceraDePresupuesto struct {
	CustomerID       *string `json:"customerId,omitempty"`
	ContactoNombre   string  `json:"contactoNombre"`
	ContactoTelefono *string `json:"contactoTelefono,omitempty"`
	ContactoEmail    *string `json:"contactoEmail,omitempty"`
	BranchID         *string `json:"branchId,omitempty"`
	SellerID         *string `json:"sellerId,omitempty"`
	Notas            *string `json:"notas,omitempty"`
	DiasValidez      float64 `json:"diasValidez"`
}

// LineaDePresupuesto es una línea ya leída.
type LineaDePresupuesto struct {
	VariantID      *string `json:"variantId"`
	Descripcion    string  `json:"descripcion"`
	Unidad         string  `json:"unidad"`
	Cantidad       float64 `json:"cantidad"`
	PrecioUnitario float64 `json:"precioUnitario"`
}

// ImportesDeLinea es lo que se guarda de cada línea (toFixed(2)).
type ImportesDeLinea struct {
	Cantidad       string `json:"cantidad"`
	PrecioUnitario string `json:"precioUnitario"`
	Subtotal       string `json:"subtotal"`
}

// AltaDePresupuesto es el formulario leído, con la plata como se guarda.
type AltaDePresupuesto struct {
	Cabecera CabeceraDePresupuesto
	Lineas   []LineaDePresupuesto
	Subtotal string
	Items    []ImportesDeLinea
}

// ErrorDeAlta es el { error } de la acción, con el campo del primer
// problema de zod (vacío para los mensajes propios).
type ErrorDeAlta struct {
	Campo, Mensaje string
}

func (e *ErrorDeAlta) Error() string { return e.Mensaje }

func leerCabecera(m map[string]any) (CabeceraDePresupuesto, *ErrorDeAlta) {
	l := zodjs.Leer(m)
	var c CabeceraDePresupuesto
	id := zodjs.Texto{Opcional: true, UUID: true}
	c.CustomerID = l.Cadena("customerId", id)
	c.ContactoNombre = l.Requerido("contactoNombre", zodjs.Texto{Recortar: true, Min: 2, MsjMin: "Poné a nombre de quién va.", Max: 160})
	c.ContactoTelefono = l.Cadena("contactoTelefono", zodjs.Texto{Opcional: true, Recortar: true, Max: 40})
	// z.string().trim().email(…).optional().or(z.literal("")): con un texto,
	// zod 4 reporta el error de la rama del texto; con otra cosa, la unión.
	if v, esta := l.Crudo("contactoEmail"); esta {
		s, es := v.(string)
		switch {
		case !es:
			l.Mal("contactoEmail", "Invalid input")
		case s == "":
			c.ContactoEmail = &s
		default:
			t := zodjs.TrimJS(s)
			if !plataforma.CorreoValido(t) {
				l.Mal("contactoEmail", "Revisá el correo.")
			}
			c.ContactoEmail = &t
		}
	}
	c.BranchID = l.Cadena("branchId", id)
	c.SellerID = l.Cadena("sellerId", id)
	c.Notas = l.Cadena("notas", zodjs.Texto{Opcional: true, Recortar: true, Max: 1000})
	if d := l.Numero("diasValidez", zodjs.Num{Coerce: true, Defecto: zodjs.F(DiasDeValidez)}, zodjs.Entero(), zodjs.Min(1), zodjs.Max(180)); d != nil {
		c.DiasValidez = *d
	}
	if campo, msj := l.Primero(); msj != "" {
		return c, &ErrorDeAlta{campo, msj}
	}
	return c, nil
}

func leerLinea(v any) (LineaDePresupuesto, bool) {
	l := zodjs.Raiz(v)
	var x LineaDePresupuesto
	x.VariantID = l.Cadena("variantId", zodjs.Texto{Nulo: true, UUID: true})
	x.Descripcion = l.Requerido("descripcion", zodjs.Texto{Recortar: true, Min: 1, Max: 300})
	x.Unidad = l.Requerido("unidad", zodjs.Texto{Recortar: true, Max: 30, Defecto: zodjs.S("unidad")})
	if n := l.Numero("cantidad", zodjs.Num{Coerce: true}, zodjs.Positivo(), zodjs.Max(1_000_000)); n != nil {
		x.Cantidad = *n
	}
	if n := l.Numero("precioUnitario", zodjs.Num{Coerce: true}, zodjs.Min(0), zodjs.Max(100_000_000)); n != nil {
		x.PrecioUnitario = *n
	}
	return x, l.Ok()
}

// LeerAltaDePresupuesto valida el formulario y hace las cuentas: el
// subtotal es la suma sin redondear de cantidad × precio, y cada cosa se
// guarda con toFixed(2) (por eso el total puede diferir en un centavo de la
// suma de los renglones guardados: así lo hacía el TS).
func LeerAltaDePresupuesto(cabecera map[string]any, lineas []any) (*AltaDePresupuesto, *ErrorDeAlta) {
	c, e := leerCabecera(cabecera)
	if e != nil {
		return nil, e
	}
	alta := &AltaDePresupuesto{Cabecera: c}
	for _, cruda := range lineas {
		x, ok := leerLinea(cruda)
		if !ok {
			return nil, &ErrorDeAlta{Mensaje: "Hay una línea con datos incompletos."}
		}
		alta.Lineas = append(alta.Lineas, x)
	}
	if len(alta.Lineas) == 0 {
		return nil, &ErrorDeAlta{Mensaje: "Agregá al menos un producto."}
	}
	suma := 0.0
	for _, x := range alta.Lineas {
		suma += float64(x.Cantidad * x.PrecioUnitario)
		alta.Items = append(alta.Items, ImportesDeLinea{
			Cantidad:       jsmath.ToFixed(x.Cantidad, 2),
			PrecioUnitario: jsmath.ToFixed(x.PrecioUnitario, 2),
			Subtotal:       jsmath.ToFixed(float64(x.Cantidad*x.PrecioUnitario), 2),
		})
	}
	alta.Subtotal = jsmath.ToFixed(suma, 2)
	return alta, nil
}
