package pdf

import (
	"time"
	"unicode/utf16"
)

// El resumen de cuenta corriente en PDF (lib/pdf/resumen-cuenta.ts): todos
// los movimientos con su saldo corrido y arriba la antigüedad de la deuda,
// para adjuntarlo a un correo o mandarlo por WhatsApp cuando se reclama.
//
// Espera a la tanda 4 (cuenta corriente): los datos salen de
// lib/dal/admin/resumen-cuenta.ts.

// MovimientoDelResumen es MovimientoDelResumen del TS.
type MovimientoDelResumen struct {
	ID         string    `json:"id"`
	Fecha      time.Time `json:"fecha"`
	Tipo       string    `json:"tipo"`
	Detalle    string    `json:"detalle"`
	Referencia *string   `json:"referencia"` // `?? "—"`: la tira vacía queda vacía
	Monto      float64   `json:"monto"`
	Saldo      float64   `json:"saldo"`
}

// TramoDeAging es un tramo de antigüedad.
type TramoDeAging struct {
	Etiqueta string  `json:"etiqueta"`
	Monto    float64 `json:"monto"`
}

// AgingDelResumen tiene lo que el PDF usa de Aging.
type AgingDelResumen struct {
	Tramos           []TramoDeAging `json:"tramos"`
	Total            float64        `json:"total"`
	AFavor           float64        `json:"aFavor"`
	DiasDeLaMasVieja *float64       `json:"diasDeLaMasVieja"`
}

// ClienteDelResumen es el cliente del resumen.
type ClienteDelResumen struct {
	ID            string  `json:"id"`
	Nombre        string  `json:"nombre"`
	RazonSocial   string  `json:"razonSocial"`
	Cuit          string  `json:"cuit"`
	Direccion     string  `json:"direccion"`
	LimiteCredito float64 `json:"limiteCredito"`
}

// ResumenDeCuenta es ResumenDeCuenta de lib/dal/admin/resumen-cuenta.ts.
type ResumenDeCuenta struct {
	Cliente     ClienteDelResumen      `json:"cliente"`
	Movimientos []MovimientoDelResumen `json:"movimientos"`
	Saldo       float64                `json:"saldo"`
	Aging       AgingDelResumen        `json:"aging"`
}

// DatosResumenCuenta son los argumentos de resumenDeCuentaPdf(resumen,
// emisor); el tercero (hoy) es el ahora de ResumenCuenta.
type DatosResumenCuenta struct {
	Resumen ResumenDeCuenta `json:"resumen"`
	Emisor  *Emisor         `json:"emisor"`
}

var resumenConceptos = map[string]string{
	"compra":       "Compra",
	"pago":         "Pago recibido",
	"nota_credito": "Nota de crédito",
	"nota_debito":  "Nota de débito",
	"ajuste":       "Ajuste",
}

type resumenColumna struct {
	titulo  string
	ancho   float64
	derecha bool
}

// ResumenCuenta arma el PDF del resumen. hoy es la fecha del «Al …».
func ResumenCuenta(d DatosResumenCuenta, hoy time.Time) ([]byte, error) {
	r := d.Resumen
	h := NuevaHoja()
	anchoUtil := AnchoA4 - Margen*2

	y := h.EncabezadoEmisor(d.Emisor, h.Y)

	h.Escribir("RESUMEN DE CUENTA", Opciones{X: AnchoA4 - Margen, Y: h.Y, Tamano: 15, Fuente: Negrita, Derecha: true})
	h.Escribir("Al "+FechaLocal(hoy), Opciones{X: AnchoA4 - Margen, Y: h.Y - 16, Tamano: 8, Color: TintaSuave, Derecha: true})

	y -= 10
	h.Raya(y, 0, Color{})
	y -= 16

	nombre := r.Cliente.RazonSocial
	if nombre == "" {
		nombre = r.Cliente.Nombre
	}
	h.Escribir(nombre, Opciones{X: Margen, Y: y, Tamano: 11, Fuente: Negrita})
	y -= 13

	cuit := ""
	if r.Cliente.Cuit != "" {
		cuit = "CUIT " + r.Cliente.Cuit
	}
	for _, dato := range []string{cuit, r.Cliente.Direccion} {
		if dato == "" {
			continue
		}
		h.Escribir(dato, Opciones{X: Margen, Y: y, Tamano: 8, Color: TintaSuave})
		y -= 11
	}
	y -= 6

	// El saldo y su antigüedad.
	h.Pagina.DibujarRectangulo(Rectangulo{X: Margen, Y: y - Mm(13), Ancho: anchoUtil, Alto: Mm(15), Relleno: RGB(0.98, 0.97, 0.95)})

	etiqueta := "Saldo"
	if r.Saldo > 0 {
		etiqueta = "Saldo deudor"
	}
	h.Escribir(etiqueta, Opciones{X: Margen + Mm(4), Y: y - Mm(4), Tamano: 8, Color: TintaSuave})
	saldo := r.Saldo
	if saldo < 0 || (saldo == 0 && 1/saldo < 0) {
		saldo = -saldo // Math.abs, también del -0
	}
	h.Escribir(Pesos(saldo), Opciones{X: Margen + Mm(4), Y: y - Mm(10.5), Tamano: 16, Fuente: Negrita})
	if r.Saldo < 0 {
		h.Escribir("a favor del cliente", Opciones{X: Margen + Mm(4) + Mm(38), Y: y - Mm(10.5), Tamano: 8, Color: TintaSuave})
	}

	var conDeuda []TramoDeAging
	for _, t := range r.Aging.Tramos {
		if t.Monto > 0 {
			conDeuda = append(conDeuda, t)
		}
	}
	anchoTramo := Mm(30)
	x := AnchoA4 - Margen - float64(anchoTramo*float64(len(conDeuda)))
	for _, t := range conDeuda {
		h.Escribir(t.Etiqueta, Opciones{X: x, Y: y - Mm(4), Tamano: 7, Color: TintaSuave})
		h.Escribir(Pesos(t.Monto), Opciones{X: x, Y: y - Mm(10.5), Tamano: 10, Fuente: Negrita})
		x += anchoTramo
	}

	y -= Mm(20)

	if dias := r.Aging.DiasDeLaMasVieja; dias != nil {
		palabra := "días"
		if *dias == 1 {
			palabra = "día"
		}
		h.Escribir("La deuda más vieja sin cancelar tiene "+numeroJS(*dias)+" "+palabra+".",
			Opciones{X: Margen, Y: y, Tamano: 8, Color: TintaSuave})
		y -= 16
	}

	columnas := []resumenColumna{
		{"Fecha", Mm(22), false},
		{"Concepto", Mm(72), false},
		{"Comprobante", Mm(38), false},
		{"Importe", Mm(26), true},
		{"Saldo", Mm(24), true},
	}

	encabezado := func() {
		cx := Margen
		for _, c := range columnas {
			xx := cx
			if c.derecha {
				xx = cx + c.ancho
			}
			h.Escribir(Mayusculas(c.titulo), Opciones{X: xx, Y: y, Tamano: 6.5, Color: TintaSuave, Derecha: c.derecha})
			cx += c.ancho
		}
		y -= 5
		h.Pagina.DibujarLinea(Linea{X1: Margen, Y1: y, X2: AnchoA4 - Margen, Y2: y, Grosor: 0.5, Color: ColorLinea})
		y -= 11
	}

	encabezado()

	for _, m := range r.Movimientos {
		if y < Margen+Mm(18) {
			h.NuevaPagina()
			y = AltoA4 - Margen
			encabezado()
		}
		concepto := m.Detalle
		if concepto == "" {
			concepto = resumenConceptos[m.Tipo]
		}
		if concepto == "" {
			concepto = m.Tipo
		}
		referencia := "—"
		if m.Referencia != nil {
			referencia = *m.Referencia
		}
		celdas := []string{FechaLocal(m.Fecha), concepto, referencia, Pesos(m.Monto), Pesos(m.Saldo)}

		cx := Margen
		for i, celda := range celdas {
			c := columnas[i]
			xx := cx
			if c.derecha {
				xx = cx + c.ancho
			}
			h.Escribir(resumenRecortar(celda, c.ancho-4), Opciones{X: xx, Y: y, Tamano: 8, Color: Tinta, Derecha: c.derecha})
			cx += c.ancho
		}
		y -= 12
	}

	y -= 8
	h.Escribir("Los importes son finales, con IVA. Si ya pagaste alguno de estos comprobantes, avisanos y lo revisamos.",
		Opciones{X: Margen, Y: y, Tamano: 7.5, Color: TintaSuave})

	return h.Bytes()
}

// resumenRecortar es recortar(): saca de a dos unidades de UTF-16 hasta que
// el texto entre en la columna, y le pone puntos suspensivos.
//
// El TS mide el texto sin limpiar, y pdf-lib tira un error si tiene algo
// que WinAnsi no sabe codificar (un emoji, una flecha): la descarga del
// resumen entero se caía por un concepto con emoji. Go no cuenta esos
// caracteres al medir (Limpiar los saca al escribir), así que el resumen
// sale igual.
func resumenRecortar(texto string, ancho float64) string {
	u := utf16.Encode([]rune(texto))
	recortado := u
	for len(recortado) > 3 && Helvetica.Ancho(string(utf16.Decode(recortado)), 8) > ancho {
		recortado = recortado[:len(recortado)-2]
	}
	if len(recortado) == len(u) {
		return texto
	}
	return string(utf16.Decode(recortado)) + "…"
}
