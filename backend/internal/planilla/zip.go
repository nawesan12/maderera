package planilla

import (
	"encoding/binary"
)

const (
	firmaFinCentral     = 0x06054b50
	firmaEntradaCentral = 0x02014b50
)

// errRango es el RangeError de un DataView leído fuera de sus bordes: el TS
// no controla los offsets del ZIP y deja que el DataView se queje.
var errRango = &errorJS{"Offset is outside the bounds of the DataView"}

type vistaZip []byte

func (v vistaZip) u16(off int) (int, error) {
	if off < 0 || off+2 > len(v) {
		return 0, errRango
	}
	return int(binary.LittleEndian.Uint16(v[off:])), nil
}

func (v vistaZip) u32(off int) (int, error) {
	if off < 0 || off+4 > len(v) {
		return 0, errRango
	}
	return int(binary.LittleEndian.Uint32(v[off:])), nil
}

// sub es Uint8Array.subarray: recorta a los bordes.
func (v vistaZip) sub(a, b int) []byte {
	a = max(0, min(a, len(v)))
	b = max(a, min(b, len(v)))
	return v[a:b]
}

// abrirZip saca los archivos de un ZIP como lo hace el TS: recorriendo el
// directorio central (no los encabezados locales, que pueden traer los
// tamaños en cero), sin mirar el CRC, y descomprimiendo todas las entradas
// aunque no se usen (una entrada rota rompe el archivo entero, igual que
// allá). archive/zip no sirve para esto: valida otras cosas, con otros
// mensajes, y lee Zip64.
func abrirZip(datos []byte) (map[string][]byte, error) {
	v := vistaZip(datos)

	// El fin del directorio central está al final, después de un comentario
	// de largo variable: se busca hacia atrás.
	fin := -1
	for i := len(v) - 22; i >= 0 && i > len(v)-22-65535; i-- {
		if binary.LittleEndian.Uint32(v[i:]) == firmaFinCentral {
			fin = i
			break
		}
	}
	if fin == -1 {
		return nil, &errorJS{"El archivo no es un .xlsx válido: no se encontró el índice interno."}
	}

	cantidad, _ := v.u16(fin + 10)
	offset, _ := v.u32(fin + 16)
	if offset == 0xffffffff {
		return nil, &errorJS{"El archivo usa el formato Zip64, que no se puede leer. Guardalo de nuevo desde Excel."}
	}

	archivos := map[string][]byte{}
	for i := 0; i < cantidad; i++ {
		firma, err := v.u32(offset)
		if err != nil {
			return nil, err
		}
		if firma != firmaEntradaCentral {
			break
		}
		var campos [6]int
		for k, off := range []int{10, 20, 28, 30, 32, 42} {
			leer := v.u16
			if off == 20 || off == 42 {
				leer = v.u32
			}
			if campos[k], err = leer(offset + off); err != nil {
				return nil, err
			}
		}
		metodo, comprimido, largoNombre, largoExtra, largoComentario, offsetLocal := campos[0], campos[1], campos[2], campos[3], campos[4], campos[5]

		nombre := decodificarUTF8(v.sub(offset+46, offset+46+largoNombre))

		// El encabezado local repite el nombre y el extra, con sus propios largos.
		largoNombreLocal, err := v.u16(offsetLocal + 26)
		if err != nil {
			return nil, err
		}
		largoExtraLocal, err := v.u16(offsetLocal + 28)
		if err != nil {
			return nil, err
		}
		inicio := offsetLocal + 30 + largoNombreLocal + largoExtraLocal

		crudo := v.sub(inicio, inicio+comprimido)
		if metodo == 0 {
			archivos[nombre] = crudo
		} else {
			datos, err := inflar(crudo)
			if err != nil {
				return nil, err
			}
			archivos[nombre] = datos
		}

		offset += 46 + largoNombre + largoExtra + largoComentario
	}
	return archivos, nil
}
