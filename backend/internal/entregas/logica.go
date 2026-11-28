package entregas

import (
	"math"
	"strings"

	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
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
	// Enteros: el producto no se fracciona (una bisagra, un tornillo). Sale de
	// la unidad del producto y no de la del renglón, que en una línea cargada
	// a mano es texto libre («m» de tapacanto, «flete»). Sin producto, no se
	// controla: no hay stock que dejar en 619,99.
	Enteros bool `json:"enteros,omitempty"`
	// EnElGalpon es lo que hay en el estante de la sucursal de donde sale el
	// renglón, en la unidad del renglón: el físico menos lo que ya salió en
	// el camión de un pedido en camino. Lo mira quien arma el remito: con 135
	// placas vendidas y 70 en el galpón, el formulario no mostraba stock
	// (mes simulado, H218). Sin producto, no hay.
	EnElGalpon *float64 `json:"enElGalpon,omitempty"`
	// GalponEnStock es EnElGalpon en la unidad del stock cuando el renglón
	// es una presentación: de una media placa, «66 en el galpón» eran 33
	// placas (mes simulado 2).
	GalponEnStock *float64 `json:"galponEnStock,omitempty"`
	// EnCorte es el corte del renglón que sigue en la cola o en la máquina, y
	// EnCorteCantidad lo que se lleva de lo pendiente: esas piezas todavía no
	// existen y el remito no las ofrece (M2S3-020: con el corte de vuelta en
	// la máquina se ofrecía la media placa). El resto sale sin cortar.
	EnCorte         string   `json:"enCorte,omitempty"`
	EnCorteCantidad *float64 `json:"enCorteCantidad,omitempty"`
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

// RevisarEnteros es el control que ValidarEntrega no hace, y va aparte para
// que esa siga idéntica al golden del TS: **lo que no se fracciona sale
// entero**, y sin el centavo de tolerancia (T4, hallazgo 21).
//
// El agujero era real: se entregó 0,01 de una bisagra y el stock quedó en
// 619,99. La tolerancia de 0,01 de ValidarEntrega está pensada para los
// metros y los kilos, que se redondean; aplicada a una unidad dejaba sacar
// una de más por un centésimo, y aceptaba la fracción.
//
// La única fracción que pasa es **exactamente lo pendiente**: es la salida
// para los saldos fraccionarios que ya existen (los 619,99 de antes), que de
// otro modo no se podrían entregar nunca. Se compara a tres decimales, la
// precisión de la columna, y no con `==` sobre lo que restó la base.
// Devuelve el mensaje del primer problema, o "".
func RevisarEnteros(pendientes []Renglon, lineas []LineaAEntregar) string {
	porItem := map[string]Renglon{}
	for _, p := range pendientes {
		porItem[p.OrderItemID] = p
	}
	acumulado := map[string]float64{}
	var orden []string
	for _, l := range lineas {
		if _, visto := acumulado[l.OrderItemID]; !visto {
			orden = append(orden, l.OrderItemID)
		}
		acumulado[l.OrderItemID] += l.Cantidad
	}
	for _, id := range orden {
		r, ok := porItem[id]
		if !ok || !r.Enteros {
			continue
		}
		cantidad := acumulado[id]
		exacto := jsmath.ToFixed(cantidad, 3) == jsmath.ToFixed(r.Pendiente, 3)
		if exacto {
			continue
		}
		if cantidad > r.Pendiente {
			return `De "` + r.Descripcion + `" quedan ` + jsmath.Texto(r.Pendiente) + " y estás entregando " + jsmath.Texto(cantidad) + "."
		}
		if cantidad != math.Trunc(cantidad) {
			return `"` + r.Descripcion + `" se entrega en cantidades enteras.`
		}
	}
	return ""
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
	// notaSalida es lo que suma CrearEntrega a la nota del historial: quién
	// autorizó la salida sin cobrar y si el flete salió sin cotizar.
	notaSalida        string
	OrderID           string           `json:"orderId"`
	Tipo              string           `json:"tipo"`
	ReceptorNombre    *string          `json:"receptorNombre"`
	ReceptorDocumento *string          `json:"receptorDocumento"`
	Transportista     *string          `json:"transportista"`
	NumeroSeguimiento *string          `json:"numeroSeguimiento"`
	Notas             *string          `json:"notas"`
	Lineas            []LineaAEntregar `json:"lineas"`
	// Otros son los acopios de otros pedidos del mismo cliente que salen en
	// la misma visita (`otros`: [{orderId, cantidades}]).
	Otros []OtroPedido `json:"otros,omitempty"`
	// SinCobrar es el PIN de un admin para soltar lo que no se cobró (no
	// es del golden: lo lee el handler).
	SinCobrar SalidaSinCobrar `json:"-"`
}

// OtroPedido es lo que sale de otro acopio en la misma visita.
type OtroPedido struct {
	OrderID string           `json:"orderId"`
	Lineas  []LineaAEntregar `json:"lineas"`
}

// otrosComoFormularios: cada otro pedido con el mismo receptor y las mismas
// notas que el remito principal.
func (f FormRemito) otrosComoFormularios() []FormRemito {
	var out []FormRemito
	for _, o := range f.Otros {
		g := f
		g.OrderID, g.Lineas, g.Otros = o.OrderID, o.Lineas, nil
		g.Transportista, g.NumeroSeguimiento = nil, nil
		out = append(out, g)
	}
	return out
}

// MsjFaltaDocumento es la regla del retiro: la firma sola no identifica.
const MsjFaltaDocumento = "Falta el documento de quien retira. En un retiro es obligatorio: la firma sola no identifica a nadie."

// Receptor es quien retira, para el remito que emite «Avanzar» a
// entregado en un retiro (pedidos.Avanzar): los mismos campos y las mismas
// reglas que el remito a mano.
type Receptor struct {
	Nombre    *string
	Documento *string
	// SinCobrar: el PIN para soltar lo que no se cobró (AutorizarSinCobrar).
	SinCobrar SalidaSinCobrar
}

// NuevoReceptor recorta los dos campos (vacío es nil).
func NuevoReceptor(nombre, documento *string) Receptor {
	limpio := func(p *string) *string {
		if p == nil {
			return nil
		}
		t := zodjs.TrimJS(*p)
		if t == "" {
			return nil
		}
		return &t
	}
	return Receptor{Nombre: limpio(nombre), Documento: limpio(documento)}
}

// Revisar devuelve el campo y el mensaje del primer problema: el documento
// es obligatorio, y los largos son los del formulario del remito.
func (r Receptor) Revisar() (string, string) {
	if r.Documento == nil || *r.Documento == "" {
		return "receptorDocumento", MsjFaltaDocumento
	}
	if len([]rune(*r.Documento)) > 30 {
		return "receptorDocumento", "El documento es muy largo."
	}
	if msj := RevisarDocumento(r.Documento); msj != "" {
		return "receptorDocumento", msj
	}
	if r.Nombre != nil && len([]rune(*r.Nombre)) > 120 {
		return "receptorNombre", "El nombre es muy largo."
	}
	return "", ""
}

// MsjDocumentoInvalido: «1» pasaba como documento de quien retira (mes
// simulado 2).
const MsjDocumentoInvalido = "Revisá el documento: un DNI tiene 7 u 8 números y un CUIT, 11."

// RevisarDocumento controla el documento de quien retira, si lo hay: con
// solo números (sin puntos ni guiones), de 7 a 11; un pasaporte (con
// letras), de 6 a 15 caracteres. Vacío no es asunto de esta función.
func RevisarDocumento(d *string) string {
	if d == nil {
		return ""
	}
	limpio := strings.Map(func(r rune) rune {
		if r == '.' || r == '-' || r == ' ' {
			return -1
		}
		return r
	}, *d)
	if limpio == "" {
		return ""
	}
	digitos, otros := 0, 0
	for _, r := range limpio {
		switch {
		case r >= '0' && r <= '9':
			digitos++
		case (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z'):
			otros++
		default:
			return MsjDocumentoInvalido
		}
	}
	if otros == 0 && (digitos < 7 || digitos > 11) {
		return MsjDocumentoInvalido
	}
	if otros > 0 && (len(limpio) < 6 || len(limpio) > 15) {
		return MsjDocumentoInvalido
	}
	return ""
}

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
	if xs, ok := m["otros"].([]any); ok {
		for _, x := range xs {
			o, _ := x.(map[string]any)
			id, _ := o["orderId"].(string)
			if !plataforma.UUIDValido(id) || id == f.OrderID {
				return f, "otros", "Hay un pedido que no existe."
			}
			f.Otros = append(f.Otros, OtroPedido{OrderID: id, Lineas: Cantidades(o["cantidades"])})
		}
	}
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
