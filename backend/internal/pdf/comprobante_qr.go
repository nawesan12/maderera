package pdf

import (
	"encoding/base64"
	"math"
	"regexp"
	"sort"
	"strconv"
	"time"

	"mjbj/internal/jsmath"
)

// El QR de la factura electrónica (lib/fiscal/qr.ts, urlQr y qrPng).
//
// El TS lo arma con el paquete `qrcode` 1.5.4 de npm. Para que el PDF salga
// igual píxel a píxel hace falta la misma matriz, y la matriz depende de
// decisiones del codificador que la norma deja libres: cómo parte el texto en
// segmentos (numérico, alfanumérico, byte: qrcode busca el camino más corto
// con Dijkstra), qué versión elige y qué máscara gana por penalidad. Por eso
// es un port literal de node_modules/qrcode/lib/core —con sus rarezas, como
// el `lastCount` que se pisa mientras se arma el grafo— y no una librería de
// Go: otra librería daría un QR igual de válido pero distinto.
//
// El golden de la matriz (comprobante_qr_test.go) compara contra
// qrcode.create() con URLs al azar.

// DatosQr es lo que recibe urlQr.
type DatosQr struct {
	Fecha        time.Time
	CuitEmisor   string
	PuntoVenta   float64
	Tipo         string
	Numero       float64
	Total        float64
	ReceptorCuit string
	Cae          string
}

// codigoComprobante es CODIGO_COMPROBANTE de lib/fiscal/comprobantes.ts.
var codigoComprobante = map[string]float64{
	"factura_a": 1, "nota_debito_a": 2, "nota_credito_a": 3,
	"factura_b": 6, "nota_debito_b": 7, "nota_credito_b": 8,
	"factura_c": 11, "nota_debito_c": 12, "nota_credito_c": 13,
}

func soloDigitos(s string) string {
	b := make([]byte, 0, len(s))
	for i := 0; i < len(s); i++ {
		if s[i] >= '0' && s[i] <= '9' {
			b = append(b, s[i])
		}
	}
	return string(b)
}

// documentoReceptor es documentoReceptor de lib/fiscal/comprobantes.ts.
func documentoReceptor(cuit string) (tipo, numero float64) {
	limpio := soloDigitos(cuit)
	switch len(limpio) {
	case 11:
		return 80, jsmath.Numero(limpio)
	case 7, 8:
		return 96, jsmath.Numero(limpio)
	}
	return 99, 0
}

// numeroJSON es JSON.stringify de un número: String(n), y null si no es finito.
func numeroJSON(n float64) string {
	if math.IsNaN(n) || math.IsInf(n, 0) {
		return "null"
	}
	return jsmath.Texto(n)
}

// UrlQr es urlQr: el enlace de verificación de ARCA con los datos en base64.
func UrlQr(d DatosQr) string {
	tipoDoc, nroDoc := documentoReceptor(d.ReceptorCuit)
	tipoCmp, ok := codigoComprobante[d.Tipo]
	tipoCmpJSON := "null" // un tipo desconocido es undefined: JSON.stringify saca la clave
	if ok {
		tipoCmpJSON = numeroJSON(tipoCmp)
	}
	j := `{"ver":1,"fecha":"` + d.Fecha.UTC().Format("2006-01-02") + `"` +
		`,"cuit":` + numeroJSON(jsmath.Numero(soloDigitos(d.CuitEmisor))) +
		`,"ptoVta":` + numeroJSON(d.PuntoVenta)
	if ok {
		j += `,"tipoCmp":` + tipoCmpJSON
	}
	j += `,"nroCmp":` + numeroJSON(d.Numero) +
		`,"importe":` + numeroJSON(jsmath.Numero(jsmath.ToFixed(d.Total, 2))) +
		`,"moneda":"PES","ctz":1` +
		`,"tipoDocRec":` + numeroJSON(tipoDoc) +
		`,"nroDocRec":` + numeroJSON(nroDoc) +
		`,"tipoCodAut":"E"` +
		`,"codAut":` + numeroJSON(jsmath.Numero(d.Cae)) + `}`
	return "https://www.afip.gob.ar/fe/qr/?p=" + base64.StdEncoding.EncodeToString([]byte(j))
}

// qrPngCrudo es qrPng: el QR a 320 px de ancho, sin margen, negro sobre
// blanco y nivel de corrección M, ya como imagen lista para incrustar
// (qrcode lo escribe en RGBA con alfa 255, así que pdf-lib no le pone
// máscara).
func qrPngCrudo(texto string) (*imagenCruda, error) {
	m, err := qrCrear(texto)
	if err != nil {
		return nil, err
	}
	const ancho = 320.0
	size := m.size
	escala := ancho / float64(size) // width ≥ size + 2·0: getScale
	lado := int(math.Floor(float64(size) * escala))
	rgb := make([]byte, 0, lado*lado*3)
	for i := 0; i < lado; i++ {
		for j := 0; j < lado; j++ {
			var c byte = 255
			if i < lado && j < lado {
				iSrc := int(math.Floor(float64(i) / escala))
				jSrc := int(math.Floor(float64(j) / escala))
				if m.data[iSrc*size+jSrc] != 0 {
					c = 0
				}
			}
			rgb = append(rgb, c, c, c)
		}
	}
	return &imagenCruda{ancho: lado, alto: lado, rgb: comprimir(rgb)}, nil
}

/* -------------------------------------------------------------------------- */
/* El codificador (qrcode/lib/core)                                           */
/* -------------------------------------------------------------------------- */

type qrModo struct {
	bit    int
	ccBits [3]int
}

var (
	qrNumerico     = &qrModo{bit: 1, ccBits: [3]int{10, 12, 14}}
	qrAlfanumerico = &qrModo{bit: 2, ccBits: [3]int{9, 11, 13}}
	qrByte         = &qrModo{bit: 4, ccBits: [3]int{8, 16, 16}}
)

func qrIndicador(m *qrModo, version int) int {
	switch {
	case version >= 1 && version < 10:
		return m.ccBits[0]
	case version < 27:
		return m.ccBits[1]
	}
	return m.ccBits[2]
}

func qrBitsDe(largo int, m *qrModo) int {
	switch m {
	case qrNumerico:
		r := 0
		if largo%3 != 0 {
			r = (largo%3)*3 + 1
		}
		return 10*(largo/3) + r
	case qrAlfanumerico:
		return 11*(largo/2) + 6*(largo%2)
	}
	return largo * 8
}

type qrSegmento struct {
	datos string
	modo  *qrModo
	largo int
}

// largo y escritura de cada segmento, como NumericData/AlphanumericData/ByteData.
func (s qrSegmento) cantidad() int {
	if s.modo == qrByte {
		return len(s.datos) // UTF-8: TextEncoder
	}
	return len([]rune(s.datos))
}

func (s qrSegmento) bits() int { return qrBitsDe(s.cantidad(), s.modo) }

const qrAlfaCars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:"

func (s qrSegmento) escribir(b *qrBits) {
	switch s.modo {
	case qrNumerico:
		d := s.datos
		i := 0
		for ; i+3 <= len(d); i += 3 {
			v, _ := strconv.Atoi(d[i : i+3])
			b.poner(v, 10)
		}
		if resto := len(d) - i; resto > 0 {
			v, _ := strconv.Atoi(d[i:])
			b.poner(v, resto*3+1)
		}
	case qrAlfanumerico:
		d := s.datos
		indice := func(c byte) int {
			for k := 0; k < len(qrAlfaCars); k++ {
				if qrAlfaCars[k] == c {
					return k
				}
			}
			return -1
		}
		i := 0
		for ; i+2 <= len(d); i += 2 {
			b.poner(indice(d[i])*45+indice(d[i+1]), 11)
		}
		if len(d)%2 != 0 {
			b.poner(indice(d[i]), 6)
		}
	default:
		for _, c := range []byte(s.datos) {
			b.poner(int(c), 8)
		}
	}
}

type qrBits struct {
	buf   []byte
	largo int
}

func (b *qrBits) ponerBit(bit bool) {
	i := b.largo / 8
	if len(b.buf) <= i {
		b.buf = append(b.buf, 0)
	}
	if bit {
		b.buf[i] |= 0x80 >> (b.largo % 8)
	}
	b.largo++
}

func (b *qrBits) poner(num, largo int) {
	for i := 0; i < largo; i++ {
		b.ponerBit((uint32(num)>>(largo-i-1))&1 == 1)
	}
}

var (
	reNumerico     = regexp.MustCompile(`[0-9]+`)
	reAlfanumerico = regexp.MustCompile(`[A-Z $%*+\-./:]+`)
	reByte         = regexp.MustCompile(`[^A-Z0-9 $%*+\-./:]+`)
)

// qrPartir es getSegmentsFromString sin kanji (no hay toSJISFunc).
func qrPartir(s string) []qrSegmento {
	type conIndice struct {
		qrSegmento
		i int
	}
	var todos []conIndice
	for _, par := range []struct {
		re   *regexp.Regexp
		modo *qrModo
	}{{reNumerico, qrNumerico}, {reAlfanumerico, qrAlfanumerico}, {reByte, qrByte}} {
		for _, loc := range par.re.FindAllStringIndex(s, -1) {
			d := s[loc[0]:loc[1]]
			todos = append(todos, conIndice{qrSegmento{d, par.modo, utf16Largo(d)}, loc[0]})
		}
	}
	sort.SliceStable(todos, func(a, b int) bool { return todos[a].i < todos[b].i })
	out := make([]qrSegmento, len(todos))
	for i, t := range todos {
		out[i] = t.qrSegmento
	}
	return out
}

func utf16Largo(s string) int { return largoJS(s) }

var qrCodewords = [41]int{0,
	26, 44, 70, 100, 134, 172, 196, 242, 292, 346,
	404, 466, 532, 581, 655, 733, 815, 901, 991, 1085,
	1156, 1258, 1364, 1474, 1588, 1706, 1828, 1921, 2051, 2185,
	2323, 2465, 2611, 2761, 2876, 3034, 3196, 3362, 3532, 3706}

// Bloques y codewords de corrección para el nivel M (la columna 1 de las
// tablas de error-correction-code.js).
var qrBloquesM = [40]int{1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49}
var qrCorreccionM = [40]int{10, 16, 26, 36, 48, 64, 72, 88, 110, 130, 150, 176, 198, 216, 240, 280, 308, 338, 364, 416, 442, 476, 504, 560, 588, 644, 700, 728, 784, 812, 868, 924, 980, 1036, 1064, 1120, 1204, 1260, 1316, 1372}

const qrNivelM = 0 // ECLevel.M.bit

func qrCapacidadBits(version int) int {
	return (qrCodewords[version] - qrCorreccionM[version-1]) * 8
}

func qrCapacidad(version int, m *qrModo) int {
	util := float64(qrCapacidadBits(version) - (qrIndicador(m, version) + 4))
	switch m {
	case qrNumerico:
		return int(math.Floor((util / 10) * 3))
	case qrAlfanumerico:
		return int(math.Floor((util / 11) * 2))
	}
	return int(math.Floor(util / 8))
}

// qrMejorVersion es getBestVersionForData; 0 si no entra.
func qrMejorVersion(segs []qrSegmento) int {
	if len(segs) == 0 {
		return 1
	}
	if len(segs) == 1 {
		for v := 1; v <= 40; v++ {
			if segs[0].cantidad() <= qrCapacidad(v, segs[0].modo) {
				return v
			}
		}
		return 0
	}
	for v := 1; v <= 40; v++ {
		total := 0
		for _, s := range segs {
			total += qrIndicador(s.modo, v) + 4 + s.bits()
		}
		if total <= qrCapacidadBits(v) {
			return v
		}
	}
	return 0
}

// qrOptimizar es Segments.fromString: el grafo de modos y Dijkstra, con la
// cola de prioridad ingenua de dijkstrajs (orden estable por costo).
func qrOptimizar(s string, version int) []qrSegmento {
	segs := qrPartir(s)
	var nodos [][]qrSegmento
	for _, seg := range segs {
		switch seg.modo {
		case qrNumerico:
			nodos = append(nodos, []qrSegmento{seg, {seg.datos, qrAlfanumerico, seg.largo}, {seg.datos, qrByte, seg.largo}})
		case qrAlfanumerico:
			nodos = append(nodos, []qrSegmento{seg, {seg.datos, qrByte, seg.largo}})
		default:
			nodos = append(nodos, []qrSegmento{{seg.datos, qrByte, len(seg.datos)}})
		}
	}

	type entrada struct {
		nodo     qrSegmento
		ultimo   int
		definido bool
	}
	type arista struct {
		a     string
		costo int
	}
	tabla := map[string]*entrada{}
	grafo := map[string][]arista{"start": nil}
	previos := []string{"start"}
	for i, grupo := range nodos {
		var actuales []string
		for j, nodo := range grupo {
			clave := strconv.Itoa(i) + strconv.Itoa(j)
			actuales = append(actuales, clave)
			tabla[clave] = &entrada{nodo: nodo, definido: true}
			grafo[clave] = nil
			for _, p := range previos {
				prev := tabla[p]
				if prev != nil && prev.nodo.modo == nodo.modo {
					costo := qrBitsDe(prev.ultimo+nodo.largo, nodo.modo) - qrBitsDe(prev.ultimo, nodo.modo)
					grafo[p] = append(grafo[p], arista{clave, costo})
					prev.ultimo += nodo.largo
				} else {
					if prev != nil {
						prev.ultimo = nodo.largo
					}
					grafo[p] = append(grafo[p], arista{clave, qrBitsDe(nodo.largo, nodo.modo) + 4 + qrIndicador(nodo.modo, version)})
				}
			}
		}
		previos = actuales
	}
	for _, p := range previos {
		grafo[p] = append(grafo[p], arista{"end", 0})
	}

	// dijkstrajs.single_source_shortest_paths
	type item struct {
		v     string
		costo int
	}
	costos := map[string]int{"start": 0}
	pred := map[string]string{}
	cola := []item{{"start", 0}}
	for len(cola) > 0 {
		u := cola[0]
		cola = cola[1:]
		for _, e := range grafo[u.v] {
			nuevo := u.costo + e.costo
			viejo, visto := costos[e.a]
			if !visto || viejo > nuevo {
				costos[e.a] = nuevo
				cola = append(cola, item{e.a, nuevo})
				sort.SliceStable(cola, func(a, b int) bool { return cola[a].costo < cola[b].costo })
				pred[e.a] = u.v
			}
		}
	}
	var camino []string
	for u := "end"; u != ""; u = pred[u] {
		camino = append(camino, u)
	}
	// camino va de end a start.
	var elegidos []qrSegmento
	for k := len(camino) - 2; k >= 1; k-- {
		elegidos = append(elegidos, tabla[camino[k]].nodo)
	}
	// mergeSegments
	var unidos []qrSegmento
	for _, s := range elegidos {
		if n := len(unidos); n > 0 && unidos[n-1].modo == s.modo {
			unidos[n-1].datos += s.datos
			continue
		}
		unidos = append(unidos, s)
	}
	return unidos
}

type qrMatriz struct {
	size      int
	data      []byte
	reservado []bool
}

func (m *qrMatriz) poner(f, c int, v bool, reservado bool) {
	i := f*m.size + c
	m.data[i] = 0
	if v {
		m.data[i] = 1
	}
	if reservado {
		m.reservado[i] = true
	}
}

func (m *qrMatriz) en(f, c int) byte { return m.data[f*m.size+c] }

var qrExp, qrLog = func() ([512]byte, [256]byte) {
	var e [512]byte
	var l [256]byte
	x := 1
	for i := 0; i < 255; i++ {
		e[i] = byte(x)
		l[x] = byte(i)
		x <<= 1
		if x&0x100 != 0 {
			x ^= 0x11d
		}
	}
	for i := 255; i < 512; i++ {
		e[i] = e[i-255]
	}
	return e, l
}()

func gfMul(x, y byte) byte {
	if x == 0 || y == 0 {
		return 0
	}
	return qrExp[int(qrLog[x])+int(qrLog[y])]
}

func polyMul(p1, p2 []byte) []byte {
	c := make([]byte, len(p1)+len(p2)-1)
	for i := range p1 {
		for j := range p2 {
			c[i+j] ^= gfMul(p1[i], p2[j])
		}
	}
	return c
}

func polyMod(dividendo, divisor []byte) []byte {
	r := append([]byte(nil), dividendo...)
	for len(r)-len(divisor) >= 0 {
		coef := r[0]
		for i := range divisor {
			r[i] ^= gfMul(divisor[i], coef)
		}
		off := 0
		for off < len(r) && r[off] == 0 {
			off++
		}
		r = r[off:]
	}
	return r
}

func rsCodificar(datos []byte, grado int) []byte {
	gen := []byte{1}
	for i := 0; i < grado; i++ {
		gen = polyMul(gen, []byte{1, qrExp[i]})
	}
	relleno := make([]byte, len(datos)+grado)
	copy(relleno, datos)
	resto := polyMod(relleno, gen)
	if inicio := grado - len(resto); inicio > 0 {
		b := make([]byte, grado)
		copy(b[inicio:], resto)
		return b
	}
	return resto
}

func bchDigito(d int) int {
	n := 0
	for d != 0 {
		n++
		d = int(uint32(d) >> 1)
	}
	return n
}

func qrFormato(mascara int) int {
	const g15 = 1<<10 | 1<<8 | 1<<5 | 1<<4 | 1<<2 | 1<<1 | 1<<0
	const g15Mascara = 1<<14 | 1<<12 | 1<<10 | 1<<4 | 1<<1
	datos := qrNivelM<<3 | mascara
	d := datos << 10
	for bchDigito(d)-bchDigito(g15) >= 0 {
		d ^= g15 << (bchDigito(d) - bchDigito(g15))
	}
	return (datos<<10 | d) ^ g15Mascara
}

func qrVersionBits(version int) int {
	const g18 = 1<<12 | 1<<11 | 1<<10 | 1<<9 | 1<<8 | 1<<5 | 1<<2 | 1<<0
	d := version << 12
	for bchDigito(d)-bchDigito(g18) >= 0 {
		d ^= g18 << (bchDigito(d) - bchDigito(g18))
	}
	return version<<12 | d
}

func qrPosicionesAlineacion(version int) [][2]int {
	if version == 1 {
		return nil
	}
	cant := version/7 + 2
	size := version*4 + 17
	intervalo := 26
	if size != 145 {
		intervalo = int(math.Ceil(float64(size-13)/float64(2*cant-2))) * 2
	}
	pos := make([]int, cant)
	pos[cant-1] = size - 7
	for i := 1; i < cant-1; i++ {
		pos[cant-1-i] = pos[cant-i] - intervalo
	}
	pos[0] = 6
	var out [][2]int
	for i := 0; i < cant; i++ {
		for j := 0; j < cant; j++ {
			if (i == 0 && j == 0) || (i == 0 && j == cant-1) || (i == cant-1 && j == 0) {
				continue
			}
			out = append(out, [2]int{pos[i], pos[j]})
		}
	}
	return out
}

func qrPonerFormato(m *qrMatriz, mascara int) {
	size := m.size
	bits := qrFormato(mascara)
	for i := 0; i < 15; i++ {
		mod := (bits>>i)&1 == 1
		switch {
		case i < 6:
			m.poner(i, 8, mod, true)
		case i < 8:
			m.poner(i+1, 8, mod, true)
		default:
			m.poner(size-15+i, 8, mod, true)
		}
		switch {
		case i < 8:
			m.poner(8, size-i-1, mod, true)
		case i < 9:
			m.poner(8, 15-i-1+1, mod, true)
		default:
			m.poner(8, 15-i-1, mod, true)
		}
	}
	m.poner(size-8, 8, true, true)
}

func qrMascaraEn(p, i, j int) bool {
	switch p {
	case 0:
		return (i+j)%2 == 0
	case 1:
		return i%2 == 0
	case 2:
		return j%3 == 0
	case 3:
		return (i+j)%3 == 0
	case 4:
		return (i/2+j/3)%2 == 0
	case 5:
		return (i*j)%2+(i*j)%3 == 0
	case 6:
		return ((i*j)%2+(i*j)%3)%2 == 0
	}
	return ((i*j)%3+(i+j)%2)%2 == 0
}

func qrAplicarMascara(p int, m *qrMatriz) {
	for c := 0; c < m.size; c++ {
		for f := 0; f < m.size; f++ {
			if m.reservado[f*m.size+c] {
				continue
			}
			if qrMascaraEn(p, f, c) {
				m.data[f*m.size+c] ^= 1
			}
		}
	}
}

func qrPenalidad(m *qrMatriz) int {
	size := m.size
	puntos := 0
	// N1
	for f := 0; f < size; f++ {
		cCol, cFila := 0, 0
		ultCol, ultFila := -1, -1
		for c := 0; c < size; c++ {
			v := int(m.en(f, c))
			if v == ultCol {
				cCol++
			} else {
				if cCol >= 5 {
					puntos += 3 + (cCol - 5)
				}
				ultCol, cCol = v, 1
			}
			v = int(m.en(c, f))
			if v == ultFila {
				cFila++
			} else {
				if cFila >= 5 {
					puntos += 3 + (cFila - 5)
				}
				ultFila, cFila = v, 1
			}
		}
		if cCol >= 5 {
			puntos += 3 + (cCol - 5)
		}
		if cFila >= 5 {
			puntos += 3 + (cFila - 5)
		}
	}
	// N2
	n2 := 0
	for f := 0; f < size-1; f++ {
		for c := 0; c < size-1; c++ {
			s := m.en(f, c) + m.en(f, c+1) + m.en(f+1, c) + m.en(f+1, c+1)
			if s == 4 || s == 0 {
				n2++
			}
		}
	}
	puntos += n2 * 3
	// N3
	n3 := 0
	for f := 0; f < size; f++ {
		bc, bf := 0, 0
		for c := 0; c < size; c++ {
			bc = ((bc << 1) & 0x7ff) | int(m.en(f, c))
			if c >= 10 && (bc == 0x5d0 || bc == 0x05d) {
				n3++
			}
			bf = ((bf << 1) & 0x7ff) | int(m.en(c, f))
			if c >= 10 && (bf == 0x5d0 || bf == 0x05d) {
				n3++
			}
		}
	}
	puntos += n3 * 40
	// N4
	oscuros := 0
	for _, v := range m.data {
		oscuros += int(v)
	}
	k := math.Abs(math.Ceil(float64(oscuros*100)/float64(len(m.data))/5) - 10)
	return puntos + int(k)*10
}

// qrCrear es qrcode.create(texto, {errorCorrectionLevel: "M"}).
func qrCrear(texto string) (*qrMatriz, error) {
	if texto == "" {
		return nil, errQrVacio
	}
	estimada := qrMejorVersion(qrPartir(texto))
	if estimada == 0 {
		estimada = 40
	}
	segs := qrOptimizar(texto, estimada)
	version := qrMejorVersion(segs)
	if version == 0 {
		return nil, errQrGrande
	}

	// createData
	var b qrBits
	for _, s := range segs {
		b.poner(s.modo.bit, 4)
		b.poner(s.cantidad(), qrIndicador(s.modo, version))
		s.escribir(&b)
	}
	total := qrCodewords[version]
	correccion := qrCorreccionM[version-1]
	bitsDatos := (total - correccion) * 8
	if b.largo+4 <= bitsDatos {
		b.poner(0, 4)
	}
	for b.largo%8 != 0 {
		b.ponerBit(false)
	}
	restan := (bitsDatos - b.largo) / 8
	for i := 0; i < restan; i++ {
		if i%2 != 0 {
			b.poner(0x11, 8)
		} else {
			b.poner(0xec, 8)
		}
	}

	// createCodewords
	bloques := qrBloquesM[version-1]
	datosTotal := total - correccion
	enGrupo2 := total % bloques
	enGrupo1 := bloques - enGrupo2
	totalGrupo1 := total / bloques
	datosGrupo1 := datosTotal / bloques
	datosGrupo2 := datosGrupo1 + 1
	ec := totalGrupo1 - datosGrupo1
	dc := make([][]byte, bloques)
	ecd := make([][]byte, bloques)
	off, maxDatos := 0, 0
	for k := 0; k < bloques; k++ {
		tam := datosGrupo2
		if k < enGrupo1 {
			tam = datosGrupo1
		}
		fin := off + tam
		if fin > len(b.buf) {
			fin = len(b.buf)
		}
		ini := off
		if ini > len(b.buf) {
			ini = len(b.buf)
		}
		dc[k] = b.buf[ini:fin]
		ecd[k] = rsCodificar(dc[k], ec)
		off += tam
		if tam > maxDatos {
			maxDatos = tam
		}
	}
	datos := make([]byte, 0, total)
	for i := 0; i < maxDatos; i++ {
		for r := 0; r < bloques; r++ {
			if i < len(dc[r]) {
				datos = append(datos, dc[r][i])
			}
		}
	}
	for i := 0; i < ec; i++ {
		for r := 0; r < bloques; r++ {
			datos = append(datos, ecd[r][i])
		}
	}

	size := version*4 + 17
	m := &qrMatriz{size: size, data: make([]byte, size*size), reservado: make([]bool, size*size)}

	// setupFinderPattern
	for _, p := range [][2]int{{0, 0}, {size - 7, 0}, {0, size - 7}} {
		f0, c0 := p[0], p[1]
		for r := -1; r <= 7; r++ {
			if f0+r <= -1 || size <= f0+r {
				continue
			}
			for c := -1; c <= 7; c++ {
				if c0+c <= -1 || size <= c0+c {
					continue
				}
				oscuro := (r >= 0 && r <= 6 && (c == 0 || c == 6)) ||
					(c >= 0 && c <= 6 && (r == 0 || r == 6)) ||
					(r >= 2 && r <= 4 && c >= 2 && c <= 4)
				m.poner(f0+r, c0+c, oscuro, true)
			}
		}
	}
	// setupTimingPattern
	for r := 8; r < size-8; r++ {
		v := r%2 == 0
		m.poner(r, 6, v, true)
		m.poner(6, r, v, true)
	}
	// setupAlignmentPattern
	for _, p := range qrPosicionesAlineacion(version) {
		for r := -2; r <= 2; r++ {
			for c := -2; c <= 2; c++ {
				v := r == -2 || r == 2 || c == -2 || c == 2 || (r == 0 && c == 0)
				m.poner(p[0]+r, p[1]+c, v, true)
			}
		}
	}
	qrPonerFormato(m, 0)
	if version >= 7 {
		bits := qrVersionBits(version)
		for i := 0; i < 18; i++ {
			f := i / 3
			c := i%3 + size - 8 - 3
			mod := (bits>>i)&1 == 1
			m.poner(f, c, mod, true)
			m.poner(c, f, mod, true)
		}
	}
	// setupData
	inc, fila, bit, byteI := -1, size-1, 7, 0
	for col := size - 1; col > 0; col -= 2 {
		if col == 6 {
			col--
		}
		for {
			for c := 0; c < 2; c++ {
				if !m.reservado[fila*size+col-c] {
					oscuro := false
					if byteI < len(datos) {
						oscuro = (datos[byteI]>>bit)&1 == 1
					}
					m.poner(fila, col-c, oscuro, false)
					bit--
					if bit == -1 {
						byteI++
						bit = 7
					}
				}
			}
			fila += inc
			if fila < 0 || size <= fila {
				fila -= inc
				inc = -inc
				break
			}
		}
	}

	// getBestMask
	mejor, menor := 0, math.MaxInt
	for p := 0; p < 8; p++ {
		qrPonerFormato(m, p)
		qrAplicarMascara(p, m)
		pen := qrPenalidad(m)
		qrAplicarMascara(p, m)
		if pen < menor {
			menor, mejor = pen, p
		}
	}
	qrAplicarMascara(mejor, m)
	qrPonerFormato(m, mejor)
	return m, nil
}

type errorQr string

func (e errorQr) Error() string { return string(e) }

const (
	errQrVacio  = errorQr("el QR no tiene texto")
	errQrGrande = errorQr("el texto no entra en un QR")
)
