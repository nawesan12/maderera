package reportes

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"mjbj/internal/api/reportesapi"
	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/documentos"
	"mjbj/internal/jsmath"
	"mjbj/internal/pdf"
	"mjbj/internal/plataforma"
	"mjbj/internal/reglas"
	"mjbj/internal/roles"
	"mjbj/internal/sqlc"
)

// API son las rutas de api/reportes.yaml.
type API struct {
	s       *Servicio
	interna plataforma.ConfigInterna
}

// NuevaAPI arma los handlers.
func NuevaAPI(s *Servicio, interna plataforma.ConfigInterna) *API {
	return &API{s: s, interna: interna}
}

var _ reportesapi.StrictServerInterface = (*API)(nil)

// respuesta escribe JSON o un archivo (el CSV como bytes: Next le pone sus
// cabeceras; el PDF con las suyas).
type respuesta struct {
	v      any
	datos  []byte
	tipo   string
	nombre string
}

func (o respuesta) escribir(w http.ResponseWriter) error {
	if o.tipo != "" {
		w.Header().Set("Content-Type", o.tipo)
		w.Header().Set("Content-Disposition", `attachment; filename="`+o.nombre+`"`)
		w.Header().Set("Cache-Control", "private, no-store")
		w.WriteHeader(http.StatusOK)
		_, err := bytes.NewReader(o.datos).WriteTo(w)
		return err
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	return json.NewEncoder(w).Encode(plataforma.SinNulos(o.v))
}

func ok(v any) respuesta { return respuesta{v: v} }
func csv(nombre, texto string) respuesta {
	return respuesta{datos: []byte(texto), tipo: "application/octet-stream", nombre: nombre}
}
func pdfDe(nombre string, b []byte) respuesta {
	return respuesta{datos: b, tipo: "application/pdf", nombre: nombre}
}

func (o respuesta) VisitAsientosDelPeriodoResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitAsientosCsvResponse(w http.ResponseWriter) error        { return o.escribir(w) }
func (o respuesta) VisitDeudoresCsvResponse(w http.ResponseWriter) error        { return o.escribir(w) }
func (o respuesta) VisitCuentasAPagarCsvResponse(w http.ResponseWriter) error   { return o.escribir(w) }
func (o respuesta) VisitPendientesDelCierreResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitResumenDelMesResponse(w http.ResponseWriter) error      { return o.escribir(w) }
func (o respuesta) VisitActividadRecienteResponse(w http.ResponseWriter) error  { return o.escribir(w) }
func (o respuesta) VisitMetricasDelResumenResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitPendientesDelRolResponse(w http.ResponseWriter) error   { return o.escribir(w) }
func (o respuesta) VisitNumerosDelDuenoResponse(w http.ResponseWriter) error    { return o.escribir(w) }
func (o respuesta) VisitCobranzasDelPeriodoResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitStockParaReponerResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitInicioVentasPorSucursalResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitReporteDeReposicionResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitReporteDeReposicionArchivoResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitReporteDeVentasResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitReporteDeVentasArchivoResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitVentasPorMesResponse(w http.ResponseWriter) error { return o.escribir(w) }

func pantalla(ctx context.Context, ruta string) (*auth.Sesion, error) {
	return auth.Exigir(ctx, roles.QuienEntra(ruta)...)
}

func texto[T ~string](p *T) string {
	if p == nil {
		return ""
	}
	return string(*p)
}

// --- el reporte de ventas ---

func (a *API) periodo(p *reportesapi.Periodo) Periodo {
	return ResolverPeriodo(LeerPeriodo(texto(p)), a.s.ahora())
}

func (a *API) ReporteDeVentas(ctx context.Context, r reportesapi.ReporteDeVentasRequestObject) (reportesapi.ReporteDeVentasResponseObject, error) {
	if _, err := pantalla(ctx, "/admin/reportes"); err != nil {
		return nil, err
	}
	v, err := a.s.ReporteDeVentas(ctx, texto(r.Params.Corte), a.periodo(r.Params.Periodo), Filtros{texto(r.Params.Rubro), texto(r.Params.Sucursal)})
	return ok(v), err
}

func (a *API) VentasPorMes(ctx context.Context, r reportesapi.VentasPorMesRequestObject) (reportesapi.VentasPorMesResponseObject, error) {
	if _, err := pantalla(ctx, "/admin/reportes"); err != nil {
		return nil, err
	}
	meses := 6
	if r.Params.Meses != nil {
		meses = *r.Params.Meses
	}
	v, err := a.s.VentasPorMes(ctx, a.periodo(r.Params.Periodo), Filtros{texto(r.Params.Rubro), texto(r.Params.Sucursal)}, meses)
	return ok(v), err
}

// ReporteDeVentasArchivo es app/admin/reportes/exportar: el CSV para
// trabajar o el PDF para mandar, de la misma consulta y el mismo filtro.
func (a *API) ReporteDeVentasArchivo(ctx context.Context, r reportesapi.ReporteDeVentasArchivoRequestObject) (reportesapi.ReporteDeVentasArchivoResponseObject, error) {
	if _, err := pantalla(ctx, "/admin/reportes"); err != nil {
		return nil, err
	}
	corte := LeerCorte(texto(r.Params.Corte))
	p := a.periodo(r.Params.Periodo)
	rubro, sucursal := texto(r.Params.Rubro), texto(r.Params.Sucursal)
	rep, err := a.s.ReporteDeVentas(ctx, corte, p, Filtros{rubro, sucursal})
	if err != nil {
		return nil, err
	}
	filas, t := rep.Filas, rep.Totales
	nombre := "ventas-" + corte + "-" + p.Clave
	if texto(r.Params.Formato) != "pdf" {
		return csv(nombre+".csv", CsvReporteDeVentas(corte, filas, t)), nil
	}
	emisor, err := documentos.EmisorDe(ctx, a.s.pool)
	if err != nil {
		return nil, err
	}
	d := pdf.DatosReporteVentas{Titulo: EtiquetaDeCorte(corte), Periodo: p.Etiqueta, Filtros: FiltrosDelPdf(rubro, sucursal), Emisor: emisor,
		Filas: make([]pdf.FilaDeReporte, len(filas)),
		Totales: &pdf.TotalesDelReporte{Total: t.Total, NetoVenta: t.NetoVenta, NetoCosteado: t.NetoCosteado, Costo: t.Costo,
			LineasSinCosto: t.LineasSinCosto}}
	for i, f := range filas {
		d.Filas[i] = pdf.FilaDeReporte{Clave: f.Clave, Etiqueta: f.Etiqueta, Detalle: f.Detalle, Cantidad: f.Cantidad, Total: f.Total,
			NetoVenta: f.NetoVenta, Costo: f.Costo, LineasSinCosto: f.LineasSinCosto, NetoCosteado: f.NetoCosteado}
	}
	b, err := pdf.ReporteDeVentas(d, a.s.ahora())
	if err != nil {
		return nil, err
	}
	return pdfDe(nombre+".pdf", b), nil
}

// CobranzasDelPeriodo: los recibos y los cobros en línea del período, para
// quien entra a /admin/pagos.
func (a *API) CobranzasDelPeriodo(ctx context.Context, r reportesapi.CobranzasDelPeriodoRequestObject) (reportesapi.CobranzasDelPeriodoResponseObject, error) {
	if _, err := pantalla(ctx, "/admin/pagos"); err != nil {
		return nil, err
	}
	limite, desplazamiento := 30, 0
	if r.Params.Limite != nil {
		limite = *r.Params.Limite
	}
	if r.Params.Desplazamiento != nil {
		desplazamiento = *r.Params.Desplazamiento
	}
	v, err := a.s.Cobranzas(ctx, a.periodo(r.Params.Periodo), limite, desplazamiento)
	return ok(v), err
}

// --- la reposición ---

func numeroDe[T ~string](p *T) float64 {
	n := jsmath.Numero(texto(p))
	if n != n {
		return 0
	}
	return n
}

func opcionesDeReposicion(dias *reportesapi.Dias, objetivo *reportesapi.Objetivo, cat *reportesapi.Categoria,
	rubro *reportesapi.RubroProducto, sucursal *reportesapi.SucursalSlug) OpcionesDeReposicion {
	return OpcionesDeReposicion{DiasDelPeriodo: LeerDias(numeroDe(dias)), CoberturaObjetivo: LeerObjetivo(numeroDe(objetivo)),
		Categoria: texto(cat), Rubro: texto(rubro), Sucursal: texto(sucursal)}
}

func (a *API) ReporteDeReposicion(ctx context.Context, r reportesapi.ReporteDeReposicionRequestObject) (reportesapi.ReporteDeReposicionResponseObject, error) {
	if _, err := pantalla(ctx, "/admin/reportes"); err != nil {
		return nil, err
	}
	q := r.Params
	v, err := a.s.Reposicion(ctx, opcionesDeReposicion(q.Dias, q.Objetivo, q.Cat, q.Rubro, q.Sucursal))
	return ok(v), err
}

// ReporteDeReposicionArchivo es app/admin/reportes/reposicion/exportar. El
// nombre del archivo lleva los días que se usaron de verdad (el TS ponía los
// de la URL aunque no fueran 30, 60 o 90).
func (a *API) ReporteDeReposicionArchivo(ctx context.Context, r reportesapi.ReporteDeReposicionArchivoRequestObject) (reportesapi.ReporteDeReposicionArchivoResponseObject, error) {
	if _, err := pantalla(ctx, "/admin/reportes"); err != nil {
		return nil, err
	}
	q := r.Params
	o := opcionesDeReposicion(q.Dias, q.Objetivo, q.Cat, q.Rubro, q.Sucursal)
	rep, err := a.s.Reposicion(ctx, o)
	if err != nil {
		return nil, err
	}
	nombre := "reposicion-" + jsmath.Texto(o.DiasDelPeriodo) + "dias"
	if texto(q.Formato) != "pdf" {
		return csv(nombre+".csv", CsvReposicionPorSucursal(rep)), nil
	}
	d := pdf.ReporteDeReposicion{DiasDelPeriodo: rep.DiasDelPeriodo, CoberturaObjetivo: rep.CoberturaObjetivo,
		Filas: make([]pdf.FilaDeReposicion, len(rep.Filas))}
	for i, f := range rep.Filas {
		d.Filas[i] = pdf.FilaDeReposicion{Producto: f.Producto, Medida: f.Medida, Rubro: f.Rubro, DisponibleCentral: f.DisponibleCentral,
			DisponibleAserradero: f.DisponibleAserradero, Vendido: f.Vendido, Sugerido: f.Sugerido}
	}
	b, err := pdf.Reposicion(d, a.s.ahora())
	if err != nil {
		return nil, err
	}
	return pdfDe(nombre+".pdf", b), nil
}

// --- el cierre del mes ---

func (a *API) mes(p *reportesapi.Mes) PeriodoMensual {
	return PeriodoDelCierre(texto(p), a.s.ahora())
}

func (a *API) AsientosDelPeriodo(ctx context.Context, r reportesapi.AsientosDelPeriodoRequestObject) (reportesapi.AsientosDelPeriodoResponseObject, error) {
	if _, err := pantalla(ctx, "/admin/cierre"); err != nil {
		return nil, err
	}
	p := a.mes(r.Params.Periodo)
	v, err := a.s.AsientosDelPeriodo(ctx, p.Desde, p.Hasta)
	return ok(DelCircuito(v, texto(r.Params.Circuito))), err
}

func (a *API) AsientosCsv(ctx context.Context, r reportesapi.AsientosCsvRequestObject) (reportesapi.AsientosCsvResponseObject, error) {
	if _, err := pantalla(ctx, "/admin/cierre"); err != nil {
		return nil, err
	}
	p := a.mes(r.Params.Periodo)
	v, err := a.s.AsientosDelPeriodo(ctx, p.Desde, p.Hasta)
	if err != nil {
		return nil, err
	}
	// El del circuito B es otro archivo, con la B en el nombre: que nadie
	// le mande al estudio el equivocado.
	if circuito := texto(r.Params.Circuito); circuito == CircuitoNegro {
		return csv("asientos-B-"+p.Clave+".csv", CsvAsientos(v, CircuitoNegro)), nil
	}
	return csv("asientos-"+p.Clave+".csv", CsvAsientos(v, "blanco")), nil
}

func (a *API) PendientesDelCierre(ctx context.Context, r reportesapi.PendientesDelCierreRequestObject) (reportesapi.PendientesDelCierreResponseObject, error) {
	if _, err := pantalla(ctx, "/admin/cierre"); err != nil {
		return nil, err
	}
	p := a.mes(r.Params.Periodo)
	v, err := a.s.PendientesDelCierre(ctx, p.Desde, p.Hasta)
	if err != nil {
		return nil, err
	}
	// La palabra del circuito sin factura la pone la regla (H167).
	if regla, _ := reglas.Valor(ctx, a.s.pool, reglas.EtiquetaDelCircuito); regla != "b" {
		for i := range v {
			v[i].Titulo = reglas.EnElTexto(v[i].Titulo, regla)
			v[i].Detalle = reglas.EnElTexto(v[i].Detalle, regla)
		}
	}
	return ok(v), nil
}

func (a *API) ResumenDelMes(ctx context.Context, r reportesapi.ResumenDelMesRequestObject) (reportesapi.ResumenDelMesResponseObject, error) {
	if _, err := pantalla(ctx, "/admin/cierre"); err != nil {
		return nil, err
	}
	p := a.mes(r.Params.Periodo)
	v, err := a.s.ResumenDelMes(ctx, p.Desde, p.Hasta)
	if err != nil {
		return nil, err
	}
	v.Resultado, err = a.s.ResultadoDelMes(ctx, p)
	if err != nil {
		return nil, err
	}
	v.Cerrado, err = a.s.EstadoDelMes(ctx, p.Clave)
	return ok(v), err
}

func (o respuesta) VisitCerrarElMesResponse(w http.ResponseWriter) error { return o.escribir(w) }

func (a *API) CerrarElMes(ctx context.Context, r reportesapi.CerrarElMesRequestObject) (reportesapi.CerrarElMesResponseObject, error) {
	ses, err := pantalla(ctx, "/admin/cierre")
	if err != nil {
		return nil, err
	}
	// Reabrir un mes cambia lo que el estudio ya tiene: pide por qué (mes
	// simulado, M2S1-056), y queda en la bitácora.
	motivo := ""
	if r.Body.Motivo != nil {
		motivo = strings.TrimSpace(*r.Body.Motivo)
	}
	if !r.Body.Cerrado && motivo == "" {
		return nil, plataforma.Invalido(map[string]string{"motivo": "Escribí por qué se reabre el mes."})
	}
	v, err := a.s.CerrarElMes(ctx, r.Body.Periodo, r.Body.Cerrado, ses.UserID, ses.Nombre)
	if err != nil {
		return nil, err
	}
	texto := "Cerró " + plataforma.NombreDelMes(r.Body.Periodo)
	if !r.Body.Cerrado {
		texto = "Reabrió " + plataforma.NombreDelMes(r.Body.Periodo) + ": " + motivo
	}
	var detalle map[string]any
	if motivo != "" {
		detalle = map[string]any{"motivo": motivo}
	}
	bitacora.Anotar(ctx, sqlc.New(a.s.pool), a.s.log, ses, sqlc.AccionAuditoriaEditar, "cierre", r.Body.Periodo, texto, detalle)
	return ok(v), nil
}

// --- el inicio del panel ---

// numerosDelNegocio: las métricas las ve solo el admin (la pantalla las
// esconde al resto: hay facturación y lo que falta cobrar).
func numerosDelNegocio(ctx context.Context) error {
	_, err := auth.Exigir(ctx, sqlc.StaffRoleAdmin)
	return err
}

func (a *API) MetricasDelResumen(ctx context.Context, r reportesapi.MetricasDelResumenRequestObject) (reportesapi.MetricasDelResumenResponseObject, error) {
	if err := numerosDelNegocio(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.MetricasDelResumen(ctx, a.periodo(r.Params.Periodo))
	return ok(v), err
}

// NumerosDelDueno: me deben, debo, cheques, plata y ganancia. Solo el admin.
func (a *API) NumerosDelDueno(ctx context.Context, _ reportesapi.NumerosDelDuenoRequestObject) (reportesapi.NumerosDelDuenoResponseObject, error) {
	if err := numerosDelNegocio(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.NumerosDelDueno(ctx)
	return ok(v), err
}

func (a *API) InicioVentasPorSucursal(ctx context.Context, _ reportesapi.InicioVentasPorSucursalRequestObject) (reportesapi.InicioVentasPorSucursalResponseObject, error) {
	if err := numerosDelNegocio(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.VentasPorSucursal(ctx)
	return ok(v), err
}

func (a *API) StockParaReponer(ctx context.Context, r reportesapi.StockParaReponerRequestObject) (reportesapi.StockParaReponerResponseObject, error) {
	if err := numerosDelNegocio(ctx); err != nil {
		return nil, err
	}
	limite := 5
	if r.Params.Limite != nil {
		limite = *r.Params.Limite
	}
	v, err := a.s.StockParaReponer(ctx, limite)
	return ok(v), err
}

func (a *API) ActividadReciente(ctx context.Context, _ reportesapi.ActividadRecienteRequestObject) (reportesapi.ActividadRecienteResponseObject, error) {
	if err := numerosDelNegocio(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.ActividadReciente(ctx)
	return ok(v), err
}

// PendientesDelRol: el de la sesión, o —solo con el secreto interno— el del
// rol pedido (la tarea del parte del día corre sin nadie logueado).
func (a *API) PendientesDelRol(ctx context.Context, r reportesapi.PendientesDelRolRequestObject) (reportesapi.PendientesDelRolResponseObject, error) {
	if r.Params.Rol != nil && a.interna.EsInterno(plataforma.PedidoDe(ctx)) {
		v, err := a.s.PendientesDelRol(ctx, sqlc.StaffRole(*r.Params.Rol))
		return ok(v), err
	}
	ses, err := pantalla(ctx, "/admin")
	if err != nil {
		return nil, err
	}
	if ses.RolStaff == nil {
		return ok([]Pendiente{}), nil
	}
	v, err := a.s.PendientesDelRol(ctx, *ses.RolStaff)
	return ok(v), err
}

// DeudoresCsv y CuentasAPagarCsv: los listados del contador. Solo el admin.
func (a *API) DeudoresCsv(ctx context.Context, _ reportesapi.DeudoresCsvRequestObject) (reportesapi.DeudoresCsvResponseObject, error) {
	if err := numerosDelNegocio(ctx); err != nil {
		return nil, err
	}
	ahora := a.s.ahora()
	v, err := a.s.CsvDeudores(ctx, ahora)
	if err != nil {
		return nil, err
	}
	return csv(ArchivoDelDia("deudores", ahora), v), nil
}

func (a *API) CuentasAPagarCsv(ctx context.Context, _ reportesapi.CuentasAPagarCsvRequestObject) (reportesapi.CuentasAPagarCsvResponseObject, error) {
	if err := numerosDelNegocio(ctx); err != nil {
		return nil, err
	}
	ahora := a.s.ahora()
	v, err := a.s.CsvCuentasAPagar(ctx, ahora)
	if err != nil {
		return nil, err
	}
	return csv(ArchivoDelDia("cuentas-a-pagar", ahora), v), nil
}

// ArchivoDelDia es el nombre del CSV con el día argentino: el de la API y el
// del cierre se llamaban distinto bajados en el mismo minuto, a las 23:49 del
// 26 (mes simulado, M2S3-082).
func ArchivoDelDia(prefijo string, ahora time.Time) string {
	return prefijo + "-" + ahora.In(Argentina).Format("2006-01-02") + ".csv"
}
