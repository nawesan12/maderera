// Package cortes es el corte a medida: el plano (motor guillotina y la regla
// de la media placa), la hoja de corte en el orden de la seccionadora, el
// programa PTX, la lista de piezas para el optimizador, la tarifa, el
// presupuesto, las calculadoras de materiales y la cola del taller. Era
// lib/cortes/**, lib/calculations.ts y los DAL de cortes del TypeScript.
//
// La geometría es pura y da **exactamente** lo mismo que el TS (golden en
// testdata/golden/cortes): el plano no se guarda, se rehace en cada pantalla,
// y un trabajo tiene que redibujarse igual que cuando se cobró.
package cortes

import (
	"cmp"
	"encoding/json"
	"math"
	"slices"
)

// LeerAcomodoManual lee el acomodo guardado: ante cualquier duda, ninguna
// fijada (el plano se recalcula solo, como antes de que existiera).
func LeerAcomodoManual(crudo string) []PiezaFijada {
	out := []PiezaFijada{}
	var leido []any
	if crudo == "" || json.Unmarshal([]byte(crudo), &leido) != nil {
		return out
	}
	entero := func(v any) (int, bool) {
		f, ok := v.(float64)
		if !ok || f != math.Trunc(f) || math.IsInf(f, 0) || math.Abs(f) > 1<<53 {
			return 0, false
		}
		return int(f), true
	}
	for _, x := range leido {
		m, ok := x.(map[string]any)
		if !ok {
			continue
		}
		i, ok1 := entero(m["indice"])
		u, ok2 := entero(m["unidad"])
		p, ok3 := entero(m["placa"])
		if !ok1 || !ok2 || !ok3 || p < 1 {
			continue
		}
		f := PiezaFijada{Indice: i, Unidad: u, Placa: p}
		if g, ok := m["girada"].(bool); ok {
			f.Girada = &g
		}
		out = append(out, f)
	}
	return out
}

// MinimoAprovechable es desde qué medida un sobrante deja de ser viruta y
// pasa a ser retal (MINIMO_APROVECHABLE): 150 mm de lado.
const MinimoAprovechable = 150

// UmbralPlacaEntera es la regla del negocio: si de una placa sale más de la
// mitad, se vende la placa entera y el corte va sin cargo
// (UMBRAL_PLACA_ENTERA).
const UmbralPlacaEntera = 0.5

// SemillaDeBusqueda es la semilla fija del azar de la búsqueda: mismo
// despiece, mismo plano, en cualquier máquina y en cualquier momento.
const SemillaDeBusqueda = 20260914

// PresupuestoDeBusqueda es cuánto trabajo («pieza × placa») puede hacer la
// búsqueda. Se mide en trabajo y no en tiempo por la misma razón que la
// semilla es fija.
const PresupuestoDeBusqueda = 90_000

// PiezasMaximasParaBuscar: desde cuántas piezas queda la heurística sola.
const PiezasMaximasParaBuscar = 400

const (
	rondasMinimas = 16
	rondasMaximas = 600
)

// AnchoDeSierraMm es lo que se come la sierra en cada pasada, del brief.
const AnchoDeSierraMm = 5

// PiezaAcortar es un renglón del despiece.
type PiezaAcortar struct {
	LargoMm     float64 `json:"largoMm"`
	AnchoMm     float64 `json:"anchoMm"`
	Cantidad    float64 `json:"cantidad"`
	RespetaVeta float64 `json:"respetaVeta"`
	Etiqueta    *string `json:"etiqueta"`
	CantoLargo  float64 `json:"cantoLargo"`
	CantoAncho  float64 `json:"cantoAncho"`
}

// PiezaColocada es una pieza ya ubicada sobre una placa, en mm desde el borde.
type PiezaColocada struct {
	X             float64 `json:"x"`
	Y             float64 `json:"y"`
	Ancho         float64 `json:"ancho"`
	Alto          float64 `json:"alto"`
	Indice        int     `json:"indice"`
	Unidad        int     `json:"unidad"`
	Etiqueta      *string `json:"etiqueta"`
	Girada        bool    `json:"girada"`
	LargoOriginal float64 `json:"largoOriginal"`
	AnchoOriginal float64 `json:"anchoOriginal"`
}

// Recorte es un pedazo entero de placa que sobra.
type Recorte struct {
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
	Ancho float64 `json:"ancho"`
	Alto  float64 `json:"alto"`
}

// LineaDeCorte es un corte de borde a borde del pedazo que parte.
type LineaDeCorte struct {
	Direccion string  `json:"direccion"`
	X1        float64 `json:"x1"`
	Y1        float64 `json:"y1"`
	X2        float64 `json:"x2"`
	Y2        float64 `json:"y2"`
}

// PlacaDelPlano es una placa del plano.
type PlacaDelPlano struct {
	Numero        int             `json:"numero"`
	Piezas        []PiezaColocada `json:"piezas"`
	Cortes        []LineaDeCorte  `json:"cortes"`
	Recortes      []Recorte       `json:"recortes"`
	Aprovechado   float64         `json:"aprovechado"`
	SeVendeEntera bool            `json:"seVendeEntera"`
}

// NoEntra es una pieza que no entra ni en una placa virgen.
type NoEntra struct {
	Indice  int     `json:"indice"`
	LargoMm float64 `json:"largoMm"`
	AnchoMm float64 `json:"anchoMm"`
}

// PiezaFijada es una pieza que alguien mandó a una placa: se fija la placa,
// no la coordenada.
type PiezaFijada struct {
	Indice int   `json:"indice"`
	Unidad int   `json:"unidad"`
	Placa  int   `json:"placa"`
	Girada *bool `json:"girada,omitempty"`
}

// Plano es el plano de corte entero (PlanoDeCorte del TS).
type Plano struct {
	PlacaLargo         float64         `json:"placaLargo"`
	PlacaAncho         float64         `json:"placaAncho"`
	AnchoSierra        float64         `json:"anchoSierra"`
	Placas             []PlacaDelPlano `json:"placas"`
	NoEntran           []NoEntra       `json:"noEntran"`
	TotalPiezas        int             `json:"totalPiezas"`
	AprovechadoTotal   float64         `json:"aprovechadoTotal"`
	Pasadas            int             `json:"pasadas"`
	RecorteMayor       *Recorte        `json:"recorteMayor"`
	PlacasEnteras      int             `json:"placasEnteras"`
	PasadasCobrables   int             `json:"pasadasCobrables"`
	FijadasDescartadas []PiezaFijada   `json:"fijadasDescartadas"`
}

// DatosDelPlano es lo que entra al motor. Los punteros nulos toman el valor
// por omisión del TS (sierra 5, búsqueda prendida, semilla y presupuesto
// fijos).
type DatosDelPlano struct {
	Piezas      []PiezaAcortar
	PlacaLargo  float64
	PlacaAncho  float64
	AnchoSierra *float64
	Fijadas     []PiezaFijada
	Busqueda    *bool
	Semilla     *uint32
	Presupuesto *float64
}

// SuperficieDeSierra es cuánto material se lleva la sierra en una placa, en
// mm² (superficieDeSierra).
func SuperficieDeSierra(cortes []LineaDeCorte, anchoSierra float64) float64 {
	total := 0.0
	for _, c := range cortes {
		var largo float64
		if c.Direccion == "horizontal" {
			largo = math.Abs(c.X2 - c.X1)
		} else {
			largo = math.Abs(c.Y2 - c.Y1)
		}
		total = total + float64(largo*anchoSierra)
	}
	return total
}

type orientacion struct {
	ancho, alto float64
	girada      bool
}

type unidad struct {
	indice, unidad int
	pieza          *PiezaAcortar
	posibles       []orientacion
}

type libre struct{ x, y, ancho, alto float64 }

type placaEnCurso struct {
	piezas []PiezaColocada
	cortes []LineaDeCorte
	libres []libre
}

type intento struct {
	placas      []*placaEnCurso
	orden       []*unidad
	descartadas []PiezaFijada
}

type reglaDePartir int

const (
	corto reglaDePartir = iota
	largo
)

type criterio func(o orientacion) float64

var criterios = []criterio{
	func(o orientacion) float64 { return o.ancho * o.alto },
	func(o orientacion) float64 { return math.Max(o.ancho, o.alto) },
	func(o orientacion) float64 { return o.alto },
	func(o orientacion) float64 { return o.ancho },
}

// CalcularPlano arma el plano (calcularPlanoDeCorte).
func CalcularPlano(d DatosDelPlano) Plano {
	sierra := float64(AnchoDeSierraMm)
	if d.AnchoSierra != nil {
		sierra = *d.AnchoSierra
	}
	busqueda := d.Busqueda == nil || *d.Busqueda
	semilla := uint32(SemillaDeBusqueda)
	if d.Semilla != nil {
		semilla = *d.Semilla
	}
	presupuesto := float64(PresupuestoDeBusqueda)
	if d.Presupuesto != nil {
		presupuesto = *d.Presupuesto
	}
	placaLargo, placaAncho := d.PlacaLargo, d.PlacaAncho

	vacio := Plano{
		PlacaLargo: placaLargo, PlacaAncho: placaAncho, AnchoSierra: sierra,
		Placas: []PlacaDelPlano{}, NoEntran: []NoEntra{}, FijadasDescartadas: []PiezaFijada{},
	}
	if placaLargo <= 0 || placaAncho <= 0 {
		return vacio
	}

	var unidades []*unidad
	noEntran := []NoEntra{}
	for indice := range d.Piezas {
		pieza := &d.Piezas[indice]
		posibles := orientacionesPosibles(pieza, placaLargo, placaAncho)
		n := math.Max(0, math.Floor(pieza.Cantidad))
		for u := 1; float64(u) <= n; u++ {
			if len(posibles) == 0 {
				noEntran = append(noEntran, NoEntra{indice, pieza.LargoMm, pieza.AnchoMm})
				continue
			}
			unidades = append(unidades, &unidad{indice: indice, unidad: u, pieza: pieza, posibles: posibles})
		}
	}
	if len(unidades) == 0 {
		vacio.NoEntran = noEntran
		return vacio
	}

	type claveFijada struct{ i, u int }
	porClave := map[claveFijada]PiezaFijada{}
	for _, f := range d.Fijadas {
		porClave[claveFijada{f.Indice, f.Unidad}] = f
	}
	var aFijar, sueltas []*unidad
	for _, u := range unidades {
		if _, ok := porClave[claveFijada{u.indice, u.unidad}]; ok {
			aFijar = append(aFijar, u)
		} else {
			sueltas = append(sueltas, u)
		}
	}
	fijadaDe := func(u *unidad) PiezaFijada { return porClave[claveFijada{u.indice, u.unidad}] }

	probar := func(orden []*unidad, sembrarCon reglaDePartir, partir func() reglaDePartir) intento {
		placas, descartadas, devueltas := sembrarFijadas(aFijar, fijadaDe, placaLargo, placaAncho, sierra, sembrarCon)
		todas := make([]*unidad, 0, len(orden)+len(devueltas))
		todas = append(todas, orden...)
		todas = append(todas, devueltas...)
		placas = acomodar(todas, placaLargo, placaAncho, sierra, partir, placas)
		return intento{placas: placas, orden: orden, descartadas: descartadas}
	}

	var mejor *intento
	for _, c := range criterios {
		orden := ordenarPor(sueltas, c, func() float64 { return 0 })
		for _, regla := range []reglaDePartir{corto, largo} {
			r := regla
			it := probar(orden, r, func() reglaDePartir { return r })
			if mejor == nil || esMejor(it.placas, mejor.placas) {
				mejor = &it
			}
		}
	}

	if busqueda && mejor != nil && len(sueltas) > 1 && len(unidades) <= PiezasMaximasParaBuscar {
		m := buscarMejorPlano(*mejor, sueltas, probar, semilla, presupuesto)
		mejor = &m
	}

	enCurso := mejor.placas
	descartadas := mejor.descartadas
	if descartadas == nil {
		descartadas = []PiezaFijada{}
	}
	superficiePlaca := placaLargo * placaAncho
	superficieUtil := 0.0

	placas := make([]PlacaDelPlano, len(enCurso))
	for i, p := range enCurso {
		util := superficieDe(p.piezas)
		superficieUtil += util
		aprovechado := util / superficiePlaca
		piezas := p.piezas
		if piezas == nil {
			piezas = []PiezaColocada{}
		}
		cortes := p.cortes
		if cortes == nil {
			cortes = []LineaDeCorte{}
		}
		placas[i] = PlacaDelPlano{
			Numero: i + 1, Piezas: piezas, Cortes: cortes, Recortes: aprovechables(p.libres),
			Aprovechado: aprovechado, SeVendeEntera: aprovechado > UmbralPlacaEntera,
		}
	}

	var recorteMayor *Recorte
	for _, p := range placas {
		for _, r := range p.Recortes {
			if recorteMayor == nil || r.Ancho*r.Alto > recorteMayor.Ancho*recorteMayor.Alto {
				rr := r
				recorteMayor = &rr
			}
		}
	}

	out := Plano{
		PlacaLargo: placaLargo, PlacaAncho: placaAncho, AnchoSierra: sierra,
		Placas: placas, NoEntran: noEntran, TotalPiezas: len(unidades),
		RecorteMayor: recorteMayor, FijadasDescartadas: descartadas,
	}
	if len(placas) > 0 {
		out.AprovechadoTotal = superficieUtil / float64(superficiePlaca*float64(len(placas)))
	}
	for _, p := range placas {
		out.Pasadas += len(p.Cortes)
		if p.SeVendeEntera {
			out.PlacasEnteras++
		} else {
			out.PasadasCobrables += len(p.Cortes)
		}
	}
	return out
}

func superficieDe(piezas []PiezaColocada) float64 {
	t := 0.0
	for _, x := range piezas {
		t = t + float64(x.Ancho*x.Alto)
	}
	return t
}

// aprovechables son los sobrantes que dan para guardar, del más grande al más
// chico (orden estable, como Array.sort).
func aprovechables(libres []libre) []Recorte {
	out := []Recorte{}
	for _, l := range libres {
		if l.ancho >= MinimoAprovechable && l.alto >= MinimoAprovechable {
			out = append(out, Recorte{l.x, l.y, l.ancho, l.alto})
		}
	}
	slices.SortStableFunc(out, func(a, b Recorte) int { return cmp.Compare(b.Ancho*b.Alto, a.Ancho*a.Alto) })
	return out
}

func referencia(u *unidad) orientacion { return u.posibles[0] }

// esMejor: menos placas gana; a igual cantidad, el retal más grande.
func esMejor(candidato, actual []*placaEnCurso) bool {
	if len(candidato) != len(actual) {
		return len(candidato) < len(actual)
	}
	return retalMayor(candidato) > retalMayor(actual)
}

func retalMayor(placas []*placaEnCurso) float64 {
	t := 0.0
	for _, p := range placas {
		for _, l := range p.libres {
			if l.ancho >= MinimoAprovechable && l.alto >= MinimoAprovechable {
				t = math.Max(t, l.ancho*l.alto)
			}
		}
	}
	return t
}

// ordenarPor ordena de mayor a menor según el criterio, con un ruido
// opcional. El ruido se pide una vez por unidad, en orden, como el .map del
// TS: eso es lo que consume el azar en el mismo orden.
func ordenarPor(unidades []*unidad, c criterio, ruido func() float64) []*unidad {
	type conClave struct {
		u     *unidad
		clave float64
	}
	xs := make([]conClave, len(unidades))
	for i, u := range unidades {
		xs[i] = conClave{u, c(referencia(u)) * (1 + ruido())}
	}
	slices.SortStableFunc(xs, func(a, b conClave) int {
		if d := cmp.Compare(b.clave, a.clave); d != 0 {
			return d
		}
		return cmp.Compare(referencia(b.u).ancho, referencia(a.u).ancho)
	})
	out := make([]*unidad, len(xs))
	for i, x := range xs {
		out[i] = x.u
	}
	return out
}

// AzarConSemilla es mulberry32, idéntico al de JS bit a bit.
func AzarConSemilla(semilla uint32) func() float64 {
	a := semilla
	return func() float64 {
		a += 0x6d2b79f5
		t := a
		t = (t ^ (t >> 15)) * (t | 1)
		t ^= t + (t^(t>>7))*(t|61)
		return float64(t^(t>>14)) / 4294967296
	}
}

func buscarMejorPlano(
	inicial intento,
	sueltas []*unidad,
	probar func([]*unidad, reglaDePartir, func() reglaDePartir) intento,
	semilla uint32,
	presupuesto float64,
) intento {
	costo := float64(len(sueltas) * max(1, len(inicial.placas)))
	rondas := int(math.Min(rondasMaximas, math.Max(rondasMinimas, math.Floor(presupuesto/costo))))

	azar := AzarConSemilla(semilla)
	mejor, guia := inicial, inicial

	for r := 0; r < rondas; r++ {
		var orden []*unidad
		if azar() < 0.5 {
			c := criterios[int(math.Floor(azar()*float64(len(criterios))))]
			amplitud := 0.05 + float64(azar()*0.35)
			orden = ordenarPor(sueltas, c, func() float64 {
				return float64(amplitud * (float64(azar()*2) - 1))
			})
		} else {
			orden = slices.Clone(guia.orden)
			movimientos := 1 + int(math.Floor(azar()*3))
			for m := 0; m < movimientos; m++ {
				desde := int(math.Floor(azar() * float64(len(orden))))
				hasta := int(math.Floor(azar() * float64(len(orden))))
				pieza := orden[desde]
				orden = slices.Delete(orden, desde, desde+1)
				if hasta > len(orden) {
					hasta = len(orden)
				}
				orden = slices.Insert(orden, hasta, pieza)
			}
		}

		preferencia := azar()
		sembrarCon := largo
		if azar() < 0.5 {
			sembrarCon = corto
		}
		it := probar(orden, sembrarCon, func() reglaDePartir {
			if azar() < preferencia {
				return corto
			}
			return largo
		})

		if esMejor(it.placas, mejor.placas) {
			mejor = it
		}
		if guiaMejorOIgual(it.placas, guia.placas) {
			guia = it
		}
	}
	return mejor
}

func guiaMejorOIgual(candidato, actual []*placaEnCurso) bool {
	if len(candidato) != len(actual) {
		return len(candidato) < len(actual)
	}
	menosUsada := func(placas []*placaEnCurso) float64 {
		m := math.Inf(1)
		for _, p := range placas {
			m = math.Min(m, superficieDe(p.piezas))
		}
		return m
	}
	return menosUsada(candidato) <= menosUsada(actual)
}

func nuevaPlaca(placaLargo, placaAncho float64) *placaEnCurso {
	return &placaEnCurso{libres: []libre{{0, 0, placaLargo, placaAncho}}}
}

func acomodar(unidades []*unidad, placaLargo, placaAncho, sierra float64, regla func() reglaDePartir, sembradas []*placaEnCurso) []*placaEnCurso {
	placas := sembradas
	for _, u := range unidades {
		partir := regla()
		ubicada := false
		for _, p := range placas {
			if ubicar(p, u.posibles, u, sierra, partir) {
				ubicada = true
				break
			}
		}
		if !ubicada {
			p := nuevaPlaca(placaLargo, placaAncho)
			placas = append(placas, p)
			ubicar(p, u.posibles, u, sierra, partir)
		}
	}
	return placas
}

func orientacionesPosibles(p *PiezaAcortar, placaLargo, placaAncho float64) []orientacion {
	derecha := orientacion{p.LargoMm, p.AnchoMm, false}
	girada := orientacion{p.AnchoMm, p.LargoMm, true}
	entra := func(o orientacion) bool {
		return o.ancho > 0 && o.alto > 0 && o.ancho <= placaLargo && o.alto <= placaAncho
	}
	if p.RespetaVeta == 1 || p.LargoMm == p.AnchoMm {
		if entra(derecha) {
			return []orientacion{derecha}
		}
		return nil
	}
	var out []orientacion
	for _, o := range []orientacion{derecha, girada} {
		if entra(o) {
			out = append(out, o)
		}
	}
	slices.SortStableFunc(out, func(a, b orientacion) int { return cmp.Compare(a.alto, b.alto) })
	return out
}

func ubicar(p *placaEnCurso, posibles []orientacion, u *unidad, sierra float64, partir reglaDePartir) bool {
	elegido := -1
	var o orientacion
	mejorAjuste := math.Inf(1)
	for i, l := range p.libres {
		for _, or := range posibles {
			if or.ancho > l.ancho || or.alto > l.alto {
				continue
			}
			ajuste := math.Min(l.ancho-or.ancho, l.alto-or.alto)
			if ajuste < mejorAjuste {
				mejorAjuste = ajuste
				elegido = i
				o = or
			}
		}
	}
	if elegido < 0 {
		return false
	}
	l := p.libres[elegido]
	p.piezas = append(p.piezas, PiezaColocada{
		X: l.x, Y: l.y, Ancho: o.ancho, Alto: o.alto, Indice: u.indice, Unidad: u.unidad,
		Etiqueta: u.pieza.Etiqueta, Girada: o.girada, LargoOriginal: u.pieza.LargoMm, AnchoOriginal: u.pieza.AnchoMm,
	})
	p.libres = slices.Delete(p.libres, elegido, elegido+1)
	partirLibre(p, l, o, sierra, partir)
	return true
}

func partirLibre(p *placaEnCurso, l libre, o orientacion, sierra float64, partir reglaDePartir) {
	sobraDerecha := l.ancho - o.ancho - sierra
	sobraAbajo := l.alto - o.alto - sierra
	horizontalPrimero := sobraAbajo > sobraDerecha
	if partir == corto {
		horizontalPrimero = sobraAbajo <= sobraDerecha
	}
	xCorte := l.x + o.ancho + sierra/2
	yCorte := l.y + o.alto + sierra/2

	if horizontalPrimero {
		if sobraAbajo > 0 {
			p.cortes = append(p.cortes, LineaDeCorte{"horizontal", l.x, yCorte, l.x + l.ancho, yCorte})
		}
		if sobraDerecha > 0 {
			p.cortes = append(p.cortes, LineaDeCorte{"vertical", xCorte, l.y, xCorte, l.y + o.alto})
		}
		if sobraAbajo > 0 {
			p.libres = append(p.libres, libre{l.x, l.y + o.alto + sierra, l.ancho, sobraAbajo})
		}
		if sobraDerecha > 0 {
			p.libres = append(p.libres, libre{l.x + o.ancho + sierra, l.y, sobraDerecha, o.alto})
		}
		return
	}
	if sobraDerecha > 0 {
		p.cortes = append(p.cortes, LineaDeCorte{"vertical", xCorte, l.y, xCorte, l.y + l.alto})
	}
	if sobraAbajo > 0 {
		p.cortes = append(p.cortes, LineaDeCorte{"horizontal", l.x, yCorte, l.x + o.ancho, yCorte})
	}
	if sobraDerecha > 0 {
		p.libres = append(p.libres, libre{l.x + o.ancho + sierra, l.y, sobraDerecha, l.alto})
	}
	if sobraAbajo > 0 {
		p.libres = append(p.libres, libre{l.x, l.y + o.alto + sierra, o.ancho, sobraAbajo})
	}
}

func sembrarFijadas(
	aFijar []*unidad,
	fijadaDe func(*unidad) PiezaFijada,
	placaLargo, placaAncho, sierra float64,
	partir reglaDePartir,
) (placas []*placaEnCurso, descartadas []PiezaFijada, devueltas []*unidad) {
	ordenadas := slices.Clone(aFijar)
	slices.SortStableFunc(ordenadas, func(a, b *unidad) int {
		if d := cmp.Compare(fijadaDe(a).Placa, fijadaDe(b).Placa); d != 0 {
			return d
		}
		ra, rb := referencia(a), referencia(b)
		return cmp.Compare(rb.ancho*rb.alto, ra.ancho*ra.alto)
	})

	for _, u := range ordenadas {
		f := fijadaDe(u)
		for len(placas) < f.Placa {
			placas = append(placas, nuevaPlaca(placaLargo, placaAncho))
		}
		p := placas[f.Placa-1]
		posibles := u.posibles
		if f.Girada != nil {
			posibles = nil
			for _, o := range u.posibles {
				if o.girada == *f.Girada {
					posibles = append(posibles, o)
				}
			}
		}
		if len(posibles) == 0 {
			descartadas = append(descartadas, f)
			devueltas = append(devueltas, u)
			continue
		}
		if !ubicar(p, posibles, u, sierra, partir) {
			descartadas = append(descartadas, f)
			devueltas = append(devueltas, u)
		}
	}
	return placas, descartadas, devueltas
}
