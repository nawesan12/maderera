package migracion

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"mjbj/internal/cuit"
	"mjbj/internal/jsmath"
	"mjbj/internal/planilla"
)

// Lote son las filas por lote. Doscientas se aplican en una transacción
// corta, que no bloquea a nadie más mientras corre; la pantalla parte el
// archivo con esta medida y va mostrando el avance.
const Lote = 200

// Opcion es un valor de un campo de opciones, con cómo lo escribe el
// sistema viejo (los alias se comparan normalizados).
type Opcion struct {
	Valor    string   `json:"valor"`
	Etiqueta string   `json:"etiqueta"`
	Alias    []string `json:"alias"`
}

// Campo es un campo de destino.
type Campo struct {
	Clave     string   `json:"clave"`
	Etiqueta  string   `json:"etiqueta"`
	Tipo      string   `json:"tipo"` // texto | numero | entero | cuit | email | opcion | fecha
	Requerido bool     `json:"requerido,omitempty"`
	Ayuda     string   `json:"ayuda,omitempty"`
	Opciones  []Opcion `json:"opciones,omitempty"`
	// PorDefecto es el valor cuando la columna no está o viene vacía. Puntero
	// porque "" no es lo mismo que no tener.
	PorDefecto *string  `json:"porDefecto,omitempty"`
	Alias      []string `json:"alias"`
}

// porDefecto es `campo.porDefecto ?? ""`.
func (c Campo) porDefecto() string {
	if c.PorDefecto == nil {
		return ""
	}
	return *c.PorDefecto
}

// Entidad es lo que se puede migrar y cómo se reconoce lo ya migrado.
type Entidad struct {
	Clave     string  `json:"clave"`
	Titulo    string  `json:"titulo"`
	Resumen   string  `json:"resumen"`
	Escribe   string  `json:"escribe"`
	Identidad string  `json:"identidad"`
	Campos    []Campo `json:"campos"`
}

// DefinicionDe es definicionDe.
func DefinicionDe(clave string) (Entidad, bool) {
	for _, e := range Entidades {
		if e.Clave == clave {
			return e, true
		}
	}
	return Entidad{}, false
}

// Mapeo es el índice de columna de cada campo; -1 es «sin mapear».
type Mapeo map[string]int

func (m Mapeo) de(clave string) int {
	if i, ok := m[clave]; ok {
		return i
	}
	return -1
}

/* ------------------------------ JS ------------------------------ */

// esEspacioJS es `\s` y `trim()` de JS (cuenta el BOM, no el NEL).
func esEspacioJS(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ', 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff:
		return true
	}
	return r >= 0x2000 && r <= 0x200a
}

func trimJS(s string) string { return strings.TrimFunc(s, esEspacioJS) }

// minusculasJS es toLowerCase: la «İ» da «i̇» (con el punto combinado), y Go
// la deja en «i».
func minusculasJS(s string) string {
	return strings.ToLower(strings.ReplaceAll(s, "İ", "i̇"))
}

// numeroJS es Number(texto) (Number("") es 0).
func numeroJS(s string) float64 {
	t := trimJS(s)
	if strings.HasPrefix(t, "\u0085") || strings.HasSuffix(t, "\u0085") {
		return jsmath.Numero("x")
	}
	return jsmath.Numero(t)
}

/* ----------------------------- mapeo ----------------------------- */

// Automapear propone un mapeo mirando los nombres de las columnas. Una
// columna se usa una sola vez; primero las coincidencias exactas de todos los
// campos y después las parciales, donde gana el alias más largo.
func Automapear(e Entidad, columnas []string) Mapeo {
	normalizadas := make([]string, len(columnas))
	for i, c := range columnas {
		normalizadas[i] = planilla.NormalizarEncabezado(c)
	}
	tomadas := map[int]bool{}
	mapeo := Mapeo{}
	for _, c := range e.Campos {
		mapeo[c.Clave] = -1
	}

	for _, c := range e.Campos {
		if mapeo[c.Clave] != -1 {
			continue
		}
		for i, col := range normalizadas {
			if !tomadas[i] && col != "" && contiene(c.Alias, col) {
				mapeo[c.Clave] = i
				tomadas[i] = true
				break
			}
		}
	}

	for _, c := range e.Campos {
		if mapeo[c.Clave] != -1 {
			continue
		}
		mejor, largo := -1, 0
		for i, col := range normalizadas {
			if tomadas[i] || col == "" {
				continue
			}
			for _, a := range c.Alias {
				if len(a) < 4 || !strings.Contains(col, a) {
					continue
				}
				if mejor == -1 || len(a) > largo {
					mejor, largo = i, len(a)
				}
			}
		}
		if mejor != -1 {
			mapeo[c.Clave] = mejor
			tomadas[mejor] = true
		}
	}
	return mapeo
}

func contiene(xs []string, x string) bool {
	for _, y := range xs {
		if y == x {
			return true
		}
	}
	return false
}

// Faltantes son las etiquetas de los campos obligatorios sin columna.
func Faltantes(e Entidad, m Mapeo) []string {
	out := []string{}
	for _, c := range e.Campos {
		if c.Requerido && m.de(c.Clave) < 0 {
			out = append(out, c.Etiqueta)
		}
	}
	return out
}

/* ---------------------------- campos ---------------------------- */

// Fila es una fila del archivo ya leída: los datos normalizados y lo que
// está mal en ella.
type Fila struct {
	// Linea es el renglón en el archivo, contando el encabezado.
	Linea   int               `json:"linea"`
	Datos   map[string]string `json:"datos"`
	Errores []string          `json:"errores"`
	Avisos  []string          `json:"avisos"`
}

func interpretarOpcion(bruto string, opciones []Opcion) (string, bool) {
	clave := planilla.NormalizarEncabezado(bruto)
	if clave == "" {
		return "", false
	}
	for _, o := range opciones {
		if contiene(o.Alias, clave) || planilla.NormalizarEncabezado(o.Valor) == clave {
			return o.Valor, true
		}
	}
	// Parcial, y gana el alias más largo: sin eso «metros cuadrados» se lo
	// lleva «metro» y el producto queda por metro lineal. Los de dos o tres
	// letras solo valen exactos.
	mejor, largo := "", 0
	for _, o := range opciones {
		for _, a := range o.Alias {
			if len(a) < 4 || !strings.Contains(clave, a) {
				continue
			}
			if largo == 0 || len(a) > largo {
				mejor, largo = o.Valor, len(a)
			}
		}
	}
	return mejor, largo > 0
}

func interpretarEntero(bruto string) (string, bool) {
	n, ok := planilla.InterpretarNumero(bruto)
	if !ok {
		return "", false
	}
	return jsmath.Texto(jsmath.Round(numeroJS(n))), true
}

var (
	reEmail   = regexp.MustCompile(`^[^` + claseEspacio + `@]+@[^` + claseEspacio + `@]+\.[^` + claseEspacio + `@]+$`)
	reIso     = regexp.MustCompile(`^(\d{4})-(\d{1,2})-(\d{1,2})$`)
	reCriollo = regexp.MustCompile(`^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$`)
)

// claseEspacio es `\s` de JS para una clase de Go.
const claseEspacio = `\t\n\v\f\r \x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}`

// InterpretarFecha pasa una fecha del sistema viejo a ISO. Día primero
// (03/09/2026 es el 3 de septiembre), d-m-aaaa, o el ISO aaaa-mm-dd. Con dos
// dígitos de año, 98 es 1998 y 26 es 2026. Rebota el 31 de febrero. El
// segundo valor es false si no la entiende.
func InterpretarFecha(texto string) (string, bool) {
	limpio := trimJS(texto)
	if i := strings.IndexFunc(limpio, func(r rune) bool { return r == 'T' || esEspacioJS(r) }); i >= 0 {
		limpio = limpio[:i]
	}
	if limpio == "" {
		return "", false
	}

	var anio, mes, dia int
	if m := reIso.FindStringSubmatch(limpio); m != nil {
		anio, _ = strconv.Atoi(m[1])
		mes, _ = strconv.Atoi(m[2])
		dia, _ = strconv.Atoi(m[3])
	} else if m := reCriollo.FindStringSubmatch(limpio); m != nil {
		dia, _ = strconv.Atoi(m[1])
		mes, _ = strconv.Atoi(m[2])
		anio, _ = strconv.Atoi(m[3])
		if anio < 100 {
			if anio < 70 {
				anio += 2000
			} else {
				anio += 1900
			}
		}
	} else {
		return "", false
	}

	if mes < 1 || mes > 12 || dia < 1 || dia > 31 {
		return "", false
	}
	// Date.UTC lee los años 0 a 99 como 1900 a 1999 (un «0050-01-01» del
	// ISO es 1950): se reproduce.
	if anio >= 0 && anio <= 99 {
		anio += 1900
	}
	f := time.Date(anio, time.Month(mes), dia, 0, 0, 0, 0, time.UTC)
	if int(f.Month()) != mes || f.Day() != dia {
		return "", false
	}
	return fmt.Sprintf("%04d-%02d-%02dT00:00:00.000Z", f.Year(), mes, dia), true
}

type leido struct {
	valor, error, aviso string
}

func leerCampo(c Campo, bruto string) leido {
	texto := trimJS(bruto)
	if texto == "" {
		if c.Requerido {
			return leido{error: "Falta " + minusculasJS(c.Etiqueta) + "."}
		}
		return leido{valor: c.porDefecto()}
	}

	switch c.Tipo {
	case "numero":
		n, ok := planilla.InterpretarNumero(texto)
		if !ok {
			return leido{valor: c.porDefecto(), error: fmt.Sprintf(`%s: "%s" no es un número.`, c.Etiqueta, texto)}
		}
		return leido{valor: n}
	case "entero":
		n, ok := interpretarEntero(texto)
		if !ok {
			return leido{valor: c.porDefecto(), error: fmt.Sprintf(`%s: "%s" no es un número.`, c.Etiqueta, texto)}
		}
		return leido{valor: n}
	case "cuit":
		d := cuit.SoloDigitos(texto)
		if d == "" {
			return leido{}
		}
		// El CUIT mal formado no frena la fila: se migra y el informe lo
		// avisa. Perder un cliente por un dígito es peor.
		if !cuit.Valido(d) {
			return leido{valor: d, aviso: fmt.Sprintf("El CUIT %s no verifica. Se migra igual, pero hay que corregirlo antes de facturar.", texto)}
		}
		return leido{valor: d}
	case "email":
		correo := minusculasJS(texto)
		if !reEmail.MatchString(correo) {
			return leido{aviso: fmt.Sprintf(`El correo "%s" no parece válido. Se deja vacío.`, texto)}
		}
		return leido{valor: correo}
	case "fecha":
		f, ok := InterpretarFecha(texto)
		if !ok {
			return leido{error: fmt.Sprintf(`%s: "%s" no es una fecha. Se espera día/mes/año.`, c.Etiqueta, texto)}
		}
		return leido{valor: f}
	case "opcion":
		v, ok := interpretarOpcion(texto, c.Opciones)
		if !ok {
			queda := ""
			if c.porDefecto() != "" {
				queda = ", queda en " + strings.ReplaceAll(c.porDefecto(), "_", " ")
			}
			return leido{valor: c.porDefecto(), aviso: fmt.Sprintf(`%s: no se reconoció "%s"%s.`, c.Etiqueta, texto, queda)}
		}
		return leido{valor: v}
	}
	return leido{valor: texto}
}

// validarFila son las reglas que miran la fila entera.
func validarFila(e Entidad, d map[string]string) (errores, avisos []string) {
	switch e.Clave {
	case "saldos":
		if d["codigo"] == "" && d["cuit"] == "" && d["email"] == "" {
			errores = append(errores, "No hay con qué encontrar al cliente: hace falta el código, el CUIT o el correo.")
		}
	case "clientes":
		if d["codigo"] == "" && d["cuit"] == "" {
			avisos = append(avisos, "Sin código ni CUIT, la ficha se busca por nombre exacto. Dos clientes con el mismo nombre se pisan.")
		}
		if numeroJS(d["limiteCredito"]) < 0 {
			errores = append(errores, "El límite de cuenta corriente no puede ser negativo.")
		}
	case "stock":
		if numeroJS(d["cantidad"]) < 0 {
			errores = append(errores, "La existencia no puede ser negativa.")
		}
	}
	return errores, avisos
}

// NormalizarFilas convierte las filas crudas en registros listos para
// escribir, con lo que está mal en cada una. No toca la base.
func NormalizarFilas(e Entidad, m Mapeo, filas [][]string) []Fila {
	out := make([]Fila, len(filas))
	for i, fila := range filas {
		f := Fila{Linea: i + 2, Datos: make(map[string]string, len(e.Campos)), Errores: []string{}, Avisos: []string{}}
		for _, c := range e.Campos {
			bruto := ""
			if j := m.de(c.Clave); j >= 0 && j < len(fila) {
				bruto = fila[j]
			}
			l := leerCampo(c, bruto)
			f.Datos[c.Clave] = l.valor
			if l.error != "" {
				f.Errores = append(f.Errores, l.error)
			}
			if l.aviso != "" {
				f.Avisos = append(f.Avisos, l.aviso)
			}
		}
		errs, avs := validarFila(e, f.Datos)
		f.Errores = append(f.Errores, errs...)
		f.Avisos = append(f.Avisos, avs...)
		out[i] = f
	}
	return out
}

/* -------------------------- vista previa -------------------------- */

// Rechazo es una fila que no entró, con el motivo.
type Rechazo struct {
	Linea         int    `json:"linea"`
	Identificador string `json:"identificador"`
	Motivo        string `json:"motivo"`
}

// FilaPrevia es una fila de la muestra de la vista previa.
type FilaPrevia struct {
	Linea         int      `json:"linea"`
	Identificador string   `json:"identificador"`
	Resumen       string   `json:"resumen"`
	Errores       []string `json:"errores"`
	Avisos        []string `json:"avisos"`
}

// VistaPrevia es lo que va a pasar si se migra, sin escribir nada.
type VistaPrevia struct {
	Error    string        `json:"error,omitempty"`
	Validas  *int          `json:"validas,omitempty"`
	ConAviso *int          `json:"conAviso,omitempty"`
	ConError *int          `json:"conError,omitempty"`
	Muestra  *[]FilaPrevia `json:"muestra,omitempty"`
	Rechazos *[]Rechazo    `json:"rechazos,omitempty"`
}

func primero(xs ...string) string {
	for _, x := range xs {
		if x != "" {
			return x
		}
	}
	return ""
}

func unir(xs ...string) string {
	var no []string
	for _, x := range xs {
		if x != "" {
			no = append(no, x)
		}
	}
	return strings.Join(no, " · ")
}

// describir es cómo se muestra una fila en la vista previa y el informe.
func describir(entidad string, d map[string]string) (identificador, resumen string) {
	switch entidad {
	case "clientes":
		return primero(d["codigo"], d["cuit"], "—"), unir(d["nombre"], strings.ReplaceAll(d["condicionIva"], "_", " "))
	case "productos":
		return d["sku"], unir(d["nombre"], d["medida"], d["categoria"])
	case "stock":
		return d["sku"], d["cantidad"] + " en " + d["sucursal"]
	}
	return primero(d["codigo"], d["cuit"], d["email"], "—"), unir(d["nombre"], d["saldo"])
}

// Previsualizar valida el archivo entero sin escribir nada. La muestra va
// primero con lo que no entra, después con lo que entra con reparos.
func Previsualizar(e Entidad, m Mapeo, filas [][]string) VistaPrevia {
	if sin := Faltantes(e, m); len(sin) > 0 {
		return VistaPrevia{Error: "Falta indicar qué columna es " + strings.Join(sin, ", ") + "."}
	}
	normalizadas := NormalizarFilas(e, m, filas)
	var conError, conAviso, bien []Fila
	for _, f := range normalizadas {
		switch {
		case len(f.Errores) > 0:
			conError = append(conError, f)
		case len(f.Avisos) > 0:
			conAviso = append(conAviso, f)
		default:
			bien = append(bien, f)
		}
	}
	orden := append(append(append([]Fila{}, conError...), conAviso...), bien...)
	if len(orden) > 60 {
		orden = orden[:60]
	}
	muestra := make([]FilaPrevia, len(orden))
	for i, f := range orden {
		id, res := describir(e.Clave, f.Datos)
		muestra[i] = FilaPrevia{Linea: f.Linea, Identificador: id, Resumen: res, Errores: f.Errores, Avisos: f.Avisos}
	}
	rechazos := make([]Rechazo, len(conError))
	for i, f := range conError {
		id, _ := describir(e.Clave, f.Datos)
		rechazos[i] = Rechazo{Linea: f.Linea, Identificador: id, Motivo: strings.Join(f.Errores, " ")}
	}
	validas, avisos, errores := len(normalizadas)-len(conError), len(conAviso), len(conError)
	return VistaPrevia{Validas: &validas, ConAviso: &avisos, ConError: &errores, Muestra: &muestra, Rechazos: &rechazos}
}
