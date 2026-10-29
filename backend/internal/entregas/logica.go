package entregas

import (
	"math"
	"strings"

	"mjbj/internal/jsmath"
	"mjbj/internal/precios"
	"mjbj/internal/zodjs"
)

// La lógica pura de las entregas, la que cubre el golden
// (scripts/golden/entregas.ts): el saldo de cada renglón, lo que se controla
// antes de sacar mercadería, y lo que leían los esquemas de zod de las
// acciones (prepararRemito, firmarRemito y guardarZona).

// Renglon es RenglonPendiente: lo pedido, lo entregado y lo que queda.
type Renglon struct {
	OrderItemID string  `json:"orderItemId"`
	Descripcion string  `json:"descripcion"`
	Unidad      string  `json:"unidad"`
	Pedido      float64 `json:"pedido"`
	Entregado   float64 `json:"entregado"`
	Pendiente   float64 `json:"pendiente"`
}

// maxCero es Math.max(x, 0) (NaN sigue siendo NaN).
func maxCero(x float64) float64 {
	if math.IsNaN(x) {
		return x
	}
	if x > 0 {
		return x
	}
	return 0
}

// NuevoRenglon arma un renglón con lo que devuelve la base (los numeric como
// texto, leídos con Number como hacía el TS).
func NuevoRenglon(id, descripcion, unidad, pedido, entregado string) Renglon {
	p, e := jsmath.Numero(pedido), jsmath.Numero(entregado)
	return Renglon{OrderItemID: id, Descripcion: descripcion, Unidad: unidad, Pedido: p, Entregado: e, Pendiente: maxCero(p - e)}
}

// SoloPendientes es el filtro de saldoAlRemito: lo que quedaba en acopio.
func SoloPendientes(rs []Renglon) []Renglon {
	out := []Renglon{}
	for _, r := range rs {
		if r.Pendiente > 0 {
			out = append(out, r)
		}
	}
	return out
}

// LineaAEntregar es un renglón que sale con el remito.
type LineaAEntregar struct {
	OrderItemID string  `json:"orderItemId"`
	Cantidad    float64 `json:"cantidad"`
}

// ControlDeEntrega es lo que contesta ValidarEntrega.
type ControlDeEntrega struct {
	Error    string           `json:"error,omitempty"`
	Lineas   []LineaAEntregar `json:"lineas,omitempty"`
	Completo bool             `json:"completo"`
}

// ValidarEntrega es lo que crearEntrega controlaba antes de tocar nada: que
// haya algo para entregar, que cada renglón sea del pedido y que no se
// entregue más de lo que queda (con un centavo de tolerancia). Y si con esto
// el pedido queda entregado.
//
// **Arreglado**: el TS controlaba cada línea sola contra lo pendiente, así que
// dos líneas del mismo renglón (un formulario armado a mano) pasaban aunque
// juntas fueran más que el saldo. Acá se controla lo acumulado del renglón;
// con una línea por renglón da lo mismo que el TS (el golden lo cubre).
func ValidarEntrega(pendientes []Renglon, pedidas []LineaAEntregar) ControlDeEntrega {
	porItem := map[string]Renglon{}
	for _, p := range pendientes {
		porItem[p.OrderItemID] = p
	}
	var lineas []LineaAEntregar
	for _, l := range pedidas {
		if l.Cantidad > 0 {
			lineas = append(lineas, l)
		}
	}
	if len(lineas) == 0 {
		return ControlDeEntrega{Error: "Elegí al menos un producto para entregar."}
	}
	acumulado := map[string]float64{}
	for _, l := range lineas {
		r, ok := porItem[l.OrderItemID]
		if !ok {
			return ControlDeEntrega{Error: "Hay un producto que no pertenece a este pedido."}
		}
		cantidad := l.Cantidad
		if previo, hay := acumulado[l.OrderItemID]; hay {
			cantidad = previo + l.Cantidad
		}
		acumulado[l.OrderItemID] = cantidad
		if cantidad-r.Pendiente > 0.01 {
			return ControlDeEntrega{Error: `De "` + r.Descripcion + `" quedan ` + jsmath.Texto(r.Pendiente) +
				" y estás entregando " + jsmath.Texto(cantidad) + "."}
		}
	}
	completo := true
	for _, p := range pendientes {
		if p.Pendiente-acumulado[p.OrderItemID] > 0.01 {
			completo = false
			break
		}
	}
	return ControlDeEntrega{Lineas: lineas, Completo: completo}
}

// LineasDeConstancia son las del remito de constancia: todo lo pendiente.
func LineasDeConstancia(pendientes []Renglon) []LineaAEntregar {
	var out []LineaAEntregar
	for _, p := range pendientes {
		if p.Pendiente > 0 {
			out = append(out, LineaAEntregar{OrderItemID: p.OrderItemID, Cantidad: p.Pendiente})
		}
	}
	return out
}

// --- el formulario del remito (prepararRemito) ---

// FormRemito es lo que prepararRemito leía del formulario.
type FormRemito struct {
	OrderID           string           `json:"orderId"`
	Tipo              string           `json:"tipo"`
	ReceptorNombre    *string          `json:"receptorNombre"`
	ReceptorDocumento *string          `json:"receptorDocumento"`
	Transportista     *string          `json:"transportista"`
	NumeroSeguimiento *string          `json:"numeroSeguimiento"`
	Notas             *string          `json:"notas"`
	Lineas            []LineaAEntregar `json:"lineas"`
}

// MsjFaltaDocumento es la regla del retiro: la firma sola no identifica.
const MsjFaltaDocumento = "Falta el documento de quien retira. En un retiro es obligatorio: la firma sola no identifica a nadie."

// LeerRemito lee el formulario como prepararRemito: el esquema de zod, el
// documento obligatorio en un retiro (que se controlaba **antes** de mirar si
// zod había fallado, pero solo si no había fallado) y las cantidades
// (`cantidades`: [{orderItemId, valor}], lo que venía en `cantidad-<id>`).
// Devuelve el campo y el mensaje del primer problema.
func LeerRemito(m map[string]any) (FormRemito, string, string) {
	l := zodjs.Leer(m)
	var f FormRemito
	f.OrderID = l.Requerido("orderId", zodjs.Texto{UUID: true})
	if t := l.Opcion("tipo", zodjs.Opciones{}, "retiro", "envio"); t != nil {
		f.Tipo = *t
	}
	f.ReceptorNombre = l.Cadena("receptorNombre", zodjs.Texto{Opcional: true, Recortar: true, Max: 120})
	f.ReceptorDocumento = l.Cadena("receptorDocumento", zodjs.Texto{Opcional: true, Recortar: true, Max: 30})
	f.Transportista = l.Cadena("transportista", zodjs.Texto{Opcional: true, Recortar: true, Max: 80})
	f.NumeroSeguimiento = l.Cadena("numeroSeguimiento", zodjs.Texto{Opcional: true, Recortar: true, Max: 60})
	f.Notas = l.Cadena("notas", zodjs.Texto{Opcional: true, Recortar: true, Max: 400})
	if l.Ok() && f.Tipo == "retiro" && (f.ReceptorDocumento == nil || *f.ReceptorDocumento == "") {
		return f, "receptorDocumento", MsjFaltaDocumento
	}
	if campo, msj := l.Primero(); msj != "" {
		return f, campo, msj
	}
	f.Lineas = Cantidades(m["cantidades"])
	return f, "", ""
}

// Cantidades lee las `cantidad-<id>` del formulario: Number con la primera
// coma como punto, y solo las finitas mayores que cero.
func Cantidades(v any) []LineaAEntregar {
	xs, _ := v.([]any)
	out := []LineaAEntregar{}
	for _, x := range xs {
		e, _ := x.(map[string]any)
		id, _ := e["orderItemId"].(string)
		valor := textoJS(e["valor"])
		c := jsmath.Numero(strings.Replace(valor, ",", ".", 1))
		if !math.IsNaN(c) && !math.IsInf(c, 0) && c > 0 {
			out = append(out, LineaAEntregar{OrderItemID: id, Cantidad: c})
		}
	}
	return out
}

// textoJS es String(v) para lo que puede venir de un FormData (texto).
func textoJS(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case nil:
		return "null"
	case float64:
		return jsmath.Texto(x)
	case bool:
		if x {
			return "true"
		}
		return "false"
	}
	return ""
}

// --- la firma (firmarRemito) ---

// TamanoMaximoDeFirma: una firma en PNG pesa 5–20 KB; cien mil es holgado.
const TamanoMaximoDeFirma = 100_000

// FormFirma es lo que firmarRemito leía.
type FormFirma struct {
	Token             string  `json:"token"`
	ReceptorNombre    string  `json:"receptorNombre"`
	ReceptorDocumento *string `json:"receptorDocumento"`
	Firma             string  `json:"firma"`
}

// LeerFirma es el esquema de la firma.
func LeerFirma(m map[string]any) (FormFirma, string, string) {
	l := zodjs.Leer(m)
	var f FormFirma
	f.Token = l.Requerido("token", zodjs.Texto{Min: 10, Max: 120})
	f.ReceptorNombre = l.Requerido("receptorNombre", zodjs.Texto{Recortar: true, Min: 3, MsjMin: "Escribí tu nombre y apellido.", Max: 120})
	f.ReceptorDocumento = l.Cadena("receptorDocumento", zodjs.Texto{Opcional: true, Recortar: true, Max: 30})
	// .startsWith(...) y después .max(...): en ese orden.
	v, esta := m["firma"]
	if s, es := v.(string); !es {
		l.Mal("firma", "Invalid input: expected string, received "+zodjs.TipoJS(v, esta))
	} else {
		f.Firma = s
		if !strings.HasPrefix(s, "data:image/png;base64,") {
			l.Mal("firma", "La firma no se guardó bien.")
		} else if zodjs.LargoJS(s) > TamanoMaximoDeFirma {
			l.Mal("firma", "La firma es demasiado grande.")
		}
	}
	campo, msj := l.Primero()
	return f, campo, msj
}

// --- las zonas de envío (guardarZona) ---

// ValoresDeZona es lo que se guarda (y lo que va a la bitácora, en este
// orden).
type ValoresDeZona struct {
	Nombre           string  `json:"nombre"`
	Cobertura        string  `json:"cobertura"`
	DemoraEstimada   *string `json:"demoraEstimada"`
	ACotizar         bool    `json:"aCotizar"`
	Costo            string  `json:"costo"`
	EnvioGratisDesde string  `json:"envioGratisDesde"`
	Orden            string  `json:"orden"`
	Activa           bool    `json:"activa"`
}

// Zona es lo que contesta LeerZona.
type Zona struct {
	ID          *string       `json:"id"`
	Valores     ValoresDeZona `json:"valores"`
	Descripcion string        `json:"descripcion"`
}

// LeerZona es el esquema de guardarZona y lo que hacía después: los importes
// con parsearImporte (acá se tipea «18.000»), que no sean negativos, y lo que
// se guarda.
func LeerZona(m map[string]any) (Zona, string, string) {
	l := zodjs.Leer(m)
	var z Zona
	z.ID = l.Cadena("id", zodjs.Texto{Opcional: true, UUID: true})
	nombre := l.Requerido("nombre", zodjs.Texto{Recortar: true, Min: 1, MsjMin: "Poné el nombre de la zona.", Max: 80})
	cobertura := l.Cadena("cobertura", zodjs.Texto{Recortar: true, Max: 300, Defecto: zodjs.S("")})
	demora := l.Cadena("demoraEstimada", zodjs.Texto{Opcional: true, Recortar: true, Max: 120})
	aCotizar := l.Booleano("aCotizar", true)
	costo := l.Cadena("costo", zodjs.Texto{Defecto: zodjs.S("0")})
	gratis := l.Cadena("envioGratisDesde", zodjs.Texto{Defecto: zodjs.S("0")})
	orden := l.Cadena("orden", zodjs.Texto{Defecto: zodjs.S("0")})
	activa := l.Booleano("activa", true)
	if campo, msj := l.Primero(); msj != "" {
		return z, campo, msj
	}
	v := ValoresDeZona{Nombre: nombre, Cobertura: *cobertura, ACotizar: aCotizar != nil && *aCotizar, Activa: activa == nil || *activa}
	if demora != nil && *demora != "" {
		v.DemoraEstimada = demora
	}
	c, g := 0.0, 0.0
	if !v.ACotizar {
		c, g = precios.ParsearImporte(*costo), precios.ParsearImporte(*gratis)
	}
	if math.IsNaN(c) || math.IsInf(c, 0) || c < 0 {
		return z, "costo", "El costo no puede ser negativo."
	}
	if math.IsNaN(g) || math.IsInf(g, 0) || g < 0 {
		return z, "envioGratisDesde", "El monto de envío gratis no puede ser negativo."
	}
	v.Costo, v.EnvioGratisDesde = jsmath.ToFixed(c, 2), jsmath.ToFixed(g, 2)
	o := jsmath.Numero(*orden)
	if math.IsNaN(o) || o == 0 {
		o = 0
	}
	v.Orden = jsmath.Texto(o)
	z.Valores = v
	if v.ACotizar {
		z.Descripcion = `Zona de envío "` + nombre + `": flete a cotizar`
	} else {
		z.Descripcion = `Zona de envío "` + nombre + `": $` + jsmath.ToFixed(c, 2)
	}
	return z, "", ""
}

// FueraDeRango es el arreglo de un 500 del TS: la columna es numeric(12,2) y
// numeric(4,0), y un costo de diez mil millones o un orden de cinco cifras
// rompían el guardado con un error de la base. Ahora es un mensaje.
func (v ValoresDeZona) FueraDeRango() (string, string) {
	if jsmath.Numero(v.Costo) >= 1e10 {
		return "costo", "El costo es demasiado grande."
	}
	if jsmath.Numero(v.EnvioGratisDesde) >= 1e10 {
		return "envioGratisDesde", "El monto de envío gratis es demasiado grande."
	}
	if o := jsmath.Numero(v.Orden); math.IsNaN(o) || math.Abs(o) >= 9999.5 {
		return "orden", "El orden tiene que ser un número de hasta cuatro cifras."
	}
	return "", ""
}
