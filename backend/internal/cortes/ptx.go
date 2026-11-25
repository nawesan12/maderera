package cortes

// El programa de corte en PTX (lib/cortes/ptx.ts), experimental: no se sabe
// todavía si el WinCut del taller lo lee (docs/PTX.md). Sale del mismo árbol
// que la hoja de corte. ASCII puro, CRLF, sin comillas y nombre 8.3.

import (
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"golang.org/x/text/unicode/norm"

	"mjbj/internal/jsmath"
)

// VersionPtx es la versión que se declara en HEADER (la que piden las SCM).
const VersionPtx = "1.14"

// PiezaPtx es un renglón del despiece, en el orden del plano.
type PiezaPtx struct {
	LargoMm     float64
	AnchoMm     float64
	Cantidad    float64
	RespetaVeta float64
	Etiqueta    *string
}

// TrabajoParaPtx es lo que hace falta del trabajo, además de la hoja.
type TrabajoParaPtx struct {
	Numero    string
	Cliente   string
	Material  string
	CreatedAt time.Time
	Piezas    []PiezaPtx
}

type registroDeCorte struct {
	funcion, repeticiones, pieza, cantidadPiezas, orden int
	dimension                                           float64
}

var reEspacios = regexp.MustCompile(` +`)

// TextoPtx pasa un texto a ASCII imprimible, sin comas ni comillas.
func TextoPtx(texto string, largoMaximo int) string {
	var b strings.Builder
	for _, r := range norm.NFD.String(texto) {
		switch {
		case r >= 0x300 && r <= 0x36f:
			continue
		case r == '×':
			b.WriteByte('x')
		case r == ',':
			b.WriteByte('.')
		case r == '"':
			continue
		case r >= 0x20 && r <= 0x7e:
			b.WriteRune(r)
		}
	}
	// Después de sacar lo que no es ASCII imprimible, el único blanco que
	// queda es el espacio: \s+ de JS es esto.
	s := strings.Trim(reEspacios.ReplaceAllString(b.String(), " "), " ")
	if len(s) > largoMaximo {
		s = s[:largoMaximo]
	}
	return s
}

func codigoPtx(texto string, largoMaximo int) string {
	return strings.ToUpper(strings.ReplaceAll(TextoPtx(texto, largoMaximo), " ", "_"))
}

// dim es una medida con un decimal y punto. Nunca «-0.0».
func dim(n float64) string {
	r := jsmath.Round(float64(n*10)) / 10
	if r == 0 {
		r = 0
	}
	return jsmath.ToFixed(r, 1)
}

var reNoDigito = regexp.MustCompile(`\D`)

func numeroDeTrabajo(numero string) string {
	if d := reNoDigito.ReplaceAllString(numero, ""); d != "" {
		return d
	}
	return "1"
}

var rePrefijo = regexp.MustCompile(`^[A-Za-z]+`)

// NombreDeArchivoPtx: «CRT-460» → «CRT460.PTX».
func NombreDeArchivoPtx(numero string) string {
	digitos := numeroDeTrabajo(numero)
	prefijo := rePrefijo.FindString(numero)
	if prefijo == "" {
		prefijo = "C"
	}
	prefijo = strings.ToUpper(prefijo)
	if len(prefijo) > 3 {
		prefijo = prefijo[:3]
	}
	k := 8 - len(prefijo)
	if len(digitos) > k {
		digitos = digitos[len(digitos)-k:]
	}
	return prefijo + digitos + ".PTX"
}

// El \s de JS: más que el de RE2.
var reEspesor = regexp.MustCompile(`(?i)([0-9]+(?:[.,][0-9]+)?)[\t\n\v\f\r \x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}]*mm`)

// EspesorDelMaterial: «Melamina 18mm blanca» → 18.
func EspesorDelMaterial(material string) (float64, bool) {
	m := reEspesor.FindStringSubmatch(material)
	if m == nil {
		return 0, false
	}
	n := jsmath.Numero(strings.Replace(m[1], ",", ".", 1))
	if n > 0 && n < 100 {
		return n, true
	}
	return 0, false
}

const espesorPorOmision = 18

// zonaArgentina es la hora del negocio: la fecha del trabajo es la de acá.
var zonaArgentina = func() *time.Location {
	l, err := time.LoadLocation("America/Argentina/Buenos_Aires")
	if err != nil {
		return time.FixedZone("ART", -3*3600)
	}
	return l
}()

func fechaPtx(d time.Time) string {
	return d.In(zonaArgentina).Format("02/01/2006")
}

func unir(campos ...any) string {
	partes := make([]string, len(campos))
	for i, c := range campos {
		switch v := c.(type) {
		case string:
			partes[i] = v
		case int:
			partes[i] = strconv.Itoa(v)
		case float64:
			partes[i] = jsmath.Texto(v)
		}
	}
	return strings.Join(partes, ",")
}

// ArmarPtx arma el archivo PTX de un trabajo (armarPtx).
func ArmarPtx(trabajo TrabajoParaPtx, hoja HojaDeCorte) string {
	var lineas []string
	grano := 0
	for _, p := range trabajo.Piezas {
		if p.RespetaVeta == 1 {
			grano = 1
			break
		}
	}
	espesor, ok := EspesorDelMaterial(trabajo.Material)
	if !ok {
		espesor = espesorPorOmision
	}
	job := numeroDeTrabajo(trabajo.Numero)

	producidas := map[int]int{}
	type patronPtx struct {
		corrida      int
		registros    []registroDeCorte
		nivelInicial int
	}
	patrones := make([]patronPtx, len(hoja.Patrones))
	profundidad := 1
	for i, patron := range hoja.Patrones {
		corrida := len(patron.Placas)
		registros := registrosDe(patron.Arbol, corrida, hoja.AnchoSierra)
		for _, r := range registros {
			if r.pieza > 0 {
				producidas[r.pieza] += r.cantidadPiezas
			}
			f := r.funcion
			if f >= 90 {
				f -= 90
			}
			profundidad = max(profundidad, f)
		}
		nivel := 1
		if patron.Arbol.Tipo == "partido" {
			nivel = patron.Arbol.Nivel
		}
		patrones[i] = patronPtx{corrida, registros, nivel}
	}

	lineas = append(lineas, unir("HEADER", VersionPtx, TextoPtx("MJBJ "+trabajo.Numero, 25), 0, 0, 1))

	placasTotales := 0
	for _, p := range hoja.Patrones {
		placasTotales += len(p.Placas)
	}
	superficiePiezas := 0.0
	for i, p := range trabajo.Piezas {
		superficiePiezas = superficiePiezas + float64(float64(p.LargoMm*p.AnchoMm)*float64(producidas[i+1]))
	}
	superficiePlacas := float64(float64(placasTotales)*hoja.PlacaLargo) * hoja.PlacaAncho
	desperdicio := 0.0
	if superficiePlacas > 0 {
		desperdicio = ((superficiePlacas - superficiePiezas) / superficiePlacas) * 100
	}
	lineas = append(lineas, unir("JOBS", 1, job, TextoPtx(trabajo.Numero+" "+trabajo.Material, 50),
		fechaPtx(trabajo.CreatedAt), "", TextoPtx(trabajo.Cliente, 100), 1, "", "", 0, jsmath.ToFixed(desperdicio, 2)))

	for i, p := range trabajo.Piezas {
		renglon := i + 1
		codigo := "P" + strconv.Itoa(renglon)
		if p.Etiqueta != nil && *p.Etiqueta != "" {
			codigo += " " + *p.Etiqueta
		}
		veta := 0
		if p.RespetaVeta == 1 {
			veta = 1
		}
		prod := producidas[renglon]
		lineas = append(lineas, unir("PARTS_REQ", 1, renglon, codigoPtx(codigo, 50), 1, dim(p.LargoMm), dim(p.AnchoMm),
			p.Cantidad, 0, 0, veta, prod, max(0, p.Cantidad-float64(prod)), 0, 0))
	}

	codigoMaterial := codigoPtx(trabajo.Material, 50)
	if codigoMaterial == "" {
		codigoMaterial = "MATERIAL"
	}
	cm40 := codigoMaterial
	if len(cm40) > 40 {
		cm40 = cm40[:40]
	}
	lineas = append(lineas, unir("BOARDS", 1, 1, codigoPtx(cm40+"/01", 50), 1, dim(hoja.PlacaLargo), dim(hoja.PlacaAncho),
		max(placasTotales, 1), placasTotales, "0.000", 0, "", "", grano, 0, "", ""))

	rule3 := 0
	for _, p := range patrones {
		if p.nivelInicial == 2 {
			rule3 = 1
			break
		}
	}
	lineas = append(lineas, unir("MATERIALS", 1, 1, codigoMaterial, TextoPtx(trabajo.Material, 50), dim(espesor), 1,
		dim(hoja.AnchoSierra), dim(hoja.AnchoSierra), "0.0", "0.0", "0.0", "0.0", "0.0", "0.0", "0.0",
		min(9, profundidad), 0, rule3, 0, "", grano, "", ""))

	for i, p := range patrones {
		ptn := i + 1
		tipo := 0
		if p.nivelInicial == 2 {
			tipo = 1
		}
		lineas = append(lineas, unir("PATTERNS", 1, ptn, 1, tipo, p.corrida, p.corrida, 1, "", 0, 0))
		secuencias := secuenciaDeCorte(p.registros)
		for k, r := range p.registros {
			lineas = append(lineas, unir("CUTS", 1, ptn, k+1, secuencias[k], r.funcion, dim(r.dimension), r.repeticiones, r.pieza, r.cantidadPiezas))
		}
	}

	var b strings.Builder
	for _, l := range lineas {
		b.WriteString(l)
		b.WriteString("\r\n")
	}
	return b.String()
}

func medidaEn(t *Trozo, eje string) float64 {
	if eje == "y" {
		return t.Rect.Alto
	}
	return t.Rect.Ancho
}

func otroEje(eje string) string {
	if eje == "y" {
		return "x"
	}
	return "y"
}

func registrosDe(arbol *Trozo, corrida int, sierra float64) []registroDeCorte {
	var registros []registroDeCorte
	if arbol.Tipo == "sobrante" {
		return registros
	}
	if arbol.Tipo == "pieza" {
		return append(registros, registroDeCorte{funcion: 1, dimension: arbol.Rect.Alto, pieza: arbol.Pieza.Indice + 1, cantidadPiezas: corrida, orden: 1})
	}

	desplazamiento := arbol.Nivel - 1
	funcionDe := func(nivel int) int { return nivel - desplazamiento }

	var recorrer func(trozo *Trozo, nivelPadre int)
	recorrer = func(trozo *Trozo, nivelPadre int) {
		for nivel := nivelPadre + 1; nivel < trozo.Nivel; nivel++ {
			registros = append(registros, registroDeCorte{funcion: funcionDe(nivel), dimension: medidaEn(trozo, ejeDelNivel(nivel)), orden: funcionDe(nivel)})
		}
		f := funcionDe(trozo.Nivel)
		hijos := trozo.Hijos
		esUltimo := func(k int) bool { return k == len(hijos)-1 }

		i := 0
		for i < len(hijos) {
			hijo := hijos[i]
			medida := medidaEn(hijo, trozo.Eje)
			if hijo.Tipo == "pieza" {
				otro := otroEje(trozo.Eje)
				j := i
				for j < len(hijos) && hijos[j].Tipo == "pieza" && hijos[j].Pieza.Indice == hijo.Pieza.Indice &&
					abs(medidaEn(hijos[j], trozo.Eje)-medida) < 0.001 &&
					abs(medidaEn(hijos[j], otro)-medidaEn(hijo, otro)) < 0.001 {
					j++
				}
				cuantas := j - i
				ultimaSinCorte := esUltimo(j-1) && trozo.UltimaSinCorte
				if ultimaSinCorte {
					cuantas--
				}
				if cuantas > 0 {
					registros = append(registros, registroDeCorte{funcion: f, dimension: medida, repeticiones: cuantas, pieza: hijo.Pieza.Indice + 1, cantidadPiezas: cuantas * corrida, orden: f})
				}
				if ultimaSinCorte {
					registros = append(registros, registroDeCorte{funcion: f, dimension: medida, pieza: hijo.Pieza.Indice + 1, cantidadPiezas: corrida, orden: f})
				}
				i = j
				continue
			}
			if hijo.Tipo == "partido" {
				rep := 1
				if esUltimo(i) && trozo.UltimaSinCorte {
					rep = 0
				}
				registros = append(registros, registroDeCorte{funcion: f, dimension: medida, repeticiones: rep, orden: f})
				recorrer(hijo, trozo.Nivel)
			}
			i++
		}

		if !trozo.UltimaSinCorte {
			total := medidaEn(trozo, trozo.Eje)
			usado := 0.0
			for _, h := range hijos {
				usado = usado + medidaEn(h, trozo.Eje)
			}
			usado = usado + float64(float64(len(hijos))*sierra)
			registros = append(registros, registroDeCorte{funcion: 90 + f, dimension: jsmath.Round(float64((total-usado)*1000)) / 1000, orden: f})
		}
	}
	recorrer(arbol, arbol.Nivel-1)
	return registros
}

func abs(x float64) float64 {
	if x < 0 {
		return -x
	}
	return x
}

func secuenciaDeCorte(registros []registroDeCorte) []int {
	type conIndice struct {
		r registroDeCorte
		i int
	}
	var orden []conIndice
	for i, r := range registros {
		if r.repeticiones > 0 {
			orden = append(orden, conIndice{r, i})
		}
	}
	slices.SortStableFunc(orden, func(a, b conIndice) int {
		if a.r.orden != b.r.orden {
			return a.r.orden - b.r.orden
		}
		return a.i - b.i
	})
	resultado := make([]int, len(registros))
	siguiente := 1
	for _, o := range orden {
		resultado[o.i] = siguiente
		siguiente += o.r.repeticiones
	}
	return resultado
}
