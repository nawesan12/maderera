package pdf

import (
	"encoding/base64"
	"strings"
	"time"
)

// El remito en PDF (lib/pdf/remito.ts). Sin importes: documenta qué salió
// del depósito y quién lo recibió. La firma, si está, va como PNG en base64
// dentro del propio remito.
//
// Espera a la tanda 5 (entregas): los datos salen de lib/dal/admin/entregas.ts.

// FacturaDelRemito es la factura del pedido con su CAE (null si no hay).
type FacturaDelRemito struct {
	Etiqueta       string     `json:"etiqueta"`
	Cae            string     `json:"cae"`
	CaeVencimiento *time.Time `json:"caeVencimiento"`
}

// LineaDelRemito es un renglón entregado.
type LineaDelRemito struct {
	Descripcion string  `json:"descripcion"`
	Unidad      string  `json:"unidad"`
	Cantidad    float64 `json:"cantidad"`
	// Corte: qué parte sale cortada y según qué corte (vacío: nada).
	Corte string `json:"corte"`
}

// PendienteDelRemito es lo que queda en acopio.
type PendienteDelRemito struct {
	Descripcion string  `json:"descripcion"`
	Unidad      string  `json:"unidad"`
	Pendiente   float64 `json:"pendiente"`
}

// RemitoCompleto es RemitoCompleto de lib/dal/admin/entregas.ts (los
// campos que no se dibujan se ignoran).
type RemitoCompleto struct {
	ID                string               `json:"id"`
	Numero            string               `json:"numero"`
	Tipo              string               `json:"tipo"`
	Estado            string               `json:"estado"`
	ReceptorNombre    string               `json:"receptorNombre"`
	ReceptorDocumento string               `json:"receptorDocumento"`
	FirmaURL          string               `json:"firmaUrl"`
	FirmadoAt         *time.Time           `json:"firmadoAt"`
	Notas             string               `json:"notas"`
	CreatedAt         time.Time            `json:"createdAt"`
	PedidoNumero      string               `json:"pedidoNumero"`
	ClienteNombre     string               `json:"clienteNombre"`
	ClienteDireccion  string               `json:"clienteDireccion"`
	EstadoPago        string               `json:"estadoPago"`
	MedioPago         string               `json:"medioPago"`
	Sucursal          string               `json:"sucursal"`
	SucursalDireccion string               `json:"sucursalDireccion"`
	Transportista     string               `json:"transportista"`
	NumeroSeguimiento string               `json:"numeroSeguimiento"`
	Lineas            []LineaDelRemito     `json:"lineas"`
	Pendientes        []PendienteDelRemito `json:"pendientes"`
	Factura           *FacturaDelRemito    `json:"factura"`
	// SinCobrar: lo que el chofer de un envío tiene que cobrar (0: nada).
	SinCobrar float64 `json:"sinCobrar"`
}

// medioDelPedido es el medio de pago del pedido como lo lee el chofer.
var medioDelPedido = map[string]string{
	"efectivo": "Efectivo", "transferencia": "Transferencia", "debito": "Débito", "credito": "Crédito",
	"mercado_pago": "Mercado Pago", "cheque": "Cheque",
}

// CondicionDePago es lo que dice el remito del pago: en un envío con algo
// por cobrar, cuánto y cómo (el chofer vuelve con la plata; decía solo
// «Pendiente de pago»). Gemelo de condicionDePago en
// components/entregas/remito-impreso.tsx.
func CondicionDePago(r RemitoCompleto) string {
	if r.Tipo == "envio" && r.SinCobrar > 0.009 && r.MedioPago != "cuenta_corriente" {
		t := "A cobrar " + Moneda2(r.SinCobrar)
		if m := medioDelPedido[r.MedioPago]; m != "" {
			t += " · " + m
		}
		return t
	}
	pendiente := "Pendiente de pago"
	if r.MedioPago == "cuenta_corriente" {
		pendiente = "Cuenta corriente"
	}
	condicion, ok := map[string]string{
		"pagado":      "Pagado",
		"parcial":     "Pagado en parte · resto en cuenta corriente",
		"pendiente":   pendiente,
		"reintegrado": "Reintegrado",
		"rechazado":   "Pago rechazado",
	}[r.EstadoPago]
	if !ok {
		return "—"
	}
	return condicion
}

// LeyendaDelRemito es el pie: sin factura, no se manda a buscar los
// importes a un comprobante que no existe (mes simulado: decía «Sin factura
// asociada» arriba y «los importes se detallan en el comprobante fiscal»
// abajo).
func LeyendaDelRemito(f *FacturaDelRemito) string {
	if f == nil {
		return "Documento no válido como factura."
	}
	return "Documento no válido como factura. Los importes se detallan en el comprobante fiscal correspondiente."
}

// UnidadPara es la unidad concordada con la cantidad: «placas», «rollos»;
// lo abreviado no cambia. Gemelo de unidadEnPlural en lib/formato.ts.
func UnidadPara(u string, cantidad float64) string {
	a := Unidad(u)
	if cantidad == 1 || strings.ContainsAny(a, ". ²") || len([]rune(a)) <= 2 || strings.HasSuffix(a, "s") {
		return a
	}
	if strings.ContainsAny(a[len(a)-1:], "aeiou") {
		return a + "s"
	}
	return a + "es"
}

// DatosRemito son los dos argumentos de remitoPdf(remito, emisor).
type DatosRemito struct {
	Remito RemitoCompleto `json:"remito"`
	Emisor *Emisor        `json:"emisor"`
}

// LineasDeLaFactura es lineasDeLaFactura de
// lib/entregas/factura-del-remito.ts (commit 9a17128).
func LineasDeLaFactura(f *FacturaDelRemito) []string {
	if f == nil {
		return []string{"Sin factura asociada"}
	}
	if f.Cae == "" {
		return []string{f.Etiqueta, "Sin CAE: sin valor fiscal"}
	}
	cae := "CAE " + f.Cae
	// El vencimiento del CAE es un día, y la base lo tiene a la medianoche
	// argentina (los de antes, del TS, a la de UTC): en UTC da el día en los
	// dos casos.
	if f.CaeVencimiento != nil {
		cae += " · vto. " + FechaSolaCorta(*f.CaeVencimiento)
	}
	return []string{f.Etiqueta, cae}
}

// Remito arma el PDF del remito.
func Remito(d DatosRemito, _ time.Time) ([]byte, error) {
	r := d.Remito
	h := NuevaHoja()
	derecha := AnchoA4 - Margen

	if r.Estado == "anulada" {
		h.MarcaDeAgua("Anulado")
	}

	finEmisor := h.EncabezadoEmisor(d.Emisor, AltoA4-Margen-10)

	if r.Sucursal != "" {
		texto := r.Sucursal
		if r.SucursalDireccion != "" {
			texto += " · " + r.SucursalDireccion
		}
		h.Escribir(texto, Opciones{X: Margen, Y: finEmisor, Tamano: 7.5, Color: TintaSuave})
	}

	// Letra R en recuadro, como en el comprobante fiscal.
	anchoCaja := Mm(18)
	altoCaja := Mm(16)
	xCaja := (AnchoA4 - anchoCaja) / 2
	yCaja := AltoA4 - Margen - altoCaja - 4

	h.Recuadro(xCaja, yCaja, anchoCaja, altoCaja, 1.5, Color{})
	h.EscribirCentrado("R", xCaja+anchoCaja/2, Opciones{Y: yCaja + Mm(5.5), Tamano: 26, Fuente: Negrita})
	h.EscribirCentrado("REMITO", xCaja+anchoCaja/2, Opciones{Y: yCaja + Mm(2), Tamano: 5, Color: TintaSuave})

	y := AltoA4 - Margen - 10
	deAcopio := len(r.Pendientes) > 0
	titulo := "Remito de entrega total"
	if deAcopio {
		titulo = "Remito de entrega parcial"
	}
	h.Escribir(titulo, Opciones{X: derecha, Y: y, Tamano: 11, Fuente: Negrita, Derecha: true})
	y -= 15

	h.Escribir(r.Numero, Opciones{X: derecha, Y: y, Tamano: 13, Fuente: Mono, Derecha: true})
	y -= 13

	retiro := "Retiro en sucursal"
	if r.Tipo == "envio" {
		retiro = "Envío a domicilio"
	}
	// La fecha del remito es un instante: en la hora argentina (en UTC, uno
	// hecho a la noche salía con la fecha de mañana).
	for _, texto := range append([]string{"Fecha " + FechaCortaHoy(r.CreatedAt), "Pedido " + r.PedidoNumero, retiro}, LineasDeLaFactura(r.Factura)...) {
		h.Escribir(texto, Opciones{X: derecha, Y: y, Tamano: 7.5, Color: TintaSuave, Derecha: true})
		y -= 10
	}

	// Destinatario.
	cursor := minimo(minimo(finEmisor, yCaja), y+10) - Mm(8)

	oGuion := func(s string) string {
		if s == "" {
			return "—"
		}
		return s
	}
	domicilio := "Domicilio del cliente"
	if r.Tipo == "envio" {
		domicilio = "Domicilio de entrega"
	}
	quien := "Retira"
	if r.Tipo == "envio" {
		quien = "Recibe"
	}
	datos := []Dato{
		{"Cliente", r.ClienteNombre},
		{quien, oGuion(r.ReceptorNombre)},
		{domicilio, oGuion(r.ClienteDireccion)},
		{"Documento", oGuion(r.ReceptorDocumento)},
	}
	if r.Transportista != "" {
		t := r.Transportista
		if r.NumeroSeguimiento != "" {
			t += " · " + r.NumeroSeguimiento
		}
		datos = append(datos, Dato{"Transporte", t})
	}

	datos = append(datos, Dato{"Condición de pago", CondicionDePago(r)})

	altoCaja2 := h.CuadroDeDatos("DESTINATARIO", datos, cursor, 2)

	cursor -= altoCaja2 + Mm(6)

	// Detalle, sin precios.
	colCantidad := derecha - Mm(30)
	anchoDescripcion := colCantidad - Mm(18) - Margen
	encabezarDetalle := func() {
		h.Escribir("DESCRIPCIÓN", Opciones{X: Margen, Y: cursor, Tamano: 6, Fuente: Negrita, Color: TintaSuave})
		h.Escribir("CANTIDAD", Opciones{X: colCantidad, Y: cursor, Tamano: 6, Fuente: Negrita, Color: TintaSuave, Derecha: true})
		h.Escribir("UNIDAD", Opciones{X: derecha, Y: cursor, Tamano: 6, Fuente: Negrita, Color: TintaSuave, Derecha: true})

		cursor -= 6
		h.Raya(cursor, 1, Tinta)
		cursor -= 14
	}
	encabezarDetalle()

	// Lo que no entra pasa a otra hoja (antes se salía por abajo), con el
	// número del remito arriba. Las firmas van al pie de la última: el
	// detalle llega hasta abajo de cada hoja, y si en la última no queda
	// lugar para las firmas, van solas en otra. Antes se dejaba el lugar de
	// las firmas en todas: 80 renglones ocupaban nueve hojas, con un tercio
	// de cada una en blanco.
	limite := Margen + Mm(12)
	limiteFirmas := Margen + Mm(64)
	espacioHasta := func(necesario, limite float64, detalle bool) {
		if cursor-necesario >= limite {
			return
		}
		h.NuevaPagina()
		if r.Estado == "anulada" {
			h.MarcaDeAgua("Anulado")
		}
		yArriba := AltoA4 - Margen - 10
		h.Escribir("Remito "+r.Numero+" (continuación)", Opciones{X: Margen, Y: yArriba, Tamano: 9, Fuente: Negrita})
		cursor = yArriba - Mm(10)
		if detalle {
			encabezarDetalle()
		}
	}
	espacio := func(necesario float64, detalle bool) { espacioHasta(necesario, limite, detalle) }

	for _, item := range r.Lineas {
		altoCorte := 0.0
		if item.Corte != "" {
			altoCorte = float64(len(Renglones(item.Corte, Helvetica, 7.5, anchoDescripcion)))*7.5*1.35 + 2
		}
		espacio(maximo(float64(len(Renglones(item.Descripcion, Helvetica, 9, anchoDescripcion)))*9*1.35, 12)+4+altoCorte, true)
		alto := h.EscribirParrafo(item.Descripcion, Parrafo{Opciones: Opciones{X: Margen, Y: cursor, Tamano: 9}, Ancho: anchoDescripcion})
		h.EscribirNumero(numeroJS(item.Cantidad), Opciones{X: colCantidad, Y: cursor, Tamano: 9, Fuente: Mono, Derecha: true}, Mm(16))
		h.EscribirEnAncho(UnidadPara(item.Unidad, item.Cantidad), Opciones{X: derecha, Y: cursor, Tamano: 8.5, Derecha: true}, Mm(26))
		if item.Corte != "" {
			alto += 2 + h.EscribirParrafo(item.Corte, Parrafo{Opciones: Opciones{X: Margen, Y: cursor - maximo(alto, 12) + 1, Tamano: 7.5, Color: TintaSuave},
				Ancho: anchoDescripcion})
		}
		cursor -= maximo(alto, 12) + 4
		h.Raya(cursor+8, 0, Color{})
	}

	// Lo que queda en acopio, renglón por renglón. En un envío no es acopio:
	// es lo que falta llevar (lo que no había, o el segundo viaje), y la
	// línea de «queda guardada» no corresponde.
	if deAcopio {
		espacio(Mm(7)+12+11+20, false)
		cursor -= Mm(7)
		etiqueta := "QUEDA EN ACOPIO"
		if r.Tipo == "envio" {
			etiqueta = "FALTA ENTREGAR"
		}
		h.Escribir(etiqueta, Opciones{X: Margen, Y: cursor, Tamano: 6, Fuente: Negrita, Color: TintaSuave})
		cursor -= 12
		anchoUtil := AnchoA4 - Margen*2
		for _, p := range r.Pendientes {
			texto := numeroJS(p.Pendiente) + " " + UnidadPara(p.Unidad, p.Pendiente) + " · " + p.Descripcion
			espacio(float64(len(Renglones(texto, Helvetica, 8, anchoUtil)))*8*1.35, false)
			cursor -= h.EscribirParrafo(texto, Parrafo{Opciones: Opciones{X: Margen, Y: cursor, Tamano: 8}, Ancho: anchoUtil, Interlineado: 11})
		}
		cursor -= 2
		if r.Tipo != "envio" {
			h.Escribir("Esta mercadería queda guardada en la maderera a nombre del cliente y se retira contra este remito.",
				Opciones{X: Margen, Y: cursor, Tamano: 7, Color: TintaSuave})
		}
		cursor -= 6
	}

	if r.Notas != "" {
		espacio(Mm(6)+float64(len(Renglones(r.Notas, Helvetica, 8, Mm(120))))*8*1.35, false)
		cursor -= Mm(6)
		cursor -= h.EscribirParrafo(r.Notas, Parrafo{Opciones: Opciones{X: Margen, Y: cursor, Tamano: 8, Color: TintaSuave}, Ancho: Mm(120)})
	}

	// Firmas.
	espacioHasta(0, limiteFirmas, false)
	yFirma := Margen + Mm(34)
	anchoFirma := (AnchoA4 - Margen*2 - Mm(10)) / 2

	h.Escribir("FIRMA DE QUIEN RECIBE", Opciones{X: Margen, Y: yFirma + Mm(26), Tamano: 6, Fuente: Negrita, Color: TintaSuave})

	if b64, ok := strings.CutPrefix(r.FirmaURL, "data:image/png;base64,"); ok {
		// Una firma que no se puede decodificar no voltea la descarga: el
		// recuadro queda en blanco, como si no estuviera.
		if img, err := h.Doc.IncrustarPNG(remitoBase64(b64)); err == nil {
			escala := minimo(anchoFirma/img.Ancho, Mm(22)/img.Alto)
			h.Pagina.DibujarImagen(img, Margen, yFirma+Mm(2), img.Ancho*escala, img.Alto*escala)
		}
	}

	h.Pagina.DibujarLinea(Linea{X1: Margen, Y1: yFirma, X2: Margen + anchoFirma, Y2: yFirma, Grosor: 0.5, Color: ColorLinea})

	if r.FirmadoAt != nil {
		texto := "Firmado el " + FechaHora(*r.FirmadoAt)
		if r.ReceptorNombre != "" {
			texto += " por " + r.ReceptorNombre
		}
		h.Escribir(texto, Opciones{X: Margen, Y: yFirma - 11, Tamano: 7, Color: TintaSuave})
	}

	xSegunda := Margen + anchoFirma + Mm(10)
	h.Escribir("ACLARACIÓN Y DOCUMENTO", Opciones{X: xSegunda, Y: yFirma + Mm(26), Tamano: 6, Fuente: Negrita, Color: TintaSuave})
	h.Pagina.DibujarLinea(Linea{X1: xSegunda, Y1: yFirma, X2: derecha, Y2: yFirma, Grosor: 0.5, Color: ColorLinea})

	h.EscribirCentrado(LeyendaDelRemito(r.Factura), AnchoA4/2, Opciones{Y: Margen + Mm(4), Tamano: 7, Color: TintaSuave})

	return h.Bytes()
}

// remitoBase64 es Buffer.from(texto, "base64") de Node: tolerante. Saltea lo
// que no es del alfabeto, acepta el de URL (-_) y corta en el primer «=».
func remitoBase64(s string) []byte {
	if i := strings.IndexByte(s, '='); i >= 0 {
		s = s[:i]
	}
	var b strings.Builder
	for _, c := range []byte(s) {
		switch {
		case c >= 'A' && c <= 'Z', c >= 'a' && c <= 'z', c >= '0' && c <= '9', c == '+', c == '/':
			b.WriteByte(c)
		case c == '-':
			b.WriteByte('+')
		case c == '_':
			b.WriteByte('/')
		}
	}
	limpio := b.String()
	if len(limpio)%4 == 1 {
		limpio = limpio[:len(limpio)-1]
	}
	out, _ := base64.RawStdEncoding.DecodeString(limpio)
	return out
}
