// Package reportes son los números del panel que leen ventas y caja: el
// reporte de ventas (lib/dal/admin/reportes.ts), la reposición
// (lib/dal/admin/reposicion.ts y lib/reposicion.ts), el cierre del mes
// (lib/dal/admin/cierre-mensual.ts y lib/contable/asientos.ts) y el inicio
// del panel (lib/dal/admin/resumen.ts y lib/dal/admin/pendientes.ts).
//
// Este archivo es lo puro, con golden contra el TS
// (scripts/golden/reportes.ts → testdata/golden/reportes).
package reportes

import (
	"math"
	"sort"
	"strings"
	"time"

	"mjbj/internal/csvexcel"
	"mjbj/internal/jsmath"
)

// Argentina es la zona del negocio.
var Argentina = func() *time.Location {
	l, err := time.LoadLocation("America/Argentina/Buenos_Aires")
	if err != nil {
		return time.FixedZone("ART", -3*3600)
	}
	return l
}()

// --- la reposición (lib/reposicion.ts) ---

// VentaDiaria es ventaDiaria: el ritmo del período.
func VentaDiaria(vendido, dias float64) float64 {
	if dias <= 0 || vendido <= 0 {
		return 0
	}
	return vendido / dias
}

// DiasDeCobertura es diasDeCobertura: nil sin ventas.
func DiasDeCobertura(disponible, vendido, dias float64) *float64 {
	ritmo := VentaDiaria(vendido, dias)
	if ritmo <= 0 {
		return nil
	}
	c := jsmath.Round(math.Max(disponible, 0) / ritmo)
	return &c
}

// SugerenciaDeCompra es sugerenciaDeCompra: hasta la cobertura objetivo,
// para arriba (media placa no se compra).
func SugerenciaDeCompra(disponible, vendido, dias, objetivo float64) float64 {
	ritmo := VentaDiaria(vendido, dias)
	if ritmo <= 0 || objetivo <= 0 {
		return 0
	}
	meta := float64(ritmo * objetivo)
	faltante := meta - math.Max(disponible, 0)
	if faltante > 0 {
		return math.Ceil(faltante)
	}
	return 0
}

// StockDeVariante es una fila de la consulta del stock de la reposición.
type StockDeVariante struct {
	VariantID            string  `json:"variantId"`
	ProductID            string  `json:"productId"`
	Producto             string  `json:"producto"`
	Medida               string  `json:"medida"`
	Sku                  *string `json:"sku"`
	Unidad               string  `json:"unidad"`
	Categoria            string  `json:"categoria"`
	CategoriaSlug        string  `json:"categoriaSlug"`
	Rubro                *string `json:"rubro"`
	DisponibleCentral    float64 `json:"disponibleCentral"`
	DisponibleAserradero float64 `json:"disponibleAserradero"`
}

// FilaDeReposicion es FilaDeReposicion del TS.
type FilaDeReposicion struct {
	StockDeVariante
	Disponible float64  `json:"disponible"`
	Vendido    float64  `json:"vendido"`
	Cobertura  *float64 `json:"cobertura"`
	Sugerido   float64  `json:"sugerido"`
}

// VendidoPorCategoria es un renglón del gráfico.
type VendidoPorCategoria struct {
	Nombre  string  `json:"nombre"`
	Vendido float64 `json:"vendido"`
}

// ReporteDeReposicion es ReporteDeReposicion del TS.
type ReporteDeReposicion struct {
	Filas             []FilaDeReposicion    `json:"filas"`
	PorCategoria      []VendidoPorCategoria `json:"porCategoria"`
	DiasDelPeriodo    float64               `json:"diasDelPeriodo"`
	CoberturaObjetivo float64               `json:"coberturaObjetivo"`
}

// ArmarReposicion es la parte de reporteDeReposicion que no consulta: cada
// fila con su cobertura y su sugerencia, en el orden en que se decide
// (primero lo que hay que comprar, por urgencia; después lo que se vendió;
// al final lo que no se movió) y lo vendido por categoría.
func ArmarReposicion(stock []StockDeVariante, vendido map[string]float64, dias, objetivo float64, sucursal string) ReporteDeReposicion {
	filas := make([]FilaDeReposicion, len(stock))
	for i, s := range stock {
		disponible := float64(s.DisponibleCentral + s.DisponibleAserradero)
		switch sucursal {
		case "casa-central":
			disponible = s.DisponibleCentral
		case "aserradero":
			disponible = s.DisponibleAserradero
		}
		v := vendido[s.VariantID]
		filas[i] = FilaDeReposicion{StockDeVariante: s, Disponible: disponible, Vendido: v,
			Cobertura: DiasDeCobertura(disponible, v, dias), Sugerido: SugerenciaDeCompra(disponible, v, dias, objetivo)}
	}
	cero := func(p *float64) float64 {
		if p == nil {
			return 0
		}
		return *p
	}
	sort.SliceStable(filas, func(i, j int) bool {
		a, b := filas[i], filas[j]
		if (a.Sugerido > 0) != (b.Sugerido > 0) {
			return a.Sugerido > 0
		}
		if a.Sugerido > 0 && b.Sugerido > 0 {
			return cero(a.Cobertura)-cero(b.Cobertura) < 0
		}
		return b.Vendido-a.Vendido < 0
	})

	orden := []string{}
	suma := map[string]float64{}
	for _, f := range filas {
		if _, ya := suma[f.Categoria]; !ya {
			orden = append(orden, f.Categoria)
		}
		suma[f.Categoria] = float64(suma[f.Categoria] + f.Vendido)
	}
	porCategoria := []VendidoPorCategoria{}
	for _, nombre := range orden {
		if suma[nombre] > 0 {
			porCategoria = append(porCategoria, VendidoPorCategoria{nombre, suma[nombre]})
		}
	}
	sort.SliceStable(porCategoria, func(i, j int) bool { return porCategoria[j].Vendido-porCategoria[i].Vendido < 0 })
	return ReporteDeReposicion{Filas: filas, PorCategoria: porCategoria, DiasDelPeriodo: dias, CoberturaObjetivo: objetivo}
}

// celdaReposicion es la de app/admin/reportes/reposicion/exportar: entre
// comillas solo si tiene ; " o salto de línea.
func celdaReposicion(t string) string {
	if strings.ContainsAny(t, ";\"\n") {
		return `"` + strings.ReplaceAll(t, `"`, `""`) + `"`
	}
	return t
}

// CsvReposicion es el CSV de la reposición (sin CRLF al final, como el TS).
func CsvReposicion(r ReporteDeReposicion) string {
	lineas := []string{"Producto;Medida;Código;Categoría;Rubro;Central;Aserradero;Vendido;Cobertura (días);Comprar"}
	de := func(p *string) string {
		if p == nil {
			return ""
		}
		return *p
	}
	for _, f := range r.Filas {
		cob := ""
		if f.Cobertura != nil {
			cob = jsmath.Texto(*f.Cobertura)
		}
		celdas := []string{f.Producto, f.Medida, de(f.Sku), f.Categoria, de(f.Rubro),
			jsmath.Texto(f.DisponibleCentral), jsmath.Texto(f.DisponibleAserradero), jsmath.Texto(f.Vendido), cob, jsmath.Texto(f.Sugerido)}
		for i := range celdas {
			celdas[i] = celdaReposicion(celdas[i])
		}
		lineas = append(lineas, strings.Join(celdas, ";"))
	}
	return "\ufeff" + strings.Join(lineas, "\r\n")
}

// --- el reporte de ventas ---

// Corte es por dónde se corta el reporte (lib/reportes-cortes.ts).
type Corte struct {
	Clave    string `json:"clave"`
	Etiqueta string `json:"etiqueta"`
}

// Cortes es CORTES, en el mismo orden.
var Cortes = []Corte{
	{"producto", "Por producto"}, {"rubro", "Por rubro"}, {"elaboracion", "Elaborado vs. bruto"},
	{"cliente", "Por cliente"}, {"vendedor", "Por vendedor"}, {"sucursal", "Por sucursal"}, {"canal", "Por canal"},
}

// LeerCorte es leerCorte: lo que no existe es «producto».
func LeerCorte(v string) string {
	for _, c := range Cortes {
		if c.Clave == v {
			return v
		}
	}
	return "producto"
}

// EtiquetaDeCorte es la etiqueta del corte, «Por producto» si no está.
func EtiquetaDeCorte(clave string) string {
	for _, c := range Cortes {
		if c.Clave == clave {
			return c.Etiqueta
		}
	}
	return "Por producto"
}

// FilaDeReporte es FilaDeReporte del TS.
type FilaDeReporte struct {
	Clave          string   `json:"clave"`
	Etiqueta       string   `json:"etiqueta"`
	Detalle        *string  `json:"detalle"`
	Cantidad       float64  `json:"cantidad"`
	Total          float64  `json:"total"`
	NetoVenta      float64  `json:"netoVenta"`
	Costo          *float64 `json:"costo"`
	LineasSinCosto float64  `json:"lineasSinCosto"`
}

// Plural es plural de lib/formato.ts.
func Plural(n float64, singular, plural string) string {
	if plural == "" {
		plural = singular + "s"
	}
	if n == 1 {
		return jsmath.Texto(n) + " " + singular
	}
	return jsmath.Texto(n) + " " + plural
}

// CsvReporteDeVentas es el CSV de app/admin/reportes/exportar.
func CsvReporteDeVentas(corte string, filas []FilaDeReporte) string {
	numero := func(v float64) string { return csvexcel.NumeroCsv(v, 2) }
	texto := func(v *string) string { return csvexcel.TextoCsv(v) }
	t := func(v string) string { return csvexcel.Texto(v) }
	entero := csvexcel.EnteroCsv
	cantidad := entero
	if corte == "producto" {
		cantidad = numero
	}
	sinPrefijo := strings.Replace(EtiquetaDeCorte(corte), "Por ", "", 1)
	encabezado := strings.ToUpper(sinPrefijo[:1]) + sinPrefijo[1:]
	unidades := "Operaciones"
	if corte == "producto" {
		unidades = "Unidades"
	}
	lineas := []string{strings.Join([]string{t(encabezado), t("Detalle"), t(unidades), t("Total"), t("Neto sin IVA"),
		t("Costo"), t("Margen"), t("Renglones sin costo")}, ";")}
	for _, f := range filas {
		costo, margen := "", ""
		if f.Costo != nil {
			costo = numero(*f.Costo)
			margen = numero(f.NetoVenta - *f.Costo)
		}
		lineas = append(lineas, strings.Join([]string{t(f.Etiqueta), texto(f.Detalle), cantidad(f.Cantidad), numero(f.Total),
			numero(f.NetoVenta), costo, margen, entero(f.LineasSinCosto)}, ";"))
	}
	var total, netoTotal, costoTotal, sinCosto float64
	costeados := 0
	for _, f := range filas {
		total = float64(total + f.Total)
		sinCosto = float64(sinCosto + f.LineasSinCosto)
		if f.Costo != nil {
			costeados++
			netoTotal = float64(netoTotal + f.NetoVenta)
			costoTotal = float64(costoTotal + *f.Costo)
		}
	}
	costo, margen := "", ""
	if costeados > 0 {
		costo = numero(costoTotal)
		margen = numero(netoTotal - costoTotal)
	}
	lineas = append(lineas, strings.Join([]string{t("Total"), t(""), t(""), numero(total), numero(netoTotal), costo, margen, entero(sinCosto)}, ";"))
	return "\ufeff" + strings.Join(lineas, "\r\n") + "\r\n"
}

// RubrosCliente es RUBROS_CLIENTE de lib/rubros-cliente.ts (valor → etiqueta).
var RubrosCliente = [][2]string{
	{"particular", "Particular"}, {"arquitecto", "Arquitectura"}, {"carpintero", "Carpintería"}, {"cementista", "Cementista"},
	{"constructora", "Constructora"}, {"woodframer", "Wood frame"}, {"moldava", "Moldava"}, {"disenador", "Diseño de interiores"},
	{"instalador", "Instalación y colocación"}, {"otro", "Otro"},
}

// EtiquetaDeRubro es etiquetaDeRubro.
func EtiquetaDeRubro(v string) string {
	if v == "" {
		return "Sin rubro"
	}
	for _, r := range RubrosCliente {
		if r[0] == v {
			return r[1]
		}
	}
	return v
}

// FiltrosDelPdf es el renglón «lo que acota el reporte» del PDF. El TS
// escribía «todos» cuando la URL traía rubro=todos (que no filtra nada);
// acá un filtro que no filtra no se escribe.
func FiltrosDelPdf(rubro, sucursal string) *string {
	partes := []string{}
	if rubro != "" && rubro != "todos" {
		partes = append(partes, EtiquetaDeRubro(rubro))
	}
	if sucursal != "" && sucursal != "todas" {
		partes = append(partes, "Una sucursal")
	}
	if len(partes) == 0 {
		return nil
	}
	s := strings.Join(partes, " · ")
	return &s
}

// MesDelReporte es MesDelReporte del TS.
type MesDelReporte struct {
	Clave    string  `json:"clave"`
	Etiqueta string  `json:"etiqueta"`
	Total    float64 `json:"total"`
}

// mesesCortos son los de toLocaleDateString("es-AR", { month: "short" }).
var mesesCortos = [12]string{"ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"}

func claveDeMes(t time.Time) string {
	return t.Format("2006-01")
}

// SerieDeMeses es la serie de ventasPorMes, armada desde el calendario
// (hora argentina): los meses sin ventas van en cero, hasta 24.
//
// El TS recorría mientras el mes fuera <= hasta, y `hasta` es exclusivo: en
// «mes pasado» (hasta el 1.º de este mes a las 0) el gráfico sumaba el mes
// en curso, en cero, como si no se hubiera vendido nada. Acá, con un hasta
// dado, el mes que empieza justo ahí no entra.
func SerieDeMeses(desde, hasta *time.Time, ahora time.Time, meses int, porMes map[string]float64) []MesDelReporte {
	fin := ahora.In(Argentina)
	exclusivo := hasta != nil
	if hasta != nil {
		fin = hasta.In(Argentina)
	}
	var inicio time.Time
	if desde != nil {
		inicio = desde.In(Argentina)
	} else {
		inicio = time.Date(fin.Year(), fin.Month()-time.Month(meses-1), 1, 0, 0, 0, 0, Argentina)
	}
	cursor := time.Date(inicio.Year(), inicio.Month(), 1, 0, 0, 0, 0, Argentina)
	serie := []MesDelReporte{}
	for (cursor.Before(fin) || (!exclusivo && cursor.Equal(fin))) && len(serie) < 24 {
		clave := claveDeMes(cursor)
		serie = append(serie, MesDelReporte{Clave: clave, Etiqueta: mesesCortos[cursor.Month()-1], Total: porMes[clave]})
		cursor = time.Date(cursor.Year(), cursor.Month()+1, 1, 0, 0, 0, 0, Argentina)
	}
	return serie
}

// --- el inicio del panel ---

// Variacion es la variación del resumen: un decimal, nil sin mes anterior.
func Variacion(actual, previo float64) *float64 {
	if !(previo > 0) {
		return nil
	}
	v := jsmath.Round(float64((actual-previo)/previo)*1000) / 10
	return &v
}

// mesesDelResumen son los rótulos del gráfico del resumen.
var mesesDelResumen = [12]string{"Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"}

// InicioDeMes es inicioDeMes del resumen: el 1.º del mes, hace `atras`
// meses, en hora argentina.
func InicioDeMes(ahora time.Time, atras int) time.Time {
	a := ahora.In(Argentina)
	return time.Date(a.Year(), a.Month()-time.Month(atras), 1, 0, 0, 0, 0, Argentina)
}

// --- los períodos (lib/periodos.ts), en hora argentina ---

// Periodo es Periodo de lib/periodos.ts.
type Periodo struct {
	Clave    string
	Etiqueta string
	Desde    *time.Time
	Hasta    *time.Time
	// Anterior: el mismo lapso inmediatamente antes (nil en «todo»).
	AnteriorDesde, AnteriorHasta *time.Time
}

var periodos = [][2]string{{"mes", "Este mes"}, {"mes-pasado", "Mes pasado"}, {"trimestre", "Últimos 90 días"}, {"anio", "Este año"}, {"todo", "Todo"}}

// LeerPeriodo es leerPeriodo: lo raro es «mes».
func LeerPeriodo(v string) string {
	for _, p := range periodos {
		if p[0] == v {
			return v
		}
	}
	return "mes"
}

func ptr(t time.Time) *time.Time { return &t }

// ResolverPeriodo es resolverPeriodo, con «este mes» y «hoy» en hora
// argentina. El TS corría en la zona de Next (UTC en producción): el mes
// empezaba el último día del mes anterior a las 21.
func ResolverPeriodo(clave string, ahora time.Time) Periodo {
	etiqueta := "Este mes"
	for _, p := range periodos {
		if p[0] == clave {
			etiqueta = p[1]
		}
	}
	p := Periodo{Clave: clave, Etiqueta: etiqueta}
	a := ahora.In(Argentina)
	switch clave {
	case "todo":
		return p
	case "mes-pasado":
		p.Desde, p.Hasta = ptr(InicioDeMes(ahora, 1)), ptr(InicioDeMes(ahora, 0))
		p.AnteriorDesde, p.AnteriorHasta = ptr(InicioDeMes(ahora, 2)), p.Desde
	case "trimestre":
		d := a.AddDate(0, 0, -90)
		d = time.Date(d.Year(), d.Month(), d.Day(), 0, 0, 0, 0, Argentina)
		ad := d.AddDate(0, 0, -90)
		p.Desde, p.AnteriorDesde, p.AnteriorHasta = &d, &ad, &d
	case "anio":
		d := time.Date(a.Year(), 1, 1, 0, 0, 0, 0, Argentina)
		ad := time.Date(a.Year()-1, 1, 1, 0, 0, 0, 0, Argentina)
		p.Desde, p.AnteriorDesde, p.AnteriorHasta = &d, &ad, &d
	default:
		p.Clave = clave
		p.Desde = ptr(InicioDeMes(ahora, 0))
		p.AnteriorDesde, p.AnteriorHasta = ptr(InicioDeMes(ahora, 1)), p.Desde
	}
	return p
}

// PeriodoMensual es leerPeriodoMensual.
type PeriodoMensual struct {
	Anio, Mes int
	Desde     time.Time
	Hasta     time.Time
	Clave     string
}

// LeerPeriodoMensual es leerPeriodoMensual en la zona dada: «aaaa-mm», o el
// mes de `ahora`.
func LeerPeriodoMensual(valor string, ahora time.Time, zona *time.Location) PeriodoMensual {
	a := ahora.In(zona)
	anioTexto, resto, _ := strings.Cut(valor, "-")
	mesTexto, _, _ := strings.Cut(resto, "-")
	anio := int(numeroONulo(anioTexto))
	if anio == 0 {
		anio = a.Year()
	}
	mesCrudo := int(numeroONulo(mesTexto))
	if mesCrudo == 0 {
		mesCrudo = int(a.Month())
	}
	mes := min(max(mesCrudo, 1), 12)
	return PeriodoMensual{Anio: anio, Mes: mes,
		Desde: time.Date(anio, time.Month(mes), 1, 0, 0, 0, 0, zona),
		Hasta: time.Date(anio, time.Month(mes)+1, 0, 23, 59, 59, 999_000_000, zona),
		Clave: jsmath.Texto(float64(anio)) + "-" + dos(mes)}
}

func dos(n int) string {
	if n < 10 && n >= 0 {
		return "0" + jsmath.Texto(float64(n))
	}
	return jsmath.Texto(float64(n))
}

// numeroONulo es `Number(t) || 0`.
func numeroONulo(t string) float64 {
	n := jsmath.Numero(t)
	if math.IsNaN(n) {
		return 0
	}
	return n
}
