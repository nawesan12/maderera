package compras

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"mjbj/internal/csvexcel"
	"mjbj/internal/formato"
	"mjbj/internal/jsmath"
	"mjbj/internal/planilla"
)

// Las cuentas de plata del módulo, sin base: el costo promedio y el flete
// (lib/compras/costo.ts), la retención (lib/retenciones/calculo.ts), la lista
// del proveedor (lib/precios/lista-proveedor.ts) y los formatos del libro y
// los CSV. Todas en float64 con jsmath, como el TS: el golden
// (testdata/golden/compras) las compara bit a bit.

// --- el costo ---

// redondear4 es el redondear de lib/compras/costo.ts: cuatro decimales, no
// dos (un promedio redondeado a centavos deriva con cada recepción).
func redondear4(n float64) float64 { return jsmath.Round(float64(n*10000)) / 10000 }

// EstadoDeCosto es a cuánto vale hoy una variante y sobre cuántas unidades.
type EstadoDeCosto struct {
	CantidadBase  float64 `json:"cantidadBase"`
	CostoPromedio float64 `json:"costoPromedio"`
}

func finito(x float64) bool { return !math.IsNaN(x) && !math.IsInf(x, 0) }

// MezclarCosto es mezclarCosto: el promedio ponderado de lo que había con lo
// que entra. Lo negativo cuenta como cero; una entrada rara no mueve nada.
func MezclarCosto(actual EstadoDeCosto, cantidad, costoUnitario float64) EstadoDeCosto {
	if !finito(cantidad) || cantidad <= 0 {
		return actual
	}
	if !finito(costoUnitario) || costoUnitario < 0 {
		return actual
	}
	base := math.Max(0, actual.CantidadBase)
	if base == 0 {
		return EstadoDeCosto{CantidadBase: cantidad, CostoPromedio: redondear4(costoUnitario)}
	}
	valorPrevio := float64(base * actual.CostoPromedio)
	valorEntrante := float64(cantidad * costoUnitario)
	total := base + cantidad
	return EstadoDeCosto{CantidadBase: total, CostoPromedio: redondear4((valorPrevio + valorEntrante) / total)}
}

// LineaDeCosto es lo que el prorrateo necesita de una línea.
type LineaDeCosto struct {
	Cantidad      float64 `json:"cantidad"`
	CostoUnitario float64 `json:"costoUnitario"`
}

// ProrratearGastos es prorratearGastos: el costo con el flete de cada línea,
// repartido por valor (o por cantidad si todo vale cero), con el resto en la
// línea de mayor peso.
func ProrratearGastos(lineas []LineaDeCosto, gastos float64) []float64 {
	out := make([]float64, len(lineas))
	for i, l := range lineas {
		out[i] = l.CostoUnitario
	}
	if !finito(gastos) || gastos <= 0 || len(lineas) == 0 {
		return out
	}
	valores := make([]float64, len(lineas))
	valorTotal, cantidadTotal := 0.0, 0.0
	for i, l := range lineas {
		valores[i] = float64(l.Cantidad * l.CostoUnitario)
		valorTotal += valores[i]
	}
	for _, l := range lineas {
		cantidadTotal += l.Cantidad
	}
	if cantidadTotal <= 0 {
		return out
	}
	pesos := make([]float64, len(lineas))
	for i, l := range lineas {
		if valorTotal > 0 {
			pesos[i] = valores[i] / valorTotal
		} else {
			pesos[i] = l.Cantidad / cantidadTotal
		}
	}
	partes := make([]float64, len(lineas))
	maximo := math.Inf(-1)
	for i, p := range pesos {
		partes[i] = redondear4(float64(p * gastos))
		if math.IsNaN(p) {
			maximo = math.NaN()
		} else if p > maximo && !math.IsNaN(maximo) {
			maximo = p
		}
	}
	// indexOf(Math.max(...pesos)): el primero con el peso más grande (con
	// un NaN no hay ninguno, y el TS no asignaba el resto).
	mayor := -1
	for i, p := range pesos {
		if p == maximo {
			mayor = i
			break
		}
	}
	if mayor >= 0 {
		resto := 0.0
		for i, p := range partes {
			if i != mayor {
				resto += p
			}
		}
		partes[mayor] = redondear4(gastos - resto)
	}
	for i, l := range lineas {
		porUnidad := 0.0
		if l.Cantidad > 0 {
			porUnidad = partes[i] / l.Cantidad
		}
		out[i] = redondear4(l.CostoUnitario + porUnidad)
	}
	return out
}

// AgregarIva es agregarIva de lib/fiscal/impuestos.ts: del neto al final.
func AgregarIva(neto, alicuota float64) float64 {
	if math.IsNaN(alicuota) {
		alicuota = 0
	}
	return jsmath.Redondear2Eps(float64(neto * (1 + alicuota/100)))
}

// CantidadDeStock es cantidadDeStock: tres decimales.
func CantidadDeStock(v float64) float64 { return jsmath.Round(float64(v*1000)) / 1000 }

// LineaRecibida es una línea de la recepción, como está en la base.
type LineaRecibida struct {
	VariantID     string
	Cantidad      float64
	CostoUnitario float64
	AlicuotaIva   float64
}

// LineaConfirmada es la cuenta que queda escrita en la línea al confirmar.
type LineaConfirmada struct {
	CostoConGastos float64
	Previo, Nuevo  EstadoDeCosto
	Unidades       float64
}

// CuentaDeRecepcion es la cuenta de confirmarRecepcion sin la base: reparte
// el flete, mezcla el costo línea por línea (leyendo el estado de cada
// variante con `estado` y guardándolo con `guardar`, que redondea como la
// columna numeric(14,4)) y suma el neto y la deuda con IVA.
func CuentaDeRecepcion(lineas []LineaRecibida, gastos float64, estado func(variante string) (EstadoDeCosto, error),
	guardar func(variante string, previo, nuevo EstadoDeCosto, l LineaConfirmada) error) (neto, deuda float64, err error) {
	base := make([]LineaDeCosto, len(lineas))
	for i, l := range lineas {
		base[i] = LineaDeCosto{l.Cantidad, l.CostoUnitario}
	}
	conGastos := ProrratearGastos(base, gastos)
	neto = gastos
	for i, l := range lineas {
		neto += float64(l.Cantidad * l.CostoUnitario)
		previo, err := estado(l.VariantID)
		if err != nil {
			return 0, 0, err
		}
		nuevo := MezclarCosto(previo, l.Cantidad, conGastos[i])
		if err := guardar(l.VariantID, previo, nuevo, LineaConfirmada{CostoConGastos: conGastos[i], Previo: previo, Nuevo: nuevo, Unidades: CantidadDeStock(l.Cantidad)}); err != nil {
			return 0, 0, err
		}
	}
	for i, l := range lineas {
		deuda += AgregarIva(float64(l.Cantidad*conGastos[i]), l.AlicuotaIva)
	}
	return neto, deuda, nil
}

// --- las retenciones ---

// Regimen es un régimen de retención con sus números.
type Regimen struct {
	Codigo              string  `json:"codigo"`
	Nombre              string  `json:"nombre"`
	Impuesto            string  `json:"impuesto"`
	Alicuota            float64 `json:"alicuota"`
	AlicuotaNoInscripto float64 `json:"alicuotaNoInscripto"`
	MinimoNoImponible   float64 `json:"minimoNoImponible"`
	MinimoRetencion     float64 `json:"minimoRetencion"`
}

// Retencion es lo que da calcularRetencion.
type Retencion struct {
	Imponible float64 `json:"imponible"`
	Alicuota  float64 `json:"alicuota"`
	Retencion float64 `json:"retencion"`
	Motivo    *string `json:"motivo"`
}

func motivo(m string) *string { return &m }

// CalcularRetencion es calcularRetencion: sobre el acumulado del mes (con el
// mínimo no imponible solo para el inscripto), menos lo ya retenido.
func CalcularRetencion(base, acumuladoMes, retenidoMes float64, r Regimen, inscripto bool) Retencion {
	alicuota, minimo := r.AlicuotaNoInscripto, 0.0
	if inscripto {
		alicuota, minimo = r.Alicuota, r.MinimoNoImponible
	}
	acumulado := math.Max(0, acumuladoMes+base)
	imponible := jsmath.Redondear2(math.Max(0, acumulado-minimo))
	if imponible == 0 {
		m := "No hay base sobre la que retener."
		if minimo > 0 {
			m = "No llega al mínimo no imponible del régimen."
		}
		return Retencion{0, alicuota, 0, motivo(m)}
	}
	acumuladaDelMes := jsmath.Redondear2(float64(imponible*alicuota) / 100)
	aRetener := jsmath.Redondear2(acumuladaDelMes - retenidoMes)
	if aRetener <= 0 {
		return Retencion{imponible, alicuota, 0, motivo("Ya se retuvo lo que correspondía este mes.")}
	}
	if aRetener < r.MinimoRetencion {
		return Retencion{imponible, alicuota, 0, motivo("No llega al mínimo de retención del régimen.")}
	}
	return Retencion{imponible, alicuota, aRetener, nil}
}

// --- los controles del pago ---

// FacturaImputada es una imputación con lo que la base sabe de la factura.
type FacturaImputada struct {
	Numero          int64
	Total, Imputado float64
	Importe         float64
}

// revisarImputacion es el control de cada factura de registrarPagoAProveedor:
// no se le imputa más que su saldo (con un centavo de tolerancia).
func revisarImputacion(f FacturaImputada) error {
	saldo := jsmath.Redondear2(f.Total - f.Imputado)
	if f.Importe-saldo > 0.01 {
		return fallo(fmt.Sprintf("A la factura %d le quedan $%s y se le están imputando $%s.", f.Numero, jsmath.Fijo2(saldo), jsmath.Fijo2(f.Importe)))
	}
	return nil
}

// revisarSumas son los dos controles de sumas del pago: lo imputado no pasa
// del total, y las partes suman el neto.
func revisarSumas(total, neto float64, imputaciones, partes []float64) error {
	suma := 0.0
	for _, i := range imputaciones {
		suma += math.Max(i, 0)
	}
	if jsmath.Redondear2(suma)-total > 0.01 {
		return fallo("Las facturas imputadas suman más que el pago.")
	}
	vivas := 0.0
	hay := false
	for _, p := range partes {
		if p > 0 {
			vivas += p
			hay = true
		}
	}
	if hay {
		sumaPartes := jsmath.Redondear2(vivas)
		if math.Abs(sumaPartes-neto) > 0.01 {
			return fallo(fmt.Sprintf("Las partes del pago suman $%s y el neto a pagar es $%s.", jsmath.Fijo2(sumaPartes), jsmath.Fijo2(neto)))
		}
	}
	return nil
}

// NormalizarNumeroDeCheque deja solo los dígitos (lib/cheques/numero.ts).
func NormalizarNumeroDeCheque(t string) string {
	var b strings.Builder
	for _, r := range t {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// RevisarNumeroDeCheque es revisarNumeroDeCheque: "" si está bien.
func RevisarNumeroDeCheque(t string) string {
	n := len(NormalizarNumeroDeCheque(t))
	switch {
	case n == 0:
		return "Poné el número del cheque: es como se lo encuentra en el banco."
	case n < 4:
		return "El número del cheque es muy corto. Revisalo contra el papel."
	case n > 20:
		return "El número del cheque es muy largo. Revisalo contra el papel."
	}
	return ""
}

// --- la lista de precios del proveedor ---

// PerfilDeProveedor dice cómo viene la planilla de un proveedor.
type PerfilDeProveedor struct {
	ColumnaCodigo      string  `json:"columnaCodigo"`
	ColumnaPrecio      string  `json:"columnaPrecio"`
	ColumnaDescripcion *string `json:"columnaDescripcion"`
	PrecioEsNeto       bool    `json:"precioEsNeto"`
	MargenPorcentaje   float64 `json:"margenPorcentaje"`
}

// FilaDeProveedor es un renglón leído.
type FilaDeProveedor struct {
	Codigo         string  `json:"codigo"`
	Descripcion    string  `json:"descripcion"`
	Costo          float64 `json:"costo"`
	PrecioSugerido float64 `json:"precioSugerido"`
	Fila           int     `json:"fila"`
}

// ProblemaDeFila es un renglón que no se pudo leer.
type ProblemaDeFila struct {
	Fila   int    `json:"fila"`
	Motivo string `json:"motivo"`
}

const ivaPorDefecto = 21

func indiceDe(encabezados []string, buscado string) int {
	objetivo := planilla.NormalizarEncabezado(buscado)
	for i, e := range encabezados {
		if planilla.NormalizarEncabezado(e) == objetivo {
			return i
		}
	}
	return -1
}

func celda(fila []string, i int) string {
	if i < 0 || i >= len(fila) {
		return ""
	}
	return fila[i]
}

// LeerListaDeProveedor es leerListaDeProveedor: la grilla del archivo
// convertida en precios, con los renglones malos devueltos y no tirados.
func LeerListaDeProveedor(grilla [][]string, p PerfilDeProveedor) ([]FilaDeProveedor, []ProblemaDeFila) {
	filas, problemas := []FilaDeProveedor{}, []ProblemaDeFila{}
	if len(grilla) < 2 {
		return filas, []ProblemaDeFila{{0, "El archivo no tiene datos."}}
	}
	encabezados := grilla[0]
	iCodigo, iPrecio, iDescripcion := indiceDe(encabezados, p.ColumnaCodigo), indiceDe(encabezados, p.ColumnaPrecio), -1
	if p.ColumnaDescripcion != nil && *p.ColumnaDescripcion != "" {
		iDescripcion = indiceDe(encabezados, *p.ColumnaDescripcion)
	}
	if iCodigo == -1 || iPrecio == -1 {
		falta := p.ColumnaPrecio
		if iCodigo == -1 {
			falta = p.ColumnaCodigo
		}
		return filas, []ProblemaDeFila{{1, `El archivo no tiene la columna "` + falta + `". Revisá el perfil del proveedor.`}}
	}
	vistos := map[string]bool{}
	for i, fila := range grilla[1:] {
		numero := i + 2
		codigo := trimJS(celda(fila, iCodigo))
		if codigo == "" {
			continue
		}
		crudo := trimJS(celda(fila, iPrecio))
		texto, ok := planilla.InterpretarNumero(crudo)
		valor := math.NaN()
		if ok {
			valor = jsmath.Numero(texto)
		}
		if !ok || !finito(valor) || valor <= 0 {
			mostrar := crudo
			if mostrar == "" {
				mostrar = "vacío"
			}
			problemas = append(problemas, ProblemaDeFila{numero, `"` + codigo + `" no tiene un precio válido (` + mostrar + `).`})
			continue
		}
		if vistos[codigo] {
			problemas = append(problemas, ProblemaDeFila{numero, `"` + codigo + `" aparece más de una vez. Se toma el primero.`})
			continue
		}
		vistos[codigo] = true
		costo := valor
		if p.PrecioEsNeto {
			costo = float64(valor * (1 + float64(ivaPorDefecto)/100))
		}
		descripcion := ""
		if iDescripcion != -1 {
			descripcion = trimJS(celda(fila, iDescripcion))
		}
		filas = append(filas, FilaDeProveedor{
			Codigo:         codigo,
			Descripcion:    descripcion,
			Costo:          jsmath.Redondear2(costo),
			PrecioSugerido: jsmath.Redondear2(float64(costo * (1 + p.MargenPorcentaje/100))),
			Fila:           numero,
		})
	}
	return filas, problemas
}

// --- formatos ---

// Monto es formatearMonto de lib/formato.ts: pesos sin decimales, con el
// signo adelante («-$ 1.235») y la mitad para arriba, como Intl.
func Monto(v float64) string {
	if !finito(v) {
		return "—"
	}
	signo := ""
	if math.Signbit(v) {
		signo = "-"
	}
	return signo + "$ " + formato.Miles(strconv.FormatFloat(math.Round(math.Abs(v)), 'f', 0, 64))
}

// NumeroDeCompra es numeroDeCompra: «0003-00001274».
func NumeroDeCompra(puntoVenta, numero int64) string {
	return fmt.Sprintf("%04d-%08d", puntoVenta, numero)
}

var comprobantesDeCompra = map[string]string{
	"factura_a": "Factura A", "factura_b": "Factura B", "factura_c": "Factura C", "factura_m": "Factura M",
	"nota_credito_a": "Nota de crédito A", "nota_credito_b": "Nota de crédito B", "nota_credito_c": "Nota de crédito C",
	"nota_debito_a": "Nota de débito A", "nota_debito_b": "Nota de débito B", "nota_debito_c": "Nota de débito C",
	"ticket": "Ticket", "otro": "Otro comprobante",
}

// NombreComprobanteCompra es nombreComprobanteCompra.
func NombreComprobanteCompra(tipo string) string {
	if n, ok := comprobantesDeCompra[tipo]; ok {
		return n
	}
	return "Comprobante"
}

// DaCreditoFiscal es daCreditoFiscal: la A, la M y sus notas.
func DaCreditoFiscal(tipo string) bool {
	return tipo == "factura_a" || tipo == "factura_m" || tipo == "nota_credito_a" || tipo == "nota_debito_a"
}

// numeroCsv es numeroCsv de lib/csv-excel.ts: con coma decimal.
func numeroCsv(v float64, decimales int) string {
	return strings.Replace(jsmath.ToFixed(v, decimales), ".", ",", 1)
}

// textoCsv es csvexcel.TextoCsv: entre comillas y sin fórmulas.
func textoCsv(v *string) string { return csvexcel.TextoCsv(v) }

func texto(v string) string { return textoCsv(&v) }

// fechaCsv es fechaCsv: dd/mm/aaaa en la zona de Next (UTC en producción).
func fechaCsv(t time.Time) string {
	t = t.In(time.UTC)
	return fmt.Sprintf("%02d/%02d/%d", t.Day(), int(t.Month()), t.Year())
}

// armarCsv es armarCsv: punto y coma, BOM adelante y \r\n.
func armarCsv(encabezados []string, filas [][]string, totales []string) string {
	lineas := make([]string, 0, len(filas)+2)
	enc := make([]string, len(encabezados))
	for i, e := range encabezados {
		enc[i] = texto(e)
	}
	lineas = append(lineas, strings.Join(enc, ";"))
	for _, f := range filas {
		lineas = append(lineas, strings.Join(f, ";"))
	}
	if totales != nil {
		lineas = append(lineas, strings.Join(totales, ";"))
	}
	return "\ufeff" + strings.Join(lineas, "\r\n") + "\r\n"
}

// Periodo es leerPeriodoMensual de lib/periodos.ts, en UTC (la zona de Next
// en producción): el mes pedido como «2026-03», o el de `ahora`.
type Periodo struct {
	Anio, Mes int
	Desde     time.Time
	Hasta     time.Time
	Clave     string
}

// LeerPeriodoMensual lee «aaaa-mm».
func LeerPeriodoMensual(valor string, ahora time.Time) Periodo {
	ahora = ahora.In(time.UTC)
	anioTexto, mesTexto, _ := strings.Cut(valor, "-")
	if i := strings.Index(mesTexto, "-"); i >= 0 {
		mesTexto = mesTexto[:i]
	}
	anio := int(numeroONulo(anioTexto))
	if anio == 0 {
		anio = ahora.Year()
	}
	mesCrudo := int(numeroONulo(mesTexto))
	if mesCrudo == 0 {
		mesCrudo = int(ahora.Month())
	}
	mes := min(max(mesCrudo, 1), 12)
	return Periodo{
		Anio:  anio,
		Mes:   mes,
		Desde: time.Date(anio, time.Month(mes), 1, 0, 0, 0, 0, time.UTC),
		Hasta: time.Date(anio, time.Month(mes)+1, 0, 23, 59, 59, 999_000_000, time.UTC),
		Clave: fmt.Sprintf("%d-%02d", anio, mes),
	}
}

// numeroONulo es `Number(t) || 0`, truncado como lo usa leerPeriodoMensual.
func numeroONulo(t string) float64 {
	n := jsmath.Numero(t)
	if math.IsNaN(n) {
		return 0
	}
	return n
}

// trimJS es String.prototype.trim (cuenta el BOM y no el NEL, al revés que Go).
func trimJS(s string) string {
	return strings.TrimFunc(s, func(r rune) bool {
		switch r {
		case '\t', '\n', '\v', '\f', '\r', ' ', 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff:
			return true
		}
		return r >= 0x2000 && r <= 0x200a
	})
}

// LeerFecha es `new Date(texto)` para lo que mandan los formularios: un día
// («2026-10-01», medianoche UTC, como lo lee JS) o un instante ISO. Lo demás
// no es una fecha.
func LeerFecha(t string) (time.Time, bool) {
	if f, err := time.Parse("2006-01-02", t); err == nil {
		return f, true
	}
	for _, formato := range []string{time.RFC3339Nano, "2006-01-02T15:04:05.000Z07:00", "2006-01-02T15:04Z07:00"} {
		if f, err := time.Parse(formato, t); err == nil {
			return f.UTC(), true
		}
	}
	return time.Time{}, false
}

// Vencimiento es el de cargarFacturaDeCompra: la emisión más los días de pago
// del proveedor (setDate en la zona de Next, UTC).
func Vencimiento(emision time.Time, dias int) time.Time {
	return emision.AddDate(0, 0, dias)
}
