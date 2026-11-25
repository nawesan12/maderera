package planilla

// inflar es `inflateRawSync` de Node: descomprime un deflate crudo y, si está
// roto, falla con el mismo mensaje que zlib ("unexpected end of file",
// "invalid block type", "invalid distance too far back"…). compress/flate
// descomprime lo mismo pero dice otra cosa ("flate: corrupt input before
// offset N"), y el mensaje llega a la pantalla: "No se pudo abrir el Excel:
// …". Es el algoritmo de puff.c de Mark Adler con los controles de
// inflate.c e inflate_table.c, en el mismo orden.

var (
	errFinInesperado    = &errorJS{"unexpected end of file"}
	errTipoBloque       = &errorJS{"invalid block type"}
	errLargosGuardado   = &errorJS{"invalid stored block lengths"}
	errDemasiados       = &errorJS{"too many length or distance symbols"}
	errLargosCodigos    = &errorJS{"invalid code lengths set"}
	errRepeticion       = &errorJS{"invalid bit length repeat"}
	errSinFinDeBloque   = &errorJS{"invalid code -- missing end-of-block"}
	errLargosLiterales  = &errorJS{"invalid literal/lengths set"}
	errLargosDistancias = &errorJS{"invalid distances set"}
	errCodigoLiteral    = &errorJS{"invalid literal/length code"}
	errCodigoDistancia  = &errorJS{"invalid distance code"}
	errDistanciaLejana  = &errorJS{"invalid distance too far back"}
)

const maxBits = 15

type huffman struct {
	cuenta  [maxBits + 1]int
	simbolo []int
	// vacia: ningún símbolo tiene largo (zlib arma una tabla donde todo
	// código de un bit es inválido). incompleta: un único código de un bit,
	// que zlib acepta para literales y distancias; el otro bit es inválido.
	vacia, incompleta bool
}

type tipoTabla int

const (
	tablaCodigos tipoTabla = iota
	tablaLiterales
	tablaDistancias
)

// armar es inflate_table: false si el código está sobresuscripto o
// incompleto (salvo el caso de un solo código de un bit).
func armar(h *huffman, largos []int, tipo tipoTabla) bool {
	*h = huffman{}
	for _, l := range largos {
		h.cuenta[l]++
	}
	maximo := 0
	for l := maxBits; l >= 1; l-- {
		if h.cuenta[l] != 0 {
			maximo = l
			break
		}
	}
	if maximo == 0 {
		h.vacia = true
		return true
	}
	quedan := 1
	for l := 1; l <= maxBits; l++ {
		quedan <<= 1
		quedan -= h.cuenta[l]
		if quedan < 0 {
			return false
		}
	}
	if quedan > 0 {
		if tipo == tablaCodigos || maximo != 1 {
			return false
		}
		h.incompleta = true
	}
	var desde [maxBits + 2]int
	for l := 1; l <= maxBits; l++ {
		desde[l+1] = desde[l] + h.cuenta[l]
	}
	h.simbolo = make([]int, len(largos))
	for s, l := range largos {
		if l != 0 {
			h.simbolo[desde[l]] = s
			desde[l]++
		}
	}
	h.cuenta[0] = 0
	return true
}

type inflador struct {
	in     []byte
	pos    int
	buf    uint32
	cuenta uint
	out    []byte
}

func (s *inflador) bits(n uint) (int, error) {
	for s.cuenta < n {
		if s.pos >= len(s.in) {
			return 0, errFinInesperado
		}
		s.buf |= uint32(s.in[s.pos]) << s.cuenta
		s.pos++
		s.cuenta += 8
	}
	v := int(s.buf & (1<<n - 1))
	s.buf >>= n
	s.cuenta -= n
	return v, nil
}

// decodificar devuelve el símbolo, o -1 si el código es inválido.
func (s *inflador) decodificar(h *huffman) (int, error) {
	if h.vacia {
		if _, err := s.bits(1); err != nil {
			return 0, err
		}
		return -1, nil
	}
	codigo, primero, indice := 0, 0, 0
	for l := 1; l <= maxBits; l++ {
		b, err := s.bits(1)
		if err != nil {
			return 0, err
		}
		codigo |= b
		c := h.cuenta[l]
		if codigo-c < primero {
			return h.simbolo[indice+(codigo-primero)], nil
		}
		if h.incompleta {
			return -1, nil
		}
		indice += c
		primero += c
		primero <<= 1
		codigo <<= 1
	}
	return -1, nil
}

var (
	baseLargo   = [29]int{3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258}
	extraLargo  = [29]uint{0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0}
	baseDist    = [30]int{1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577}
	extraDist   = [30]uint{0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13}
	ordenLargos = [19]int{16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15}
)

func (s *inflador) codigos(lit, dist *huffman) error {
	for {
		sim, err := s.decodificar(lit)
		if err != nil {
			return err
		}
		switch {
		case sim < 0 || sim > 285:
			return errCodigoLiteral
		case sim < 256:
			s.out = append(s.out, byte(sim))
			continue
		case sim == 256:
			return nil
		}
		sim -= 257
		extra, err := s.bits(extraLargo[sim])
		if err != nil {
			return err
		}
		largo := baseLargo[sim] + extra
		ds, err := s.decodificar(dist)
		if err != nil {
			return err
		}
		if ds < 0 || ds > 29 {
			return errCodigoDistancia
		}
		extra, err = s.bits(extraDist[ds])
		if err != nil {
			return err
		}
		d := baseDist[ds] + extra
		if d > len(s.out) {
			return errDistanciaLejana
		}
		for k := 0; k < largo; k++ {
			s.out = append(s.out, s.out[len(s.out)-d])
		}
	}
}

func (s *inflador) guardado() error {
	s.buf, s.cuenta = 0, 0 // al borde del byte
	largo, err := s.bits(16)
	if err != nil {
		return err
	}
	complemento, err := s.bits(16)
	if err != nil {
		return err
	}
	if largo != complemento^0xffff {
		return errLargosGuardado
	}
	if s.pos+largo > len(s.in) {
		return errFinInesperado
	}
	s.out = append(s.out, s.in[s.pos:s.pos+largo]...)
	s.pos += largo
	return nil
}

var fijaLit, fijaDist huffman

func init() {
	var l [288]int
	for i := range l {
		switch {
		case i < 144:
			l[i] = 8
		case i < 256:
			l[i] = 9
		case i < 280:
			l[i] = 7
		default:
			l[i] = 8
		}
	}
	armar(&fijaLit, l[:], tablaLiterales)
	var d [32]int
	for i := range d {
		d[i] = 5
	}
	armar(&fijaDist, d[:], tablaDistancias)
}

func (s *inflador) dinamico() error {
	nlen, err := s.bits(5)
	if err != nil {
		return err
	}
	ndist, err := s.bits(5)
	if err != nil {
		return err
	}
	ncod, err := s.bits(4)
	if err != nil {
		return err
	}
	nlen, ndist, ncod = nlen+257, ndist+1, ncod+4
	if nlen > 286 || ndist > 30 {
		return errDemasiados
	}
	var largos [320]int
	for i := 0; i < ncod; i++ {
		if largos[ordenLargos[i]], err = s.bits(3); err != nil {
			return err
		}
	}
	var cod huffman
	if !armar(&cod, largos[:19], tablaCodigos) {
		return errLargosCodigos
	}
	for i := range largos[:19] {
		largos[i] = 0
	}
	for i := 0; i < nlen+ndist; {
		sim, err := s.decodificar(&cod)
		if err != nil {
			return err
		}
		if sim < 0 {
			sim = 0 // zlib no mira la marca de inválido acá: lee un cero
		}
		if sim < 16 {
			largos[i] = sim
			i++
			continue
		}
		var repetido, veces int
		switch sim {
		case 16:
			extra, err := s.bits(2)
			if err != nil {
				return err
			}
			if i == 0 {
				return errRepeticion
			}
			repetido, veces = largos[i-1], 3+extra
		case 17:
			extra, err := s.bits(3)
			if err != nil {
				return err
			}
			veces = 3 + extra
		default:
			extra, err := s.bits(7)
			if err != nil {
				return err
			}
			veces = 11 + extra
		}
		if i+veces > nlen+ndist {
			return errRepeticion
		}
		for ; veces > 0; veces-- {
			largos[i] = repetido
			i++
		}
	}
	if largos[256] == 0 {
		return errSinFinDeBloque
	}
	var lit, dist huffman
	if !armar(&lit, largos[:nlen], tablaLiterales) {
		return errLargosLiterales
	}
	if !armar(&dist, largos[nlen:nlen+ndist], tablaDistancias) {
		return errLargosDistancias
	}
	return s.codigos(&lit, &dist)
}

func inflar(in []byte) ([]byte, error) {
	s := &inflador{in: in, out: make([]byte, 0, len(in)*4)}
	for {
		ultimo, err := s.bits(1)
		if err != nil {
			return nil, err
		}
		tipo, err := s.bits(2)
		if err != nil {
			return nil, err
		}
		switch tipo {
		case 0:
			err = s.guardado()
		case 1:
			err = s.codigos(&fijaLit, &fijaDist)
		case 2:
			err = s.dinamico()
		default:
			err = errTipoBloque
		}
		if err != nil {
			return nil, err
		}
		if ultimo == 1 {
			return s.out, nil
		}
	}
}
