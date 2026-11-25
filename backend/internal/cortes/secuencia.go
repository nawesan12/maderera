package cortes

// La hoja de corte para la seccionadora: el plano dicho en el orden en que lo
// corta la máquina (lib/cortes/secuencia.ts). El árbol guillotina se rearma
// desde las posiciones de las piezas, no desde el registro de cortes del
// motor; las tiras van juntas desde el borde de referencia y los sobrantes al
// final, del lado del empujador.

import (
	"cmp"
	"encoding/json"
	"fmt"
	"math"
	"slices"
	"strings"

	"mjbj/internal/jsmath"
)

// Rect es un rectángulo sobre la placa.
type Rect struct {
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
	Ancho float64 `json:"ancho"`
	Alto  float64 `json:"alto"`
}

// Trozo es un pedazo de placa en el árbol de cortes: una pieza, un sobrante
// o un trozo partido en tiras.
type Trozo struct {
	Tipo  string // "pieza" | "sobrante" | "partido"
	Rect  Rect
	Pieza *PiezaColocada
	// Solo los partidos.
	Eje            string
	Nivel          int
	Hijos          []*Trozo
	UltimaSinCorte bool
	Sobra          *Rect

	firma string
}

// MarshalJSON escribe solo los campos de cada tipo, como la unión del TS.
func (t *Trozo) MarshalJSON() ([]byte, error) {
	switch t.Tipo {
	case "pieza":
		return json.Marshal(struct {
			Tipo  string         `json:"tipo"`
			Rect  Rect           `json:"rect"`
			Pieza *PiezaColocada `json:"pieza"`
		}{t.Tipo, t.Rect, t.Pieza})
	case "sobrante":
		return json.Marshal(struct {
			Tipo string `json:"tipo"`
			Rect Rect   `json:"rect"`
		}{t.Tipo, t.Rect})
	}
	hijos := t.Hijos
	if hijos == nil {
		hijos = []*Trozo{}
	}
	return json.Marshal(struct {
		Tipo           string   `json:"tipo"`
		Rect           Rect     `json:"rect"`
		Eje            string   `json:"eje"`
		Nivel          int      `json:"nivel"`
		Hijos          []*Trozo `json:"hijos"`
		UltimaSinCorte bool     `json:"ultimaSinCorte"`
		Sobra          *Rect    `json:"sobra"`
	}{t.Tipo, t.Rect, t.Eje, t.Nivel, hijos, t.UltimaSinCorte, t.Sobra})
}

// Salida es qué sale de un paso.
type Salida struct {
	Cantidad int
	Tipo     string // "pieza" | "trozo"
	Largo    float64
	Ancho    float64
	Renglon  int
	Etiqueta *string
	Girada   bool
	SigueEn  int
	Letra    string
}

// MarshalJSON: los campos de pieza solo en las piezas, y sigueEn y letra
// solo si están, como los opcionales del TS.
func (s *Salida) MarshalJSON() ([]byte, error) {
	m := map[string]any{"cantidad": s.Cantidad, "tipo": s.Tipo, "largo": s.Largo, "ancho": s.Ancho}
	if s.Tipo == "pieza" {
		m["renglon"] = s.Renglon
		m["etiqueta"] = s.Etiqueta
		m["girada"] = s.Girada
	}
	if s.SigueEn != 0 {
		m["sigueEn"] = s.SigueEn
	}
	if s.Letra != "" {
		m["letra"] = s.Letra
	}
	return json.Marshal(m)
}

// PasoDeCorte es una medida que se tipea, y cuántas veces seguidas.
type PasoDeCorte struct {
	Numero         int       `json:"numero"`
	Medida         float64   `json:"medida"`
	Veces          int       `json:"veces"`
	UltimaSinCorte bool      `json:"ultimaSinCorte"`
	Sale           []*Salida `json:"sale"`
}

// Sobra es lo que queda al final de una operación, del lado del empujador.
type Sobra struct {
	Largo float64 `json:"largo"`
	Ancho float64 `json:"ancho"`
	Tipo  string  `json:"tipo"`
}

// OperacionDeCorte es un trozo puesto en la máquina con sus pasos.
type OperacionDeCorte struct {
	Numero       int              `json:"numero"`
	Nivel        int              `json:"nivel"`
	Direccion    string           `json:"direccion"`
	Largo        float64          `json:"largo"`
	Ancho        float64          `json:"ancho"`
	Repeticiones int              `json:"repeticiones"`
	DelPaso      *int             `json:"delPaso"`
	Letra        string           `json:"letra,omitempty"`
	Pasos        []*PasoDeCorte   `json:"pasos"`
	Tandas       [][]*PasoDeCorte `json:"tandas"`
	Sobra        *Sobra           `json:"sobra"`
}

// CorteDibujado es un corte del dibujo, rotulado con el número de su paso.
type CorteDibujado struct {
	X1   float64 `json:"x1"`
	Y1   float64 `json:"y1"`
	X2   float64 `json:"x2"`
	Y2   float64 `json:"y2"`
	Paso int     `json:"paso"`
}

// PiezaDibujada y SobranteDibujado son lo que lleva el dibujo de un patrón.
type PiezaDibujada struct {
	Rect  Rect           `json:"rect"`
	Pieza *PiezaColocada `json:"pieza"`
}

type SobranteDibujado struct {
	Rect Rect   `json:"rect"`
	Tipo string `json:"tipo"`
}

// Dibujo es la placa de un patrón, con cada corte rotulado.
type Dibujo struct {
	Piezas    []PiezaDibujada    `json:"piezas"`
	Sobrantes []SobranteDibujado `json:"sobrantes"`
	Cortes    []CorteDibujado    `json:"cortes"`
}

// PatronDeCorte son las placas que se cortan igual.
type PatronDeCorte struct {
	Placas          []int               `json:"placas"`
	Arbol           *Trozo              `json:"arbol"`
	Operaciones     []*OperacionDeCorte `json:"operaciones"`
	Dibujo          Dibujo              `json:"dibujo"`
	PiezasPorPlaca  int                 `json:"piezasPorPlaca"`
	PasadasPorPlaca int                 `json:"pasadasPorPlaca"`
	SeVendeEntera   bool                `json:"seVendeEntera"`
}

// HojaDeCorte es la hoja entera.
type HojaDeCorte struct {
	PlacaLargo  float64          `json:"placaLargo"`
	PlacaAncho  float64          `json:"placaAncho"`
	AnchoSierra float64          `json:"anchoSierra"`
	Patrones    []*PatronDeCorte `json:"patrones"`
	Placas      int              `json:"placas"`
	TotalPiezas int              `json:"totalPiezas"`
	NoEntran    []NoEntra        `json:"noEntran"`
}

// MedidasPorTanda es cuántas medidas acepta el semiautomático de una vez.
const MedidasPorTanda = 4

const eps = 0.01

func r3(n float64) float64 { return jsmath.Round(float64(n*1000)) / 1000 }

// ErrNoGuillotina no debería pasar nunca: el plano no era guillotina.
type ErrNoGuillotina struct{ Ancho, Alto float64 }

func (e ErrNoGuillotina) Error() string {
	return fmt.Sprintf("No se encontró un corte de borde a borde en un trozo de %s × %s", jsmath.Texto(e.Ancho), jsmath.Texto(e.Alto))
}

// ArmarHojaDeCorte arma la hoja de todo el plano (armarHojaDeCorte). Las
// placas con el mismo patrón van juntas como «×N placas».
func ArmarHojaDeCorte(plano Plano) (HojaDeCorte, error) {
	patrones := []*PatronDeCorte{}
	porFirma := map[string]*PatronDeCorte{}

	for _, placa := range plano.Placas {
		piezas := make([]PiezaColocada, len(placa.Piezas))
		for i, p := range placa.Piezas {
			p.X, p.Y, p.Ancho, p.Alto = r3(p.X), r3(p.Y), r3(p.Ancho), r3(p.Alto)
			piezas[i] = p
		}
		arbol, err := partir(Rect{0, 0, plano.PlacaLargo, plano.PlacaAncho}, piezas, plano.AnchoSierra, 1, 0)
		if err != nil {
			return HojaDeCorte{}, err
		}
		clave := firma(arbol)
		if igual, ok := porFirma[clave]; ok {
			igual.Placas = append(igual.Placas, placa.Numero)
			continue
		}
		operaciones, deCadaTrozo := operacionesDe(arbol)
		pasadas := 0
		for _, op := range operaciones {
			s := 0
			for _, p := range op.Pasos {
				s += p.Veces
				if p.UltimaSinCorte {
					s--
				}
			}
			pasadas += op.Repeticiones * s
		}
		patron := &PatronDeCorte{
			Placas: []int{placa.Numero}, Arbol: arbol, Operaciones: operaciones,
			Dibujo:         dibujoDe(arbol, deCadaTrozo, plano.AnchoSierra),
			PiezasPorPlaca: len(placa.Piezas), PasadasPorPlaca: pasadas, SeVendeEntera: placa.SeVendeEntera,
		}
		porFirma[clave] = patron
		patrones = append(patrones, patron)
	}

	noEntran := plano.NoEntran
	if noEntran == nil {
		noEntran = []NoEntra{}
	}
	return HojaDeCorte{
		PlacaLargo: plano.PlacaLargo, PlacaAncho: plano.PlacaAncho, AnchoSierra: plano.AnchoSierra,
		Patrones: patrones, Placas: len(plano.Placas), TotalPiezas: plano.TotalPiezas, NoEntran: noEntran,
	}, nil
}

func ejeDelNivel(nivel int) string {
	if nivel%2 == 1 {
		return "y"
	}
	return "x"
}

func desdeR(r Rect, eje string) float64 {
	if eje == "y" {
		return r.Y
	}
	return r.X
}

func largoR(r Rect, eje string) float64 {
	if eje == "y" {
		return r.Alto
	}
	return r.Ancho
}

func desdeP(p PiezaColocada, eje string) float64 {
	if eje == "y" {
		return p.Y
	}
	return p.X
}

func largoP(p PiezaColocada, eje string) float64 {
	if eje == "y" {
		return p.Alto
	}
	return p.Ancho
}

type tira struct {
	desde, hasta float64
	piezas       []PiezaColocada
}

func partir(rect Rect, piezas []PiezaColocada, sierra float64, nivel, saltos int) (*Trozo, error) {
	if len(piezas) == 0 {
		return &Trozo{Tipo: "sobrante", Rect: rect}, nil
	}
	if len(piezas) == 1 {
		p := piezas[0]
		if math.Abs(p.Ancho-rect.Ancho) <= eps && math.Abs(p.Alto-rect.Alto) <= eps {
			p.X, p.Y = rect.X, rect.Y
			return &Trozo{Tipo: "pieza", Rect: rect, Pieza: &p}, nil
		}
	}

	eje := ejeDelNivel(nivel)
	tiras := tirasEn(piezas, eje, sierra)
	total := largoR(rect, eje)
	usado := 0.0
	for _, t := range tiras {
		usado = usado + (t.hasta - t.desde)
	}
	usado = usado + float64(float64(len(tiras)-1)*sierra)
	resto := r3(total - usado)

	if len(tiras) == 1 && resto <= eps {
		if saltos >= 1 {
			return nil, ErrNoGuillotina{rect.Ancho, rect.Alto}
		}
		return partir(rect, piezas, sierra, nivel+1, saltos+1)
	}

	ordenMedida := map[string]int{}
	for i, t := range tiras {
		m := claveMedida(t.hasta - t.desde)
		if _, ok := ordenMedida[m]; !ok {
			ordenMedida[m] = i
		}
	}

	type provisorio struct {
		t      tira
		medida float64
		firma  string
		hijo   *Trozo
	}
	provisorios := make([]provisorio, len(tiras))
	for i, t := range tiras {
		medida := r3(t.hasta - t.desde)
		hijo, err := partir(rectDeTira(rect, eje, t.desde, medida), t.piezas, sierra, nivel+1, 0)
		if err != nil {
			return nil, err
		}
		provisorios[i] = provisorio{t, medida, firma(hijo), hijo}
	}
	ordenFirma := map[string]int{}
	for i, p := range provisorios {
		if _, ok := ordenFirma[p.firma]; !ok {
			ordenFirma[p.firma] = i
		}
	}
	slices.SortStableFunc(provisorios, func(a, b provisorio) int {
		// `ordenMedida.get(...) - ordenMedida.get(...) || ...`: si falta una
		// clave la resta es NaN, que es falsa, y decide la firma.
		ma, okA := ordenMedida[claveMedida(a.medida)]
		mb, okB := ordenMedida[claveMedida(b.medida)]
		if okA && okB && ma != mb {
			return cmp.Compare(ma, mb)
		}
		return cmp.Compare(ordenFirma[a.firma], ordenFirma[b.firma])
	})

	cursor := desdeR(rect, eje)
	hijos := make([]*Trozo, 0, len(provisorios))
	for _, p := range provisorios {
		hijos = append(hijos, mover(p.hijo, eje, cursor-p.t.desde))
		cursor = r3(cursor + p.medida + sierra)
	}

	ultimaSinCorte := resto <= eps
	fin := desdeR(rect, eje) + total
	finUltima := cursor - sierra
	largoSobra := r3(fin - finUltima - sierra)
	var sobra *Rect
	if !ultimaSinCorte && largoSobra > eps {
		s := rectDeTira(rect, eje, finUltima+sierra, largoSobra)
		sobra = &s
	}
	return &Trozo{Tipo: "partido", Rect: rect, Eje: eje, Nivel: nivel, Hijos: hijos, UltimaSinCorte: ultimaSinCorte, Sobra: sobra}, nil
}

// claveMedida es una medida como clave, sin el ruido del punto flotante.
func claveMedida(n float64) string {
	return jsmath.ToFixed(jsmath.Round(float64(n*100))/100, 2)
}

func tirasEn(piezas []PiezaColocada, eje string, sierra float64) []tira {
	ordenadas := slices.Clone(piezas)
	slices.SortStableFunc(ordenadas, func(a, b PiezaColocada) int {
		if d := cmp.Compare(desdeP(a, eje), desdeP(b, eje)); d != 0 {
			return d
		}
		return cmp.Compare(largoP(a, eje), largoP(b, eje))
	})
	var tiras []tira
	for _, p := range ordenadas {
		ini := desdeP(p, eje)
		fin := ini + largoP(p, eje)
		if n := len(tiras); n > 0 && ini < tiras[n-1].hasta+sierra-eps {
			tiras[n-1].hasta = math.Max(tiras[n-1].hasta, fin)
			tiras[n-1].piezas = append(tiras[n-1].piezas, p)
		} else {
			tiras = append(tiras, tira{ini, fin, []PiezaColocada{p}})
		}
	}
	return tiras
}

func rectDeTira(rect Rect, eje string, ini, medida float64) Rect {
	if eje == "y" {
		return Rect{rect.X, r3(ini), rect.Ancho, r3(medida)}
	}
	return Rect{r3(ini), rect.Y, r3(medida), rect.Alto}
}

func mover(t *Trozo, eje string, d float64) *Trozo {
	if math.Abs(d) <= 0 {
		return t
	}
	r := func(x Rect) Rect {
		if eje == "y" {
			x.Y = r3(x.Y + d)
		} else {
			x.X = r3(x.X + d)
		}
		return x
	}
	switch t.Tipo {
	case "pieza":
		rect := r(t.Rect)
		p := *t.Pieza
		p.X, p.Y = rect.X, rect.Y
		return &Trozo{Tipo: "pieza", Rect: rect, Pieza: &p, firma: t.firma}
	case "sobrante":
		return &Trozo{Tipo: "sobrante", Rect: r(t.Rect), firma: t.firma}
	}
	nuevo := *t
	nuevo.Rect = r(t.Rect)
	nuevo.Hijos = make([]*Trozo, len(t.Hijos))
	for i, h := range t.Hijos {
		nuevo.Hijos[i] = mover(h, eje, d)
	}
	if t.Sobra != nil {
		s := r(*t.Sobra)
		nuevo.Sobra = &s
	}
	return &nuevo
}

// firma identifica un trozo sin mirar dónde está. Se guarda en el trozo: no
// depende de la posición, así que sobrevive a mover.
func firma(t *Trozo) string {
	if t.firma != "" {
		return t.firma
	}
	m := claveMedida(t.Rect.Ancho) + "x" + claveMedida(t.Rect.Alto)
	switch t.Tipo {
	case "pieza":
		g := ""
		if t.Pieza.Girada {
			g = "g"
		}
		t.firma = fmt.Sprintf("P%d%s:%s", t.Pieza.Indice, g, m)
	case "sobrante":
		t.firma = "S:" + m
	default:
		hs := make([]string, len(t.Hijos))
		for i, h := range t.Hijos {
			hs[i] = firma(h)
		}
		u := ""
		if t.UltimaSinCorte {
			u = "!"
		}
		t.firma = "T" + t.Eje + u + ":" + m + "(" + strings.Join(hs, ",") + ")"
	}
	return t.firma
}

func operacionesDe(arbol *Trozo) ([]*OperacionDeCorte, map[*Trozo]*OperacionDeCorte) {
	operaciones := []*OperacionDeCorte{}
	deCadaTrozo := map[*Trozo]*OperacionDeCorte{}
	if arbol.Tipo != "partido" {
		return operaciones, deCadaTrozo
	}

	type pendiente struct {
		trozos       []*Trozo
		repeticiones int
		delPaso      *int
		salida       *Salida
	}
	pendientes := []pendiente{{trozos: []*Trozo{arbol}, repeticiones: 1}}
	numeroDePaso := 0

	for len(pendientes) > 0 {
		var siguientes []pendiente
		for _, pe := range pendientes {
			trozo := pe.trozos[0]
			direccion := "transversal"
			if trozo.Eje == "y" {
				direccion = "longitudinal"
			}
			op := &OperacionDeCorte{
				Numero: len(operaciones) + 1, Nivel: trozo.Nivel, Direccion: direccion,
				Largo: trozo.Rect.Ancho, Ancho: trozo.Rect.Alto, Repeticiones: pe.repeticiones,
				DelPaso: pe.delPaso, Pasos: []*PasoDeCorte{}, Tandas: [][]*PasoDeCorte{},
			}
			if trozo.Sobra != nil {
				op.Sobra = &Sobra{trozo.Sobra.Ancho, trozo.Sobra.Alto, tipoDeSobrante(*trozo.Sobra)}
			}
			operaciones = append(operaciones, op)
			for _, t := range pe.trozos {
				deCadaTrozo[t] = op
			}
			if pe.salida != nil {
				pe.salida.SigueEn = op.Numero
				if pe.salida.Letra != "" {
					op.Letra = pe.salida.Letra
				}
			}

			i := 0
			for i < len(trozo.Hijos) {
				medida := largoR(trozo.Hijos[i].Rect, trozo.Eje)
				j := i
				for j < len(trozo.Hijos) && math.Abs(largoR(trozo.Hijos[j].Rect, trozo.Eje)-medida) <= eps {
					j++
				}
				numeroDePaso++
				paso := &PasoDeCorte{
					Numero: numeroDePaso, Medida: medida, Veces: j - i,
					UltimaSinCorte: j == len(trozo.Hijos) && trozo.UltimaSinCorte, Sale: []*Salida{},
				}

				type grupo struct {
					salida *Salida
					hijos  []*Trozo
				}
				porFirma := map[string]*grupo{}
				var ordenFirmas []string
				for k := i; k < j; k++ {
					hijos := make([]*Trozo, len(pe.trozos))
					for x, t := range pe.trozos {
						hijos[x] = t.Hijos[k]
					}
					hijo := hijos[0]
					f := firma(hijo)
					if ya, ok := porFirma[f]; ok {
						ya.salida.Cantidad += pe.repeticiones
						ya.hijos = append(ya.hijos, hijos...)
						continue
					}
					var s *Salida
					if hijo.Tipo == "pieza" {
						s = &Salida{Cantidad: pe.repeticiones, Tipo: "pieza", Largo: hijo.Rect.Ancho, Ancho: hijo.Rect.Alto,
							Renglon: hijo.Pieza.Indice + 1, Etiqueta: hijo.Pieza.Etiqueta, Girada: hijo.Pieza.Girada}
					} else {
						s = &Salida{Cantidad: pe.repeticiones, Tipo: "trozo", Largo: hijo.Rect.Ancho, Ancho: hijo.Rect.Alto}
					}
					porFirma[f] = &grupo{s, slices.Clone(hijos)}
					ordenFirmas = append(ordenFirmas, f)
					paso.Sale = append(paso.Sale, s)
				}

				var queSiguen []*Salida
				for _, s := range paso.Sale {
					if s.Tipo == "trozo" {
						queSiguen = append(queSiguen, s)
					}
				}
				if len(queSiguen) > 1 {
					for k, s := range queSiguen {
						s.Letra = string(rune(65 + k))
					}
				}

				for _, f := range ordenFirmas {
					g := porFirma[f]
					if g.hijos[0].Tipo == "partido" {
						n := paso.Numero
						siguientes = append(siguientes, pendiente{trozos: g.hijos, repeticiones: g.salida.Cantidad, delPaso: &n, salida: g.salida})
					}
				}

				op.Pasos = append(op.Pasos, paso)
				i = j
			}

			for t := 0; t < len(op.Pasos); t += MedidasPorTanda {
				op.Tandas = append(op.Tandas, op.Pasos[t:min(t+MedidasPorTanda, len(op.Pasos))])
			}
		}
		pendientes = siguientes
	}
	return operaciones, deCadaTrozo
}

func tipoDeSobrante(r Rect) string {
	if r.Ancho >= MinimoAprovechable && r.Alto >= MinimoAprovechable {
		return "retal"
	}
	return "desperdicio"
}

func dibujoDe(arbol *Trozo, deCadaTrozo map[*Trozo]*OperacionDeCorte, sierra float64) Dibujo {
	d := Dibujo{Piezas: []PiezaDibujada{}, Sobrantes: []SobranteDibujado{}, Cortes: []CorteDibujado{}}
	var recorrer func(t *Trozo)
	recorrer = func(t *Trozo) {
		switch t.Tipo {
		case "pieza":
			d.Piezas = append(d.Piezas, PiezaDibujada{t.Rect, t.Pieza})
			return
		case "sobrante":
			d.Sobrantes = append(d.Sobrantes, SobranteDibujado{t.Rect, tipoDeSobrante(t.Rect)})
			return
		}
		var numeros []int
		if op := deCadaTrozo[t]; op != nil {
			for _, p := range op.Pasos {
				for v := 0; v < p.Veces; v++ {
					numeros = append(numeros, p.Numero)
				}
			}
		}
		finTrozo := desdeR(t.Rect, t.Eje) + largoR(t.Rect, t.Eje)
		for i, h := range t.Hijos {
			if !(i == len(t.Hijos)-1 && t.UltimaSinCorte) {
				fin := desdeR(h.Rect, t.Eje) + largoR(h.Rect, t.Eje)
				c := r3(math.Min(fin+sierra/2, finTrozo))
				paso := 0
				if i < len(numeros) {
					paso = numeros[i]
				}
				if t.Eje == "y" {
					d.Cortes = append(d.Cortes, CorteDibujado{t.Rect.X, c, t.Rect.X + t.Rect.Ancho, c, paso})
				} else {
					d.Cortes = append(d.Cortes, CorteDibujado{c, t.Rect.Y, c, t.Rect.Y + t.Rect.Alto, paso})
				}
			}
			recorrer(h)
		}
		if t.Sobra != nil {
			d.Sobrantes = append(d.Sobrantes, SobranteDibujado{*t.Sobra, tipoDeSobrante(*t.Sobra)})
		}
	}
	recorrer(arbol)
	return d
}
