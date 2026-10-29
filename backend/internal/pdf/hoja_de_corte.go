package pdf

import (
	"strconv"
	"strings"
	"time"
)

// La hoja de corte para la seccionadora (lib/pdf/hoja-de-corte.ts): un
// patrón por hoja, el dibujo a escala con cada corte rotulado con su paso, y
// debajo la lista de pasos con su casilla, en el orden de la máquina.
//
// Espera a la tanda 11 (cortes): hoy la arma app/api/cortes/[id]/hoja, con
// armarHojaDeCorte de lib/cortes/secuencia.ts.

// CorteParaHoja es CorteParaHoja del TS.
type CorteParaHoja struct {
	Numero    string    `json:"numero"`
	Cliente   string    `json:"cliente"`
	Material  string    `json:"material"`
	DeQueSale string    `json:"deQueSale"`
	CreatedAt time.Time `json:"createdAt"`
}

// SalidaDeCorte es Salida de lib/cortes/secuencia.ts.
type SalidaDeCorte struct {
	Cantidad float64  `json:"cantidad"`
	Tipo     string   `json:"tipo"` // "pieza" | "trozo"
	Largo    float64  `json:"largo"`
	Ancho    float64  `json:"ancho"`
	Renglon  *float64 `json:"renglon"`
	Etiqueta *string  `json:"etiqueta"`
	Girada   bool     `json:"girada"`
	SigueEn  *float64 `json:"sigueEn"`
	Letra    string   `json:"letra"`
}

// PasoDeCorte es PasoDeCorte de lib/cortes/secuencia.ts.
type PasoDeCorte struct {
	Numero         float64         `json:"numero"`
	Medida         float64         `json:"medida"`
	Veces          float64         `json:"veces"`
	UltimaSinCorte bool            `json:"ultimaSinCorte"`
	Sale           []SalidaDeCorte `json:"sale"`
}

// SobraDeCorte es lo que queda al final de una operación.
type SobraDeCorte struct {
	Largo float64 `json:"largo"`
	Ancho float64 `json:"ancho"`
	Tipo  string  `json:"tipo"` // "retal" | "desperdicio"
}

// OperacionDeCorte es OperacionDeCorte de lib/cortes/secuencia.ts.
type OperacionDeCorte struct {
	Numero       float64         `json:"numero"`
	Nivel        float64         `json:"nivel"`
	Direccion    string          `json:"direccion"` // "longitudinal" | "transversal"
	Largo        float64         `json:"largo"`
	Ancho        float64         `json:"ancho"`
	Repeticiones float64         `json:"repeticiones"`
	DelPaso      *float64        `json:"delPaso"`
	Letra        string          `json:"letra"`
	Pasos        []PasoDeCorte   `json:"pasos"`
	Tandas       [][]PasoDeCorte `json:"tandas"`
	Sobra        *SobraDeCorte   `json:"sobra"`
}

// CorteDibujado es CorteDibujado de lib/cortes/secuencia.ts.
type CorteDibujado struct {
	X1   float64 `json:"x1"`
	Y1   float64 `json:"y1"`
	X2   float64 `json:"x2"`
	Y2   float64 `json:"y2"`
	Paso float64 `json:"paso"`
}

// PatronDeCorte es PatronDeCorte de lib/cortes/secuencia.ts (sin el árbol,
// que el PDF no usa).
type PatronDeCorte struct {
	Placas      []float64          `json:"placas"`
	Operaciones []OperacionDeCorte `json:"operaciones"`
	Dibujo      struct {
		Piezas []struct {
			Rect  RectDeCorte   `json:"rect"`
			Pieza PiezaColocada `json:"pieza"`
		} `json:"piezas"`
		Sobrantes []struct {
			Rect RectDeCorte `json:"rect"`
			Tipo string      `json:"tipo"`
		} `json:"sobrantes"`
		Cortes []CorteDibujado `json:"cortes"`
	} `json:"dibujo"`
	PiezasPorPlaca  float64 `json:"piezasPorPlaca"`
	PasadasPorPlaca float64 `json:"pasadasPorPlaca"`
	SeVendeEntera   bool    `json:"seVendeEntera"`
}

// HojaDeCorte es HojaDeCorte de lib/cortes/secuencia.ts.
type HojaDeCorte struct {
	PlacaLargo  float64           `json:"placaLargo"`
	PlacaAncho  float64           `json:"placaAncho"`
	AnchoSierra float64           `json:"anchoSierra"`
	Patrones    []PatronDeCorte   `json:"patrones"`
	Placas      float64           `json:"placas"`
	TotalPiezas float64           `json:"totalPiezas"`
	NoEntran    []PiezaQueNoEntra `json:"noEntran"`
}

// DatosHojaDeCorte son los dos argumentos de hojaDeCortePdf(corte, hoja).
type DatosHojaDeCorte struct {
	Corte CorteParaHoja `json:"corte"`
	Hoja  HojaDeCorte   `json:"hoja"`
}

var (
	rojoCorte     = RGB(0.76, 0.25, 0.05)
	fondoPlaca    = RGB(0.94, 0.91, 0.88)
	grisSobrante  = RGB(0.72, 0.69, 0.65)
	blancoCorte   = RGB(1, 1, 1)
	renglonDePaso = 19.0
)

// nCorte es el número de la hoja de corte: un decimal y sin separador de
// miles («1.160» se tipearía como 1,16 en la máquina).
func nCorte(v float64) string { return intlUnDecimal(v, false) }

// armadoHojaDeCorte guarda el cursor compartido que en el TS son los
// cierres leerY/fijarY.
type armadoHojaDeCorte struct {
	h     *Hoja
	corte CorteParaHoja
	hoja  HojaDeCorte
	y     float64
}

func (a *armadoHojaDeCorte) cabecera() {
	h, corte, hoja := a.h, a.corte, a.hoja
	h.Escribir("HOJA DE CORTE "+corte.Numero, Opciones{X: Margen, Y: a.y, Tamano: 15, Fuente: Negrita})
	h.Escribir(FechaLocal(corte.CreatedAt), Opciones{X: AnchoA4 - Margen, Y: a.y, Tamano: 9, Color: TintaSuave, Derecha: true})
	a.y -= 15
	h.Escribir(corte.Cliente+" · "+corte.Material+" · "+corte.DeQueSale+" de "+nCorte(hoja.PlacaLargo)+" × "+nCorte(hoja.PlacaAncho)+" mm · sierra "+formatearSierra(hoja.AnchoSierra),
		Opciones{X: Margen, Y: a.y, Tamano: 9.5, Color: TintaSuave})
	a.y -= 10
	h.Raya(a.y, 0, Color{})
	a.y -= 14
}

func (a *armadoHojaDeCorte) hojaNueva() {
	a.h.NuevaPagina()
	a.y = AltoA4 - Margen
	a.cabecera()
}

// HojaDeCortePdf arma la hoja de corte. ahora no se usa (la fecha es la del
// trabajo).
func HojaDeCortePdf(d DatosHojaDeCorte, _ time.Time) ([]byte, error) {
	h := NuevaHoja()
	hoja := d.Hoja
	anchoUtil := AnchoA4 - Margen*2
	a := &armadoHojaDeCorte{h: h, corte: d.Corte, hoja: hoja, y: AltoA4 - Margen}

	a.cabecera()

	placas := "placas"
	if hoja.Placas == 1 {
		placas = "placa"
	}
	a.y -= h.EscribirParrafo("Las medidas son las de la pieza: la máquina descuenta la sierra sola y tiene que tener cargado un disco de "+formatearSierra(hoja.AnchoSierra)+". Sin refilado: el plano usa la placa entera. Orden de la seccionadora: primero los cortes longitudinales de la placa, después los transversales de cada tira, después los de tercer nivel. Tandas de hasta 4 medidas. "+numeroJS(hoja.Placas)+" "+placas+", "+numeroJS(hoja.TotalPiezas)+" piezas.",
		Parrafo{Opciones: Opciones{X: Margen, Y: a.y, Tamano: 9.5}, Ancho: anchoUtil})
	a.y -= 6

	if n := len(hoja.NoEntran); n > 0 {
		cuantas := strconv.Itoa(n) + " piezas no entran"
		if n == 1 {
			cuantas = "Una pieza no entra"
		}
		medidas := make([]string, n)
		for i, p := range hoja.NoEntran {
			medidas[i] = nCorte(p.LargoMm) + " × " + nCorte(p.AnchoMm)
		}
		h.Escribir(cuantas+" en la placa y no está en esta hoja: "+strings.Join(medidas, ", "),
			Opciones{X: Margen, Y: a.y, Tamano: 9.5, Fuente: Negrita, Color: Naranja})
		a.y -= 16
	}

	if len(hoja.Patrones) == 0 {
		h.Escribir("No hay nada que cortar: el trabajo no tiene piezas que entren en la placa.",
			Opciones{X: Margen, Y: a.y, Tamano: 11, Fuente: Negrita})
	}

	for i, patron := range hoja.Patrones {
		if i > 0 {
			a.hojaNueva()
		}
		a.y = a.dibujarPatron(patron)
	}

	return h.Bytes()
}

func (a *armadoHojaDeCorte) dibujarPatron(patron PatronDeCorte) float64 {
	h, hoja := a.h, a.hoja
	anchoUtil := AnchoA4 - Margen*2
	y := a.y

	cuantas := len(patron.Placas)
	var titulo string
	if cuantas == 1 {
		titulo = "Placa " + numeroJS(patron.Placas[0])
	} else {
		nums := make([]string, cuantas)
		for i, p := range patron.Placas {
			nums[i] = numeroJS(p)
		}
		titulo = "Placas " + strings.Join(nums, ", ") + " · ×" + strconv.Itoa(cuantas) + " placas iguales"
	}
	h.Escribir(titulo, Opciones{X: Margen, Y: y, Tamano: 13, Fuente: Negrita})
	y -= 13
	porPlaca := ""
	if cuantas > 1 {
		porPlaca = " por placa"
	}
	queda := "se cobra el corte: los retales quedan en la maderera"
	if patron.SeVendeEntera {
		queda = "se vende entera: los retales son del cliente"
	}
	h.Escribir(numeroJS(patron.PiezasPorPlaca)+" piezas · "+numeroJS(patron.PasadasPorPlaca)+" cortes"+porPlaca+" · "+queda,
		Opciones{X: Margen, Y: y, Tamano: 9, Color: TintaSuave})
	y -= 8

	// El dibujo, a escala, con el ancho de la hoja y sin pasar de 95 mm de alto.
	escala := minimo(anchoUtil/hoja.PlacaLargo, Mm(95)/hoja.PlacaAncho)
	alto := hoja.PlacaAncho * escala
	x0 := Margen
	y0 := y - alto
	X := func(v float64) float64 { return x0 + float64(v*escala) }
	Y := func(v float64) float64 { return y - float64(v*escala) }

	h.Pagina.DibujarRectangulo(Rectangulo{X: x0, Y: y0, Ancho: hoja.PlacaLargo * escala, Alto: alto, Relleno: fondoPlaca, Borde: Tinta, Grosor: 1.2})

	for _, s := range patron.Dibujo.Sobrantes {
		o := Rectangulo{
			X: X(s.Rect.X), Y: Y(s.Rect.Y + s.Rect.Alto),
			Ancho: s.Rect.Ancho * escala, Alto: s.Rect.Alto * escala,
			Borde: grisSobrante, Grosor: 0.6,
		}
		trazo := []float64{}
		if s.Tipo == "retal" {
			trazo = []float64{3, 2}
		} else {
			media := 0.5
			o.Relleno = grisSobrante
			o.Opacidad = &media
		}
		h.Pagina.rectanguloConTrazo(o, trazo)
	}

	for _, dp := range patron.Dibujo.Piezas {
		rect, pieza := dp.Rect, dp.Pieza
		h.Pagina.DibujarRectangulo(Rectangulo{
			X: X(rect.X), Y: Y(rect.Y + rect.Alto),
			Ancho: rect.Ancho * escala, Alto: rect.Alto * escala,
			Relleno: blancoCorte, Borde: Tinta, Grosor: 0.8,
		})
		anchoPt := rect.Ancho * escala
		altoPt := rect.Alto * escala
		cuerpo := minimo(minimo(10, altoPt*0.4), anchoPt*0.3)
		if cuerpo >= 4 {
			grande := altoPt > cuerpo*2.6
			corrido := float64(-cuerpo * 0.35)
			if grande {
				corrido = 1
			}
			h.EscribirCentrado("P"+numeroJS(pieza.Indice+1), X(rect.X+rect.Ancho/2),
				Opciones{Y: Y(rect.Y+rect.Alto/2) + corrido, Tamano: cuerpo, Fuente: Negrita})
			medida := nCorte(rect.Ancho) + " × " + nCorte(rect.Alto)
			cuerpoMedida := minimo(7, cuerpo*0.8)
			if grande && Normal.Ancho(medida, cuerpoMedida) < anchoPt-2 {
				h.EscribirCentrado(medida, X(rect.X+rect.Ancho/2),
					Opciones{Y: Y(rect.Y+rect.Alto/2) - cuerpoMedida - 1, Tamano: cuerpoMedida, Color: TintaSuave})
			}
		}
	}

	for _, c := range patron.Dibujo.Cortes {
		h.Pagina.DibujarLinea(Linea{X1: X(c.X1), Y1: Y(c.Y1), X2: X(c.X2), Y2: Y(c.Y2), Grosor: 1.4, Color: rojoCorte})
	}
	for _, c := range patron.Dibujo.Cortes {
		horizontal := c.Y1 == c.Y2
		var largoPt float64
		if horizontal {
			largoPt = (c.X2 - c.X1) * escala
		} else {
			largoPt = (c.Y2 - c.Y1) * escala
		}
		corrimiento := minimo(11, largoPt/2)
		cx, cy := X(c.X1), Y(c.Y1)
		if horizontal {
			cx += corrimiento
		} else {
			cy -= corrimiento
		}
		h.Pagina.DibujarElipse(Elipse{X: cx, Y: cy, EscalaX: 5.2, EscalaY: 5.2, Relleno: rojoCorte, Borde: blancoCorte, Grosor: 0.8})
		tam := 7.0
		if c.Paso >= 10 {
			tam = 6
		}
		h.EscribirCentrado(numeroJS(c.Paso), cx, Opciones{Y: cy - 2.4, Tamano: tam, Fuente: Negrita, Color: blancoCorte})
	}

	y = y0 - 16
	a.y = y

	if len(patron.Operaciones) == 0 {
		h.Escribir("La pieza es la placa entera: no lleva cortes.", Opciones{X: Margen, Y: y, Tamano: 10})
		return y - 14
	}

	for _, op := range patron.Operaciones {
		y = a.dibujarOperacion(op, patron, a.y)
		a.y = y
	}
	return y
}

func (a *armadoHojaDeCorte) dibujarOperacion(op OperacionDeCorte, patron PatronDeCorte, desde float64) float64 {
	h := a.h
	y := desde
	necesita := 30 + float64(len(op.Pasos))*renglonDePaso + float64(len(op.Tandas)*10)
	if y-minimo(necesita, 200) < Margen {
		a.hojaNueva()
		y = a.y
	}

	veces := op.Repeticiones * float64(len(patron.Placas))
	var queEs string
	if op.DelPaso == nil {
		queEs = "La placa"
	} else {
		if op.Repeticiones == 1 {
			queEs = "El trozo"
		} else {
			queEs = "Los " + numeroJS(op.Repeticiones) + " trozos"
		}
		if op.Letra != "" {
			queEs += " " + op.Letra
		}
		queEs += " del paso " + numeroJS(*op.DelPaso)
	}
	h.Escribir(queEs+": "+nCorte(op.Largo)+" × "+nCorte(op.Ancho), Opciones{X: Margen, Y: y, Tamano: 11, Fuente: Negrita})
	dir := "transversales (de través)"
	if op.Direccion == "longitudinal" {
		dir = "longitudinales (a lo largo)"
	}
	hacer := ""
	if veces > 1 {
		hacer = " · hacerlo " + numeroJS(veces) + " veces"
	}
	h.Escribir("Nivel "+numeroJS(op.Nivel)+" · "+dir+hacer, Opciones{X: AnchoA4 - Margen, Y: y, Tamano: 9.5, Fuente: Negrita, Derecha: true, Color: TintaSuave})
	y -= 5
	h.Raya(y, 0.6, TintaSuave)
	y -= 15

	for t, tanda := range op.Tandas {
		if len(op.Tandas) > 1 {
			h.Escribir("TANDA "+strconv.Itoa(t+1)+" DE "+strconv.Itoa(len(op.Tandas)), Opciones{X: Margen, Y: y + 2, Tamano: 7, Color: TintaSuave})
			y -= 10
		}
		for _, paso := range tanda {
			if y < Margen+renglonDePaso {
				a.hojaNueva()
				y = a.y
			}
			// La casilla para tildar.
			h.Pagina.DibujarRectangulo(Rectangulo{X: Margen, Y: y - 3, Ancho: 11, Alto: 11, Borde: Tinta, Grosor: 1})
			h.Pagina.DibujarElipse(Elipse{X: Margen + 25, Y: y + 2.5, EscalaX: 7, EscalaY: 7, Relleno: rojoCorte})
			h.EscribirCentrado(numeroJS(paso.Numero), Margen+25, Opciones{Y: y - 0.5, Tamano: 8, Fuente: Negrita, Color: blancoCorte})
			h.Escribir(nCorte(paso.Medida), Opciones{X: Margen + Mm(36), Y: y - 2, Tamano: 15, Fuente: Negrita, Derecha: true})
			h.Escribir("×"+numeroJS(paso.Veces), Opciones{X: Margen + Mm(39), Y: y - 1, Tamano: 12, Fuente: Negrita})

			partes := make([]string, len(paso.Sale))
			for i, s := range paso.Sale {
				partes[i] = salidaDeCorte(s, paso)
			}
			nota := ""
			if paso.UltimaSinCorte {
				if paso.Veces == 1 {
					nota = " (sin cortar: es lo que queda)"
				} else {
					nota = " (la última sin cortar)"
				}
			}
			altoTexto := h.EscribirParrafo(strings.Join(partes, " / ")+nota, Parrafo{
				Opciones:     Opciones{X: Margen + Mm(54), Y: y, Tamano: 9},
				Ancho:        AnchoA4 - Margen*2 - Mm(54),
				Interlineado: 10,
			})
			// Si lo que sale ocupa varias líneas, el renglón crece con ellas.
			y -= maximo(renglonDePaso, altoTexto+9)
		}
	}

	sobra := "Queda: nada, la última tira llega al borde"
	if op.Sobra != nil {
		que := "desperdicio"
		if op.Sobra.Tipo == "retal" {
			que = "retal al stock"
			if patron.SeVendeEntera {
				que = "retal para el cliente"
			}
		}
		sobra = "Queda: " + nCorte(op.Sobra.Largo) + " × " + nCorte(op.Sobra.Ancho) + " · " + que
	}
	h.Escribir(sobra, Opciones{X: Margen + Mm(54), Y: y + 4, Tamano: 8.5, Color: TintaSuave})
	return y - 12
}

func salidaDeCorte(s SalidaDeCorte, paso PasoDeCorte) string {
	if s.Tipo == "pieza" {
		cual := "piezas"
		if s.Cantidad == 1 {
			cual = "pieza"
		}
		renglon := "undefined"
		if s.Renglon != nil {
			renglon = numeroJS(*s.Renglon)
		}
		t := numeroJS(s.Cantidad) + " " + cual + " P" + renglon + " " + nCorte(s.Largo) + " × " + nCorte(s.Ancho)
		if s.Girada {
			t += " (girada)"
		}
		if s.Etiqueta != nil && *s.Etiqueta != "" {
			t += " · " + *s.Etiqueta
		}
		return t
	}
	cual := "trozos"
	if s.Cantidad == 1 {
		cual = "trozo"
	}
	letra, letraDel := "", ""
	if s.Letra != "" {
		letra = " " + s.Letra
		letraDel = s.Letra + " "
	}
	return numeroJS(s.Cantidad) + " " + cual + letra + " de " + nCorte(s.Largo) + " × " + nCorte(s.Ancho) + ": sigue en «" + letraDel + "del paso " + numeroJS(paso.Numero) + "»"
}
