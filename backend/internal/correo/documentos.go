package correo

import (
	"archive/zip"
	"bytes"
	"compress/zlib"
	"encoding/csv"
	"encoding/xml"
	"io"
	"regexp"
	"strconv"
	"strings"
)

// Leer lo que traen los adjuntos para conectarlos con el ERP: el texto de
// un PDF y las filas de una planilla. Sin dependencias nuevas y sin
// pretender ser un lector completo: alcanza para los PDF que arman los
// programas (despieces, facturas, comprobantes de home banking) y para las
// planillas de Excel. Lo que no se puede leer, no se propone.

const topeDocumento = 8 << 20

// textoDePDF saca el texto de las cadenas que dibujan los operadores Tj,
// TJ, ' y " de cada flujo de contenido (comprimido con Flate o sin
// comprimir). Las fuentes con codificación propia (CID, cadenas en
// hexadecimal) no se leen.
func textoDePDF(datos []byte) string {
	if len(datos) > topeDocumento || !bytes.HasPrefix(datos, []byte("%PDF")) {
		return ""
	}
	var out strings.Builder
	resto := datos
	for {
		i := bytes.Index(resto, []byte("stream"))
		if i < 0 {
			break
		}
		dicc := resto[max(0, i-400):i]
		cuerpo := resto[i+len("stream"):]
		cuerpo = bytes.TrimPrefix(cuerpo, []byte("\r"))
		cuerpo = bytes.TrimPrefix(cuerpo, []byte("\n"))
		fin := bytes.Index(cuerpo, []byte("endstream"))
		if fin < 0 {
			break
		}
		flujo := cuerpo[:fin]
		resto = cuerpo[fin+len("endstream"):]
		if bytes.Contains(dicc, []byte("/Image")) || bytes.Contains(dicc, []byte("/FontFile")) {
			continue
		}
		if bytes.Contains(dicc, []byte("/FlateDecode")) {
			r, err := zlib.NewReader(bytes.NewReader(flujo))
			if err != nil {
				continue
			}
			plano, err := io.ReadAll(io.LimitReader(r, topeDocumento))
			if err != nil && len(plano) == 0 {
				continue
			}
			flujo = plano
		}
		cadenasDeContenido(flujo, &out)
	}
	return strings.TrimSpace(out.String())
}

// cadenasDeContenido recorre un flujo de contenido: las cadenas (entre
// paréntesis) son texto, y los movimientos de línea (Td, TD, T*, ', ET)
// son saltos.
func cadenasDeContenido(c []byte, out *strings.Builder) {
	enTexto := false
	for i := 0; i < len(c); i++ {
		switch c[i] {
		case '(':
			s, n := cadenaPDF(c[i:])
			out.WriteString(s)
			i += n - 1
			enTexto = true
		case 'T':
			if i+1 < len(c) && (c[i+1] == 'd' || c[i+1] == 'D' || c[i+1] == '*') && enTexto {
				out.WriteByte('\n')
				enTexto = false
			}
		case 'E':
			if i+1 < len(c) && c[i+1] == 'T' && enTexto {
				out.WriteByte('\n')
				enTexto = false
			}
		case '\'', '"':
			if enTexto {
				out.WriteByte('\n')
			}
		}
	}
}

// cadenaPDF lee una cadena literal desde el paréntesis que abre; devuelve
// el texto y cuántos bytes ocupó.
func cadenaPDF(c []byte) (string, int) {
	var b strings.Builder
	nivel := 0
	for i := 0; i < len(c); i++ {
		switch ch := c[i]; ch {
		case '\\':
			if i+1 >= len(c) {
				return b.String(), i + 1
			}
			i++
			switch e := c[i]; e {
			case 'n':
				b.WriteByte('\n')
			case 'r', 't':
				b.WriteByte(' ')
			case '(', ')', '\\':
				b.WriteByte(e)
			default:
				if e >= '0' && e <= '7' {
					fin := i
					for fin < len(c) && fin < i+3 && c[fin] >= '0' && c[fin] <= '7' {
						fin++
					}
					n, _ := strconv.ParseUint(string(c[i:fin]), 8, 8)
					b.WriteRune(rune(n)) // Latin-1 / WinAnsi: el byte es la letra
					i = fin - 1
				}
			}
		case '(':
			if nivel > 0 {
				b.WriteByte(ch)
			}
			nivel++
		case ')':
			nivel--
			if nivel == 0 {
				return b.String(), i + 1
			}
			b.WriteByte(ch)
		default:
			if ch >= 0x80 {
				b.WriteRune(rune(ch))
			} else {
				b.WriteByte(ch)
			}
		}
	}
	return b.String(), len(c)
}

// filasDePlanilla lee la primera hoja de un .xlsx (o un .csv) como filas
// de texto.
func filasDePlanilla(nombre string, datos []byte) [][]string {
	if len(datos) > topeDocumento {
		return nil
	}
	if strings.HasSuffix(strings.ToLower(nombre), ".csv") {
		r := csv.NewReader(bytes.NewReader(datos))
		r.FieldsPerRecord = -1
		r.LazyQuotes = true
		if bytes.Count(datos[:min(len(datos), 2000)], []byte(";")) > bytes.Count(datos[:min(len(datos), 2000)], []byte(",")) {
			r.Comma = ';'
		}
		filas, _ := r.ReadAll()
		return filas
	}
	z, err := zip.NewReader(bytes.NewReader(datos), int64(len(datos)))
	if err != nil {
		return nil
	}
	leer := func(ruta string) []byte {
		for _, f := range z.File {
			if f.Name == ruta {
				r, err := f.Open()
				if err != nil {
					return nil
				}
				defer r.Close()
				b, _ := io.ReadAll(io.LimitReader(r, topeDocumento))
				return b
			}
		}
		return nil
	}
	var compartidas []string
	if x := leer("xl/sharedStrings.xml"); x != nil {
		var sst struct {
			SI []struct {
				T string `xml:"t"`
				R []struct {
					T string `xml:"t"`
				} `xml:"r"`
			} `xml:"si"`
		}
		_ = xml.Unmarshal(x, &sst)
		for _, si := range sst.SI {
			t := si.T
			for _, r := range si.R {
				t += r.T
			}
			compartidas = append(compartidas, t)
		}
	}
	hoja := leer("xl/worksheets/sheet1.xml")
	if hoja == nil {
		return nil
	}
	var ws struct {
		Filas []struct {
			Celdas []struct {
				Ref    string `xml:"r,attr"`
				Tipo   string `xml:"t,attr"`
				Valor  string `xml:"v"`
				Inline string `xml:"is>t"`
			} `xml:"c"`
		} `xml:"sheetData>row"`
	}
	if xml.Unmarshal(hoja, &ws) != nil {
		return nil
	}
	var out [][]string
	for _, f := range ws.Filas {
		var fila []string
		for _, c := range f.Celdas {
			col := columnaDe(c.Ref)
			for len(fila) < col {
				fila = append(fila, "")
			}
			v := c.Valor
			switch c.Tipo {
			case "s":
				if n, err := strconv.Atoi(v); err == nil && n < len(compartidas) {
					v = compartidas[n]
				}
			case "inlineStr":
				v = c.Inline
			}
			fila = append(fila, strings.TrimSpace(v))
		}
		out = append(out, fila)
		if len(out) > 5000 {
			break
		}
	}
	return out
}

// columnaDe pasa «C12» a 2.
func columnaDe(ref string) int {
	n := 0
	for _, r := range ref {
		if r < 'A' || r > 'Z' {
			break
		}
		n = n*26 + int(r-'A'+1)
	}
	return max(n-1, 0)
}

var reNoAlfanumerico = regexp.MustCompile(`[^\p{L}\p{N}]+`)

// normal es para comparar encabezados: sin tildes, minúscula, sin signos.
func normal(s string) string {
	return strings.TrimSpace(reNoAlfanumerico.ReplaceAllString(strings.ToLower(sinTilde.Replace(s)), " "))
}
