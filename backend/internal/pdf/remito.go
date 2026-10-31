package pdf

import (
	"encoding/base64"
	"math"
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
	for _, texto := range append([]string{"Fecha " + FechaSolaCorta(r.CreatedAt), "Pedido " + r.PedidoNumero, retiro}, LineasDeLaFactura(r.Factura)...) {
		h.Escribir(texto, Opciones{X: derecha, Y: y, Tamano: 7.5, Color: TintaSuave, Derecha: true})
		y -= 10
	}

	// Destinatario.
	cursor := minimo(finEmisor, yCaja) - Mm(8)
	columna := (AnchoA4 - Margen*2) / 2

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
	datos := [][2]string{
		{"Cliente", r.ClienteNombre},
		{"Retira", oGuion(r.ReceptorNombre)},
		{domicilio, oGuion(r.ClienteDireccion)},
		{"Documento", oGuion(r.ReceptorDocumento)},
	}
	if r.Transportista != "" {
		t := r.Transportista
		if r.NumeroSeguimiento != "" {
			t += " · " + r.NumeroSeguimiento
		}
		datos = append(datos, [2]string{"Transporte", t})
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
		condicion = "—"
	}
	datos = append(datos, [2]string{"Condición de pago", condicion})

	filasDeDatos := math.Ceil(float64(len(datos)) / 2)
	altoCaja2 := 26 + float64(filasDeDatos*20) + 4

	h.Recuadro(Margen, cursor-altoCaja2, AnchoA4-Margen*2, altoCaja2, 0.5, ColorLinea)
	h.Escribir("DESTINATARIO", Opciones{X: Margen + 8, Y: cursor - 12, Tamano: 6, Fuente: Negrita, Color: TintaSuave})

	for i, dato := range datos {
		x := Margen + 8 + float64(float64(i%2)*columna)
		yFila := cursor - 26 - float64(float64(i/2)*20)
		h.Escribir(dato[0], Opciones{X: x, Y: yFila, Tamano: 6, Color: TintaSuave})
		h.Escribir(dato[1], Opciones{X: x, Y: yFila - 9, Tamano: 8.5, Fuente: Negrita})
	}

	cursor -= altoCaja2 + Mm(6)

	// Detalle, sin precios.
	colCantidad := derecha - Mm(30)
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
	// número del remito arriba. Las firmas van al pie de la última.
	limite := Margen + Mm(64)
	espacio := func(necesario float64, detalle bool) {
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

	for _, item := range r.Lineas {
		espacio(maximo(float64(len(Renglones(item.Descripcion, Helvetica, 9, Mm(120))))*9*1.35, 12)+4, true)
		alto := h.EscribirParrafo(item.Descripcion, Parrafo{Opciones: Opciones{X: Margen, Y: cursor, Tamano: 9}, Ancho: Mm(120)})
		h.Escribir(numeroJS(item.Cantidad), Opciones{X: colCantidad, Y: cursor, Tamano: 9, Fuente: Mono, Derecha: true})
		h.Escribir(Unidad(item.Unidad), Opciones{X: derecha, Y: cursor, Tamano: 8.5, Derecha: true})
		cursor -= maximo(alto, 12) + 4
		h.Raya(cursor+8, 0, Color{})
	}

	// Lo que queda en acopio, renglón por renglón.
	if deAcopio {
		espacio(Mm(7)+12+11+20, false)
		cursor -= Mm(7)
		h.Escribir("QUEDA EN ACOPIO", Opciones{X: Margen, Y: cursor, Tamano: 6, Fuente: Negrita, Color: TintaSuave})
		cursor -= 12
		for _, p := range r.Pendientes {
			espacio(11, false)
			h.Escribir(numeroJS(p.Pendiente)+" "+p.Unidad+" · "+p.Descripcion, Opciones{X: Margen, Y: cursor, Tamano: 8})
			cursor -= 11
		}
		cursor -= 2
		h.Escribir("Esta mercadería queda guardada en la maderera a nombre del cliente y se retira contra este remito.",
			Opciones{X: Margen, Y: cursor, Tamano: 7, Color: TintaSuave})
		cursor -= 6
	}

	if r.Notas != "" {
		espacio(Mm(6)+float64(len(Renglones(r.Notas, Helvetica, 8, Mm(120))))*8*1.35, false)
		cursor -= Mm(6)
		cursor -= h.EscribirParrafo(r.Notas, Parrafo{Opciones: Opciones{X: Margen, Y: cursor, Tamano: 8, Color: TintaSuave}, Ancho: Mm(120)})
	}

	// Firmas.
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

	h.EscribirCentrado("Documento no válido como factura. Los importes se detallan en el comprobante fiscal correspondiente.",
		AnchoA4/2, Opciones{Y: Margen + Mm(4), Tamano: 7, Color: TintaSuave})

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
