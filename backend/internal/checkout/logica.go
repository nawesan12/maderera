package checkout

import (
	"encoding/json"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"

	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
	"mjbj/internal/ventas"
	"mjbj/internal/zodjs"
)

// Lo puro del carrito y del checkout: los descuentos por volumen, el armado
// del carrito, los esquemas de las acciones y las cuentas de la compra.
// Golden: scripts/golden/checkout.ts.

// --- lib/precios/volumen.ts ---

// EscalaDeVolumen es un tramo de descuento por cantidad.
type EscalaDeVolumen struct {
	ID            string  `json:"id"`
	VariantID     *string `json:"variantId"`
	CategoryID    *string `json:"categoryId"`
	DesdeCantidad float64 `json:"desdeCantidad"`
	Porcentaje    float64 `json:"porcentaje"`
}

// ContextoDescuento es la línea a la que se le busca el descuento.
type ContextoDescuento struct {
	VariantID  *string `json:"variantId"`
	CategoryID *string `json:"categoryId"`
	Cantidad   float64 `json:"cantidad"`
}

func especificidad(e EscalaDeVolumen) int {
	if e.VariantID != nil && *e.VariantID != "" {
		return 2
	}
	if e.CategoryID != nil && *e.CategoryID != "" {
		return 1
	}
	return 0
}

func igual(a, b *string) bool { return a != nil && b != nil && *a == *b }

func aplica(e EscalaDeVolumen, c ContextoDescuento) bool {
	if c.Cantidad < e.DesdeCantidad {
		return false
	}
	if e.VariantID != nil && *e.VariantID != "" {
		return igual(e.VariantID, c.VariantID)
	}
	if e.CategoryID != nil && *e.CategoryID != "" {
		return igual(e.CategoryID, c.CategoryID)
	}
	return true
}

// DescuentoPorVolumen es el porcentaje que corresponde: gana la escala más
// específica y, entre iguales, la de mayor «desde».
func DescuentoPorVolumen(escalas []EscalaDeVolumen, c ContextoDescuento) float64 {
	var mejor *EscalaDeVolumen
	for i := range escalas {
		e := escalas[i]
		if !aplica(e, c) || !(e.Porcentaje > 0) {
			continue
		}
		if mejor == nil {
			mejor = &escalas[i]
			continue
		}
		n, nm := especificidad(e), especificidad(*mejor)
		if n > nm || (n == nm && e.DesdeCantidad > mejor.DesdeCantidad) {
			mejor = &escalas[i]
		}
	}
	if mejor == nil {
		return 0
	}
	return mejor.Porcentaje
}

// PrecioConDescuento aplica el porcentaje (topeado en 90) a dos decimales.
func PrecioConDescuento(precio, porcentaje float64) float64 {
	if !(porcentaje > 0) {
		return precio
	}
	efectivo := math.Min(porcentaje, 90)
	return jsmath.Round(float64(float64(precio*float64(1-efectivo/100))*100)) / 100
}

// --- lib/dal/carrito.ts (obtenerCarrito sin las consultas) ---

// FilaDelCarrito es un renglón de cart_items con lo que hace falta del
// producto y el precio de lista ya resuelto.
type FilaDelCarrito struct {
	ID             string   `json:"id"`
	VariantID      *string  `json:"variantId"`
	Descripcion    string   `json:"descripcion"`
	Unidad         string   `json:"unidad"`
	Cantidad       string   `json:"cantidad"`
	PrecioUnitario *string  `json:"precioUnitario"`
	Origen         string   `json:"origen"`
	Notas          *string  `json:"notas"`
	Presentacion   *string  `json:"presentacion"`
	Unit           *string  `json:"unit"`
	FormaDeVenta   *string  `json:"formaDeVenta"`
	PrecioMediaPct *float64 `json:"precioMediaPct"`
	Slug           *string  `json:"slug"`
	CategoryID     *string  `json:"categoryId"`
	PrecioActual   *string  `json:"precioActual"`
}

// FilaDeCorte es una fila de cart_cortes.
type FilaDeCorte struct {
	ID                  string  `json:"id"`
	VariantID           *string `json:"variantId"`
	MaterialDescripcion string  `json:"materialDescripcion"`
	PlacaLargoMm        int     `json:"placaLargoMm"`
	PlacaAnchoMm        int     `json:"placaAnchoMm"`
	Mitad               *string `json:"mitad"`
	CantoDescripcion    *string `json:"cantoDescripcion"`
	Piezas              string  `json:"piezas"`
	Placas              int     `json:"placas"`
	Pasadas             int     `json:"pasadas"`
	Total               string  `json:"total"`
}

// ItemCarrito es un renglón del presupuesto en curso.
type ItemCarrito struct {
	ID                 string   `json:"id"`
	VariantID          *string  `json:"variantId"`
	Descripcion        string   `json:"descripcion"`
	Unidad             string   `json:"unidad"`
	Cantidad           float64  `json:"cantidad"`
	Presentacion       *string  `json:"presentacion"`
	PrecioUnitario     *float64 `json:"precioUnitario"`
	PrecioActual       *float64 `json:"precioActual"`
	Descuento          float64  `json:"descuento"`
	PrecioSinDescuento *float64 `json:"precioSinDescuento"`
	Subtotal           float64  `json:"subtotal"`
	Origen             string   `json:"origen"`
	Notas              *string  `json:"notas"`
	Slug               *string  `json:"slug"`
	Imagen             *string  `json:"imagen"`
}

// CorteEnCarrito es un corte a medida del carrito.
type CorteEnCarrito struct {
	ID               string  `json:"id"`
	VariantID        *string `json:"variantId"`
	Material         string  `json:"material"`
	PlacaLargoMm     int     `json:"placaLargoMm"`
	PlacaAnchoMm     int     `json:"placaAnchoMm"`
	Mitad            *string `json:"mitad"`
	CantoDescripcion *string `json:"cantoDescripcion"`
	Piezas           float64 `json:"piezas"`
	Placas           int     `json:"placas"`
	Pasadas          int     `json:"pasadas"`
	Total            float64 `json:"total"`
}

// Carrito es lo que devuelve obtenerCarrito.
type Carrito struct {
	ID                      *string          `json:"id"`
	Items                   []ItemCarrito    `json:"items"`
	Cortes                  []CorteEnCarrito `json:"cortes"`
	CantidadItems           int              `json:"cantidadItems"`
	Subtotal                float64          `json:"subtotal"`
	ConPrecioDesactualizado int              `json:"conPrecioDesactualizado"`
	AhorroPorVolumen        float64          `json:"ahorroPorVolumen"`
	ListaDiferenciada       *string          `json:"listaDiferenciada"`
}

// CarritoVacio es CARRITO_VACIO.
func CarritoVacio() Carrito {
	return Carrito{Items: []ItemCarrito{}, Cortes: []CorteEnCarrito{}}
}

func numero(s *string) *float64 {
	if s == nil {
		return nil
	}
	n := jsmath.Numero(*s)
	return &n
}

// ArmarCarrito es el armado de obtenerCarrito: el precio de lista vigente
// (con la media), el descuento por volumen y los totales.
func ArmarCarrito(id string, filas []FilaDelCarrito, cortes []FilaDeCorte, escalas []EscalaDeVolumen, lista *string) Carrito {
	c := Carrito{ID: &id, Items: make([]ItemCarrito, 0, len(filas)), Cortes: make([]CorteEnCarrito, 0, len(cortes)), ListaDiferenciada: lista}
	ahorro := 0.0
	for _, f := range filas {
		cantidad := jsmath.Numero(f.Cantidad)
		precio := numero(f.PrecioUnitario)
		var pres *string
		if ventas.EsPresentacion(f.Presentacion) {
			p := *f.Presentacion
			pres = &p
		}
		var deLista *float64
		if f.PrecioActual != nil {
			v := jsmath.Numero(*f.PrecioActual)
			if f.Unit != nil && *f.Unit != "" && f.FormaDeVenta != nil && *f.FormaDeVenta != "" {
				pct := 50.0
				if f.PrecioMediaPct != nil {
					pct = *f.PrecioMediaPct
				}
				if pres != nil && ventas.AdmiteMedia(ventas.ProductoQueSeVende{Unit: *f.Unit, FormaDeVenta: *f.FormaDeVenta}) {
					v = ventas.PrecioDeMedia(v, pct)
				}
			}
			deLista = &v
		}
		descuento := 0.0
		var actual *float64
		if deLista != nil {
			descuento = DescuentoPorVolumen(escalas, ContextoDescuento{f.VariantID, f.CategoryID, cantidad})
			a := PrecioConDescuento(*deLista, descuento)
			actual = &a
			if descuento > 0 {
				ahorro += float64((*deLista - a) * cantidad)
			}
		}
		base := 0.0
		switch {
		case actual != nil:
			base = *actual
		case precio != nil:
			base = *precio
		}
		var sin *float64
		if descuento > 0 {
			sin = deLista
		}
		c.Items = append(c.Items, ItemCarrito{
			ID: f.ID, VariantID: f.VariantID, Descripcion: f.Descripcion, Unidad: f.Unidad, Cantidad: cantidad,
			Presentacion: pres, PrecioUnitario: precio, PrecioActual: actual, Descuento: descuento, PrecioSinDescuento: sin,
			Subtotal: float64(base * cantidad), Origen: f.Origen, Notas: f.Notas, Slug: f.Slug,
		})
	}
	for _, x := range cortes {
		var mitad *string
		if x.Mitad != nil {
			m := *x.Mitad
			mitad = &m
		}
		c.Cortes = append(c.Cortes, CorteEnCarrito{
			ID: x.ID, VariantID: x.VariantID, Material: x.MaterialDescripcion, PlacaLargoMm: x.PlacaLargoMm,
			PlacaAnchoMm: x.PlacaAnchoMm, Mitad: mitad, CantoDescripcion: x.CantoDescripcion, Piezas: ContarPiezas(x.Piezas),
			Placas: x.Placas, Pasadas: x.Pasadas, Total: jsmath.Numero(x.Total),
		})
	}
	c.CantidadItems = len(c.Items) + len(c.Cortes)
	items := 0.0
	for _, i := range c.Items {
		items += i.Subtotal
	}
	cs := 0.0
	for _, x := range c.Cortes {
		cs += x.Total
	}
	c.Subtotal = items + cs
	for _, i := range c.Items {
		deLista := i.PrecioSinDescuento
		if deLista == nil {
			deLista = i.PrecioActual
		}
		if i.PrecioUnitario != nil && deLista != nil && *i.PrecioUnitario != *deLista {
			c.ConPrecioDesactualizado++
		}
	}
	c.AhorroPorVolumen = jsmath.Round(float64(ahorro*100)) / 100
	return c
}

// ContarPiezas suma las cantidades de un despiece guardado como JSON; cero
// si es basura.
func ContarPiezas(crudo string) float64 {
	var piezas []any
	if json.Unmarshal([]byte(crudo), &piezas) != nil {
		return 0
	}
	total := 0.0
	for _, p := range piezas {
		m, _ := p.(map[string]any)
		v, esta := m["cantidad"]
		n := zodjs.NumeroJS(v, esta)
		if math.IsNaN(n) || n == 0 {
			continue
		}
		total += n
	}
	return total
}

// --- los esquemas de las acciones ---

// ErrorDeFormulario es el primer problema de zod: el mensaje y el campo.
type ErrorDeFormulario struct{ Campo, Mensaje string }

func (e *ErrorDeFormulario) Error() string { return e.Mensaje }

func primero(l *zodjs.Lector) *ErrorDeFormulario {
	if c, m := l.Primero(); m != "" {
		return &ErrorDeFormulario{c, m}
	}
	return nil
}

var uuidOpcional = zodjs.Texto{Opcional: true, UUID: true}

// Agregado es lo que se agrega al carrito (agregarSchema).
type Agregado struct {
	VariantID       *string `json:"variantId,omitempty"`
	Descripcion     string  `json:"descripcion"`
	Unidad          string  `json:"unidad"`
	Cantidad        float64 `json:"cantidad"`
	Presentacion    *string `json:"presentacion"`
	HayPresentacion bool    `json:"-"`
	Origen          string  `json:"origen"`
	Notas           *string `json:"notas,omitempty"`
}

// LeerAgregado es agregarSchema.safeParse.
func LeerAgregado(m map[string]any) (Agregado, *ErrorDeFormulario) {
	l := zodjs.Leer(m)
	var a Agregado
	a.VariantID = l.Cadena("variantId", uuidOpcional)
	a.Descripcion = l.Requerido("descripcion", zodjs.Texto{Recortar: true, Min: 1, Max: 240})
	a.Unidad = l.Requerido("unidad", zodjs.Texto{Recortar: true, Max: 40, Defecto: zodjs.S("unidad")})
	if n := l.Numero("cantidad", zodjs.Num{Coerce: true}, zodjs.Positivo(), zodjs.Max(100000)); n != nil {
		a.Cantidad = *n
	}
	_, a.HayPresentacion = m["presentacion"]
	a.Presentacion = l.Opcion("presentacion", zodjs.Opciones{Opcional: true, Nulo: true}, "media_largo", "media_ancho")
	a.Origen = l.Requerido("origen", zodjs.Texto{Recortar: true, Max: 40, Defecto: zodjs.S("catalogo")})
	a.Notas = l.Cadena("notas", zodjs.Texto{Opcional: true, Recortar: true, Max: 300})
	return a, primero(l)
}

// Pedido de presupuesto (app/(public)/carrito/actions.ts).
type PedidoDePresupuesto struct {
	Nombre       string     `json:"nombre"`
	Email        string     `json:"email"`
	Telefono     string     `json:"telefono"`
	SucursalID   *string    `json:"sucursalId,omitempty"`
	NecesitaPara *time.Time `json:"necesitaPara"`
	Motivos      []string   `json:"motivos"`
	Notas        *string    `json:"notas,omitempty"`
}

// MotivosDeCotizacion son los cuatro del brief.
var MotivosDeCotizacion = []struct{ Valor, Etiqueta string }{
	{"volumen", "Compra por volumen"},
	{"flete", "Flete especial o fuera de Mar del Plata"},
	{"fabricacion", "Fabricación a pedido o medida especial"},
	{"obra", "Obra completa"},
}

// NotasDelPresupuesto son los motivos adelante y lo que escribió.
func NotasDelPresupuesto(motivos []string, notas *string) *string {
	var partes []string
	if len(motivos) > 0 {
		et := make([]string, len(motivos))
		for i, m := range motivos {
			et[i] = m
			for _, o := range MotivosDeCotizacion {
				if o.Valor == m {
					et[i] = o.Etiqueta
					break
				}
			}
		}
		partes = append(partes, "Cotización especial: "+strings.Join(et, " · "))
	}
	if notas != nil && *notas != "" {
		partes = append(partes, *notas)
	}
	if len(partes) == 0 {
		return nil
	}
	s := strings.Join(partes, "\n")
	return &s
}

var argentina = func() *time.Location {
	l, err := time.LoadLocation("America/Argentina/Buenos_Aires")
	if err != nil {
		return time.FixedZone("ART", -3*3600)
	}
	return l
}()

var fechaISO = regexp.MustCompile(`^([+-]\d{6}|\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$`)

// FechaDelDia es `new Date(\`${v}T12:00:00\`)` con las formas de fecha que
// acepta V8 (año, año-mes, año-mes-día; el día hasta 31 y se desborda), a
// las 12 **de Buenos Aires**: el TS lo leía en la zona del servidor (UTC).
func FechaDelDia(v string) (time.Time, bool) {
	m := fechaISO.FindStringSubmatch(v)
	if m == nil || m[1] == "-000000" {
		return time.Time{}, false
	}
	anio, _ := strconv.Atoi(m[1])
	mes, dia := 1, 1
	if m[2] != "" {
		mes, _ = strconv.Atoi(m[2])
	}
	if m[3] != "" {
		dia, _ = strconv.Atoi(m[3])
	}
	if mes < 1 || mes > 12 || dia < 1 || dia > 31 {
		return time.Time{}, false
	}
	return time.Date(anio, time.Month(mes), dia, 12, 0, 0, 0, argentina), true
}

// LeerPedidoDePresupuesto es el esquema de pedirPresupuesto.
func LeerPedidoDePresupuesto(m map[string]any) (PedidoDePresupuesto, *ErrorDeFormulario) {
	l := zodjs.Leer(m)
	var p PedidoDePresupuesto
	p.Nombre = l.Requerido("nombre", zodjs.Texto{Recortar: true, Min: 2, MsjMin: "Necesitamos tu nombre.", Max: 120})
	email := l.Cadena("email", zodjs.Texto{Recortar: true})
	if email != nil {
		p.Email = *email
		if !plataforma.CorreoValido(p.Email) {
			l.Mal("email", "Revisá el correo.")
		}
	}
	p.Telefono = l.Requerido("telefono", zodjs.Texto{Recortar: true, Min: 6, MsjMin: "Dejanos un teléfono.", Max: 40})
	p.SucursalID = l.Cadena("sucursalId", uuidOpcional)
	if f := l.Cadena("necesitaPara", zodjs.Texto{Opcional: true, Recortar: true}); f != nil && *f != "" {
		if t, ok := FechaDelDia(*f); ok {
			p.NecesitaPara = &t
		} else {
			l.Mal("necesitaPara", "Revisá la fecha.")
		}
	}
	p.Motivos = []string{}
	if v, esta := m["motivos"]; esta {
		xs, es := v.([]any)
		if !es {
			l.Mal("motivos", "Invalid input: expected array, received "+zodjs.TipoJS(v, true))
		} else {
			for i, x := range xs {
				s, es := x.(string)
				switch {
				case !es:
					l.Mal("motivos."+strconv.Itoa(i), "Invalid input: expected string, received "+zodjs.TipoJS(x, true))
				case zodjs.LargoJS(s) > 40:
					l.Mal("motivos."+strconv.Itoa(i), "Too big: expected string to have <=40 characters")
				default:
					p.Motivos = append(p.Motivos, s)
				}
			}
			if len(xs) > 6 {
				l.Mal("motivos", "Too big: expected array to have <=6 items")
			}
		}
	}
	p.Notas = l.Cadena("notas", zodjs.Texto{Opcional: true, Recortar: true, Max: 800})
	return p, primero(l)
}

// DatosDeCompra es datosDeCompraSchema.
type DatosDeCompra struct {
	Nombre     string  `json:"nombre"`
	Email      string  `json:"email"`
	Telefono   string  `json:"telefono"`
	Entrega    string  `json:"entrega"`
	SucursalID *string `json:"sucursalId,omitempty"`
	ZonaID     *string `json:"zonaId,omitempty"`
	Direccion  *string `json:"direccion,omitempty"`
	MedioPago  string  `json:"medioPago"`
	Notas      *string `json:"notas,omitempty"`
}

// LeerDatosDeCompra es datosDeCompraSchema.safeParse.
func LeerDatosDeCompra(m map[string]any) (DatosDeCompra, *ErrorDeFormulario) {
	l := zodjs.Leer(m)
	var d DatosDeCompra
	d.Nombre = l.Requerido("nombre", zodjs.Texto{Recortar: true, Min: 2, MsjMin: "Necesitamos tu nombre.", Max: 120})
	if email := l.Cadena("email", zodjs.Texto{Recortar: true}); email != nil {
		d.Email = *email
		if !plataforma.CorreoValido(d.Email) {
			l.Mal("email", "Revisá el correo.")
		}
	}
	d.Telefono = l.Requerido("telefono", zodjs.Texto{Recortar: true, Min: 6, MsjMin: "Dejanos un teléfono para coordinar.", Max: 40})
	if e := l.Opcion("entrega", zodjs.Opciones{}, "retiro", "envio"); e != nil {
		d.Entrega = *e
	}
	d.SucursalID = l.Cadena("sucursalId", uuidOpcional)
	d.ZonaID = l.Cadena("zonaId", uuidOpcional)
	d.Direccion = l.Cadena("direccion", zodjs.Texto{Opcional: true, Recortar: true, Max: 240})
	if mp := l.Opcion("medioPago", zodjs.Opciones{}, "mercado_pago", "transferencia", "debito", "efectivo", "cuenta_corriente"); mp != nil {
		d.MedioPago = *mp
	}
	d.Notas = l.Cadena("notas", zodjs.Texto{Opcional: true, Recortar: true, Max: 600})
	if l.Ok() {
		if !(d.Entrega == "retiro" || (d.ZonaID != nil && *d.ZonaID != "" && d.Direccion != nil && *d.Direccion != "")) {
			l.Mal("", "Para el envío necesitamos la zona y la dirección.")
		}
		if !(d.Entrega == "envio" || (d.SucursalID != nil && *d.SucursalID != "")) {
			l.Mal("", "Elegí en qué sucursal lo vas a retirar.")
		}
	}
	return d, primero(l)
}

// DatosBancarios son los de la cuenta para transferir.
type DatosBancarios struct {
	Banco         string  `json:"banco"`
	Titular       string  `json:"titular"`
	Cuit          string  `json:"cuit"`
	Cbu           string  `json:"cbu"`
	Alias         string  `json:"alias"`
	Instrucciones *string `json:"instrucciones,omitempty"`
}

var cbu = regexp.MustCompile(`^\d{22}$|^$`)

// LeerDatosBancarios es el esquema de guardarDatosBancarios.
func LeerDatosBancarios(m map[string]any) (DatosBancarios, *ErrorDeFormulario) {
	l := zodjs.Leer(m)
	var d DatosBancarios
	d.Banco = l.Requerido("banco", zodjs.Texto{Recortar: true, Max: 120})
	d.Titular = l.Requerido("titular", zodjs.Texto{Recortar: true, Max: 160})
	d.Cuit = l.Requerido("cuit", zodjs.Texto{Recortar: true, Max: 20})
	d.Cbu = l.Requerido("cbu", zodjs.Texto{Recortar: true, Patron: cbu, MsjPatron: "El CBU tiene que tener 22 dígitos."})
	d.Alias = l.Requerido("alias", zodjs.Texto{Recortar: true, Max: 60})
	d.Instrucciones = l.Cadena("instrucciones", zodjs.Texto{Opcional: true, Recortar: true, Max: 400})
	return d, primero(l)
}

// --- las cuentas de confirmarCompra ---

// Zona es lo que el checkout necesita de una zona de envío.
type Zona struct {
	Nombre           string
	Costo            float64
	EnvioGratisDesde float64
	ACotizar         bool
}

// CalcularEnvio es calcularEnvio (lib/envios.ts).
func CalcularEnvio(z Zona, subtotal float64) float64 {
	if z.ACotizar {
		return 0
	}
	if z.EnvioGratisDesde > 0 && subtotal >= z.EnvioGratisDesde {
		return 0
	}
	return z.Costo
}

// Cuentas son los importes del pedido.
type Cuentas struct {
	Subtotal, CostoEnvio, Descuento, Total float64
	NombreZona                             *string
}

// MsjMayorista es el rechazo del medio que no es de contado.
const MsjMayorista = "Tu precio de profesional es de contado: pagá por transferencia, débito o efectivo."

// CuentasDeLaCompra suma la mercadería y los cortes, el envío y el descuento
// por medio de pago (sobre la mercadería, sin el flete).
func CuentasDeLaCompra(items, cortes []float64, zona *Zona, medio string, diferenciada bool, escalas []ventas.EscalaDePago) (Cuentas, string) {
	sc := 0.0
	for _, c := range cortes {
		sc += c
	}
	si := 0.0
	for _, i := range items {
		si += i
	}
	var c Cuentas
	c.Subtotal = si + sc
	if zona != nil {
		c.CostoEnvio = CalcularEnvio(*zona, c.Subtotal)
		n := zona.Nombre
		if zona.ACotizar {
			n += " (flete a cotizar)"
		}
		c.NombreZona = &n
	}
	if !ventas.MedioPermitido(medio, diferenciada) {
		return c, MsjMayorista
	}
	if e := ventas.DescuentoPorMedioDePago(escalas, medio, c.Subtotal); e != nil {
		c.Descuento = ventas.MontoDelDescuentoDePago(c.Subtotal, e.Porcentaje)
	}
	c.Total = float64(c.Subtotal-c.Descuento) + c.CostoEnvio
	return c, ""
}
