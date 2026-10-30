package compras

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"time"

	"mjbj/internal/api/comprasapi"
	"mjbj/internal/auth"
	"mjbj/internal/documentos"
	"mjbj/internal/pdf"
	"mjbj/internal/plataforma"
	"mjbj/internal/roles"
	"mjbj/internal/sqlc"
)

// API son las rutas de api/compras.yaml.
type API struct{ s *Servicio }

// NuevaAPI arma los handlers.
func NuevaAPI(s *Servicio) *API { return &API{s: s} }

var _ comprasapi.StrictServerInterface = (*API)(nil)

// respuesta escribe JSON, un 204 o un archivo CSV.
type respuesta struct {
	codigo int
	v      any
	csv    string
	nombre string
}

func (o respuesta) escribir(w http.ResponseWriter) error {
	switch {
	case o.codigo == http.StatusNoContent:
		w.WriteHeader(o.codigo)
		return nil
	case o.nombre != "":
		// El CSV va como bytes: Next le pone sus cabeceras (cabecerasCsv).
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Content-Disposition", `attachment; filename="`+o.nombre+`"`)
		w.Header().Set("Cache-Control", "private, no-store")
		w.WriteHeader(http.StatusOK)
		_, err := io.WriteString(w, o.csv)
		return err
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(o.codigo)
	return json.NewEncoder(w).Encode(plataforma.SinNulos(o.v))
}

func ok(v any) respuesta { return respuesta{codigo: http.StatusOK, v: v} }
func vacio() respuesta   { return respuesta{codigo: http.StatusNoContent} }
func hecho(m string) respuesta {
	return ok(map[string]string{"ok": m})
}

func (o respuesta) VisitCertificadoDeRetencionResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitListarFacturasDeCompraResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitCargarFacturaDeCompraResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitListarGastosResponse(w http.ResponseWriter) error       { return o.escribir(w) }
func (o respuesta) VisitCargarGastoResponse(w http.ResponseWriter) error        { return o.escribir(w) }
func (o respuesta) VisitGastosPorCategoriaResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitGastosPorCircuitoResponse(w http.ResponseWriter) error  { return o.escribir(w) }
func (o respuesta) VisitSucursalesParaGastoResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitLibroIvaComprasResponse(w http.ResponseWriter) error    { return o.escribir(w) }
func (o respuesta) VisitLibroIvaComprasCsvResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitAplicarListaResponse(w http.ResponseWriter) error       { return o.escribir(w) }
func (o respuesta) VisitVistaPreviaDeListaResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitBuscarMercaderiaResponse(w http.ResponseWriter) error   { return o.escribir(w) }
func (o respuesta) VisitListarOrdenesDeCompraResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitCrearOrdenDeCompraResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitOrdenDeCompraResponse(w http.ResponseWriter) error      { return o.escribir(w) }
func (o respuesta) VisitAnularOrdenDeCompraResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitMarcarOrdenEnviadaResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitRecibirDeLaOrdenResponse(w http.ResponseWriter) error   { return o.escribir(w) }
func (o respuesta) VisitListarPagosAProveedoresResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitPagarAProveedorResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitAnularPagoAProveedorResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}

// archivoPdf es un PDF para mostrar en el navegador.
type archivoPdf struct {
	nombre string
	datos  []byte
}

func (a archivoPdf) VisitCertificadoDeRetencionPdfResponse(w http.ResponseWriter) error {
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", `inline; filename="`+a.nombre+`"`)
	w.Header().Set("Cache-Control", "private, no-store")
	w.WriteHeader(http.StatusOK)
	_, err := w.Write(a.datos)
	return err
}
func (o respuesta) VisitRetencionesPracticadasCsvResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitLoQueEstaPorLlegarResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitProveedoresParaElegirResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitRegimenesDeRetencionResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitGuardarRegimenResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitRetencionesSufridasResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitCreditoPorRetencionesResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitListarProveedoresResponse(w http.ResponseWriter) error  { return o.escribir(w) }
func (o respuesta) VisitGuardarProveedorResponse(w http.ResponseWriter) error   { return o.escribir(w) }
func (o respuesta) VisitFichaDeProveedorResponse(w http.ResponseWriter) error   { return o.escribir(w) }
func (o respuesta) VisitAcumuladoDelMesResponse(w http.ResponseWriter) error    { return o.escribir(w) }
func (o respuesta) VisitDarDeBajaProveedorResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitCondicionesDelProveedorResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitGuardarCondicionResponse(w http.ResponseWriter) error   { return o.escribir(w) }
func (o respuesta) VisitBorrarCondicionResponse(w http.ResponseWriter) error    { return o.escribir(w) }
func (o respuesta) VisitGuardarConveniosResponse(w http.ResponseWriter) error   { return o.escribir(w) }
func (o respuesta) VisitFacturasConSaldoResponse(w http.ResponseWriter) error   { return o.escribir(w) }
func (o respuesta) VisitPerfilDeListaResponse(w http.ResponseWriter) error      { return o.escribir(w) }
func (o respuesta) VisitListarRecepcionesResponse(w http.ResponseWriter) error  { return o.escribir(w) }
func (o respuesta) VisitCrearRecepcionResponse(w http.ResponseWriter) error     { return o.escribir(w) }
func (o respuesta) VisitRecepcionResponse(w http.ResponseWriter) error          { return o.escribir(w) }
func (o respuesta) VisitAnularRecepcionResponse(w http.ResponseWriter) error    { return o.escribir(w) }
func (o respuesta) VisitConfirmarRecepcionResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitRegistrarMovimientoDeProveedorResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}

// Los permisos: los de cada pantalla (todas del admin); leer la lista de
// proveedores, su ficha y sus condiciones, cualquier persona del panel.
func admin(ctx context.Context, pantalla string) (*auth.Sesion, error) {
	return auth.Exigir(ctx, roles.QuienEntra(pantalla)...)
}
func compras(ctx context.Context) (*auth.Sesion, error)     { return admin(ctx, "/admin/compras") }
func proveedores(ctx context.Context) (*auth.Sesion, error) { return admin(ctx, "/admin/proveedores") }
func recepciones(ctx context.Context) (*auth.Sesion, error) { return admin(ctx, "/admin/recepciones") }

func deTexto(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func limite(p *int, def int) int {
	if p == nil {
		return def
	}
	return *p
}

// campos pasa el FormData (como texto) a lo que esperan los lectores.
func campos(m map[string]string) map[string]*string {
	out := make(map[string]*string, len(m))
	for k, v := range m {
		out[k] = &v
	}
	return out
}

func noEncontrado(m string) error { return plataforma.NuevoProblema(http.StatusNotFound, m) }

// --- proveedores ---

func (a *API) ListarProveedores(ctx context.Context, r comprasapi.ListarProveedoresRequestObject) (comprasapi.ListarProveedoresResponseObject, error) {
	if _, err := proveedores(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.ListarProveedores(ctx, deTexto(r.Params.Busqueda), deTexto(r.Params.Estado))
	return ok(v), err
}

func (a *API) ProveedoresParaElegir(ctx context.Context, _ comprasapi.ProveedoresParaElegirRequestObject) (comprasapi.ProveedoresParaElegirResponseObject, error) {
	if _, err := compras(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.ProveedoresParaElegir(ctx)
	return ok(v), err
}

func (a *API) GuardarProveedor(ctx context.Context, r comprasapi.GuardarProveedorRequestObject) (comprasapi.GuardarProveedorResponseObject, error) {
	ses, err := proveedores(ctx)
	if err != nil {
		return nil, err
	}
	id, m, err := a.s.GuardarProveedor(ctx, ses, *r.Body)
	if err != nil {
		return nil, err
	}
	return ok(map[string]string{"ok": m, "id": id}), nil
}

func (a *API) FichaDeProveedor(ctx context.Context, r comprasapi.FichaDeProveedorRequestObject) (comprasapi.FichaDeProveedorResponseObject, error) {
	if _, err := proveedores(ctx); err != nil {
		return nil, err
	}
	p, err := a.s.ObtenerProveedor(ctx, r.Id)
	if err != nil {
		return nil, err
	}
	if p == nil {
		return nil, noEncontrado("Ese proveedor no existe.")
	}
	return ok(p), nil
}

func (a *API) DarDeBajaProveedor(ctx context.Context, r comprasapi.DarDeBajaProveedorRequestObject) (comprasapi.DarDeBajaProveedorResponseObject, error) {
	ses, err := proveedores(ctx)
	if err != nil {
		return nil, err
	}
	m, err := a.s.DarDeBaja(ctx, ses, r.Id)
	if err != nil {
		return nil, err
	}
	return hecho(m), nil
}

func (a *API) RegistrarMovimientoDeProveedor(ctx context.Context, r comprasapi.RegistrarMovimientoDeProveedorRequestObject) (comprasapi.RegistrarMovimientoDeProveedorResponseObject, error) {
	ses, err := proveedores(ctx)
	if err != nil {
		return nil, err
	}
	m := map[string]any(*r.Body)
	m["supplierId"] = r.Id
	if _, err := a.s.RegistrarMovimiento(ctx, ses, m); err != nil {
		return nil, err
	}
	return hecho("Movimiento anotado."), nil
}

func (a *API) CondicionesDelProveedor(ctx context.Context, r comprasapi.CondicionesDelProveedorRequestObject) (comprasapi.CondicionesDelProveedorResponseObject, error) {
	if _, err := proveedores(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.CondicionesDelProveedor(ctx, r.Id)
	return ok(v), err
}

func (a *API) GuardarCondicion(ctx context.Context, r comprasapi.GuardarCondicionRequestObject) (comprasapi.GuardarCondicionResponseObject, error) {
	ses, err := proveedores(ctx)
	if err != nil {
		return nil, err
	}
	form := campos(*r.Body)
	form["supplierId"] = &r.Id
	if _, err := a.s.GuardarCondicion(ctx, ses, form); err != nil {
		return nil, err
	}
	return hecho("Guardada."), nil
}

func (a *API) BorrarCondicion(ctx context.Context, r comprasapi.BorrarCondicionRequestObject) (comprasapi.BorrarCondicionResponseObject, error) {
	ses, err := proveedores(ctx)
	if err != nil {
		return nil, err
	}
	if !plataforma.UUIDValido(r.Id) {
		return vacio(), nil
	}
	return vacio(), a.s.BorrarCondicion(ctx, ses, r.Condicion, r.Id)
}

func (a *API) GuardarConvenios(ctx context.Context, r comprasapi.GuardarConveniosRequestObject) (comprasapi.GuardarConveniosResponseObject, error) {
	ses, err := proveedores(ctx)
	if err != nil {
		return nil, err
	}
	if !plataforma.UUIDValido(r.Id) {
		return nil, noEncontrado("Ese proveedor no existe.")
	}
	return vacio(), a.s.GuardarConvenios(ctx, ses, r.Id, r.Body.Convenios)
}

func (a *API) PerfilDeLista(ctx context.Context, r comprasapi.PerfilDeListaRequestObject) (comprasapi.PerfilDeListaResponseObject, error) {
	if _, err := proveedores(ctx); err != nil {
		return nil, err
	}
	p, err := a.s.PerfilDelProveedor(ctx, r.Id)
	if err != nil {
		return nil, err
	}
	if p == nil {
		return ok(nil), nil
	}
	return ok(p), nil
}

func (a *API) FacturasConSaldo(ctx context.Context, r comprasapi.FacturasConSaldoRequestObject) (comprasapi.FacturasConSaldoResponseObject, error) {
	if _, err := admin(ctx, "/admin/compras/pagos"); err != nil {
		return nil, err
	}
	v, err := a.s.FacturasConSaldo(ctx, r.Id)
	return ok(v), err
}

func (a *API) AcumuladoDelMes(ctx context.Context, r comprasapi.AcumuladoDelMesRequestObject) (comprasapi.AcumuladoDelMesResponseObject, error) {
	if _, err := compras(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.AcumuladoDelMes(ctx, r.Id, time.Now())
	return ok(v), err
}

// --- la lista de precios del proveedor ---

// leerFormulario lee un multipart: los campos como texto y el archivo.
func leerFormulario(r *multipart.Reader) ([]byte, map[string]*string, error) {
	form := map[string]*string{}
	var archivo []byte
	for {
		p, err := r.NextPart()
		if errors.Is(err, io.EOF) {
			return archivo, form, nil
		}
		if err != nil {
			return nil, nil, plataforma.NuevoProblema(http.StatusBadRequest, "El formulario llegó cortado.")
		}
		if p.FormName() == "archivo" {
			archivo, err = io.ReadAll(io.LimitReader(p, TopeDeLista+1))
			if err != nil {
				return nil, nil, err
			}
			continue
		}
		v, err := io.ReadAll(io.LimitReader(p, 1<<20))
		if err != nil {
			return nil, nil, err
		}
		s := string(v)
		form[p.FormName()] = &s
	}
}

func (a *API) VistaPreviaDeLista(ctx context.Context, r comprasapi.VistaPreviaDeListaRequestObject) (comprasapi.VistaPreviaDeListaResponseObject, error) {
	if _, err := proveedores(ctx); err != nil {
		return nil, err
	}
	archivo, form, err := leerFormulario(r.Body)
	if err != nil {
		return nil, err
	}
	v, err := a.s.PrevisualizarLista(ctx, archivo, form)
	return ok(v), err
}

// AplicarLista exige el admin (como la pantalla): el TS solo pedía que fuera
// personal, y cualquier vendedor podía reescribir la lista general.
func (a *API) AplicarLista(ctx context.Context, r comprasapi.AplicarListaRequestObject) (comprasapi.AplicarListaResponseObject, error) {
	ses, err := proveedores(ctx)
	if err != nil {
		return nil, err
	}
	m, proveedor, err := a.s.AplicarLista(ctx, ses, campos(*r.Body))
	if err != nil {
		return nil, err
	}
	return ok(map[string]string{"ok": m, "supplierId": proveedor}), nil
}

// --- órdenes ---

func (a *API) ListarOrdenesDeCompra(ctx context.Context, r comprasapi.ListarOrdenesDeCompraRequestObject) (comprasapi.ListarOrdenesDeCompraResponseObject, error) {
	if _, err := compras(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.ListarOrdenes(ctx, limite(r.Params.Limite, 60))
	return ok(v), err
}

func (a *API) CrearOrdenDeCompra(ctx context.Context, r comprasapi.CrearOrdenDeCompraRequestObject) (comprasapi.CrearOrdenDeCompraResponseObject, error) {
	ses, err := compras(ctx)
	if err != nil {
		return nil, err
	}
	id, err := a.s.CrearOrden(ctx, ses, *r.Body)
	if err != nil {
		return nil, err
	}
	return ok(map[string]string{"ok": "Orden creada.", "id": id}), nil
}

func (a *API) OrdenDeCompra(ctx context.Context, r comprasapi.OrdenDeCompraRequestObject) (comprasapi.OrdenDeCompraResponseObject, error) {
	if _, err := compras(ctx); err != nil {
		return nil, err
	}
	o, err := a.s.ObtenerOrden(ctx, r.Id)
	if err != nil {
		return nil, err
	}
	if o == nil {
		return nil, noEncontrado("Esa orden no existe.")
	}
	return ok(o), nil
}

func (a *API) MarcarOrdenEnviada(ctx context.Context, r comprasapi.MarcarOrdenEnviadaRequestObject) (comprasapi.MarcarOrdenEnviadaResponseObject, error) {
	ses, err := compras(ctx)
	if err != nil {
		return nil, err
	}
	if !plataforma.UUIDValido(r.Id) {
		return nil, fallo("Esa orden ya no está en borrador.")
	}
	m, err := a.s.MarcarEnviada(ctx, ses, r.Id)
	if err != nil {
		return nil, err
	}
	return hecho(m), nil
}

func (a *API) AnularOrdenDeCompra(ctx context.Context, r comprasapi.AnularOrdenDeCompraRequestObject) (comprasapi.AnularOrdenDeCompraResponseObject, error) {
	ses, err := compras(ctx)
	if err != nil {
		return nil, err
	}
	if !plataforma.UUIDValido(r.Id) && strings.TrimSpace(r.Body.Motivo) != "" {
		return nil, fallo("Esa orden no existe.")
	}
	m, err := a.s.AnularOrden(ctx, ses, r.Id, r.Body.Motivo)
	if err != nil {
		return nil, err
	}
	return hecho(m), nil
}

func (a *API) RecibirDeLaOrden(ctx context.Context, r comprasapi.RecibirDeLaOrdenRequestObject) (comprasapi.RecibirDeLaOrdenResponseObject, error) {
	ses, err := compras(ctx)
	if err != nil {
		return nil, err
	}
	if !plataforma.UUIDValido(r.Id) {
		return nil, fallo("Esa orden no existe.")
	}
	id, err := a.s.RecibirDeLaOrden(ctx, ses, r.Id, r.Body.NumeroRemito)
	if err != nil {
		return nil, err
	}
	return ok(map[string]string{"ok": "Recepción creada en borrador. Revisá las cantidades y confirmala.", "id": id}), nil
}

// LoQueEstaPorLlegar lo muestra la grilla de /admin/stock, así que lo lee
// quien entra ahí. El TS pedía el admin: al vendedor y al depósito la página
// de stock los mandaba de vuelta a su inicio y no la podían abrir.
func (a *API) LoQueEstaPorLlegar(ctx context.Context, r comprasapi.LoQueEstaPorLlegarRequestObject) (comprasapi.LoQueEstaPorLlegarResponseObject, error) {
	if _, err := admin(ctx, "/admin/stock"); err != nil {
		return nil, err
	}
	sucursal := deTexto(r.Params.Sucursal)
	if sucursal != "" && !plataforma.UUIDValido(sucursal) {
		return ok([]PorLlegar{}), nil
	}
	v, err := a.s.LoQueEstaPorLlegar(ctx, sucursal)
	return ok(v), err
}

func (a *API) BuscarMercaderia(ctx context.Context, r comprasapi.BuscarMercaderiaRequestObject) (comprasapi.BuscarMercaderiaResponseObject, error) {
	if _, err := compras(ctx); err != nil {
		return nil, err
	}
	if r.Params.Ids != nil {
		v, err := a.s.VariantesParaPedir(ctx, strings.Split(*r.Params.Ids, ","))
		return ok(v), err
	}
	v, err := a.s.BuscarParaRecibir(ctx, deTexto(r.Params.Texto))
	return ok(v), err
}

// --- recepciones ---

func (a *API) ListarRecepciones(ctx context.Context, r comprasapi.ListarRecepcionesRequestObject) (comprasapi.ListarRecepcionesResponseObject, error) {
	if _, err := recepciones(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.ListarRecepciones(ctx, limite(r.Params.Limite, 50))
	return ok(v), err
}

func (a *API) CrearRecepcion(ctx context.Context, r comprasapi.CrearRecepcionRequestObject) (comprasapi.CrearRecepcionResponseObject, error) {
	ses, err := recepciones(ctx)
	if err != nil {
		return nil, err
	}
	id, err := a.s.CrearRecepcion(ctx, ses, *r.Body)
	if err != nil {
		return nil, err
	}
	return ok(map[string]string{"ok": "Recepción cargada en borrador.", "id": id}), nil
}

func (a *API) Recepcion(ctx context.Context, r comprasapi.RecepcionRequestObject) (comprasapi.RecepcionResponseObject, error) {
	if _, err := recepciones(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.ObtenerRecepcion(ctx, r.Id)
	if err != nil {
		return nil, err
	}
	if v == nil {
		return nil, noEncontrado("Esa recepción no existe.")
	}
	return ok(v), nil
}

func (a *API) ConfirmarRecepcion(ctx context.Context, r comprasapi.ConfirmarRecepcionRequestObject) (comprasapi.ConfirmarRecepcionResponseObject, error) {
	ses, err := recepciones(ctx)
	if err != nil {
		return nil, err
	}
	if !plataforma.UUIDValido(r.Id) {
		return nil, fallo("Esa recepción no existe.")
	}
	lineas, neto, err := a.s.ConfirmarRecepcion(ctx, ses, r.Id)
	if err != nil {
		return nil, err
	}
	return ok(map[string]any{"lineas": lineas, "neto": neto}), nil
}

func (a *API) AnularRecepcion(ctx context.Context, r comprasapi.AnularRecepcionRequestObject) (comprasapi.AnularRecepcionResponseObject, error) {
	ses, err := recepciones(ctx)
	if err != nil {
		return nil, err
	}
	if !plataforma.UUIDValido(r.Id) && strings.TrimSpace(r.Body.Motivo) != "" {
		return nil, fallo("Esa recepción no existe.")
	}
	return vacio(), a.s.AnularRecepcion(ctx, ses, r.Id, r.Body.Motivo)
}

// --- facturas y libro ---

func (a *API) ListarFacturasDeCompra(ctx context.Context, r comprasapi.ListarFacturasDeCompraRequestObject) (comprasapi.ListarFacturasDeCompraResponseObject, error) {
	if _, err := compras(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.ListarFacturas(ctx, limite(r.Params.Limite, 60))
	return ok(v), err
}

func (a *API) CargarFacturaDeCompra(ctx context.Context, r comprasapi.CargarFacturaDeCompraRequestObject) (comprasapi.CargarFacturaDeCompraResponseObject, error) {
	ses, err := compras(ctx)
	if err != nil {
		return nil, err
	}
	id, proveedor, err := a.s.CargarFactura(ctx, ses, *r.Body)
	if err != nil {
		return nil, err
	}
	return ok(map[string]string{"ok": "Factura cargada.", "id": id, "supplierId": proveedor}), nil
}

func (a *API) LibroIvaCompras(ctx context.Context, r comprasapi.LibroIvaComprasRequestObject) (comprasapi.LibroIvaComprasResponseObject, error) {
	if _, err := admin(ctx, "/admin/arca"); err != nil {
		return nil, err
	}
	filas, totales, err := a.s.LibroIvaCompras(ctx, r.Params.Desde, r.Params.Hasta)
	if err != nil {
		return nil, err
	}
	return ok(map[string]any{"filas": plataforma.SinNulos(filas), "totales": totales}), nil
}

func (a *API) LibroIvaComprasCsv(ctx context.Context, r comprasapi.LibroIvaComprasCsvRequestObject) (comprasapi.LibroIvaComprasCsvResponseObject, error) {
	if _, err := admin(ctx, "/admin/arca"); err != nil {
		return nil, err
	}
	p := LeerPeriodoMensual(deTexto(r.Params.Periodo), time.Now())
	filas, totales, err := a.s.LibroIvaCompras(ctx, p.Desde, p.Hasta)
	if err != nil {
		return nil, err
	}
	return respuesta{csv: CsvLibroIva(filas, totales), nombre: "libro-iva-compras-" + p.Clave + ".csv"}, nil
}

// --- pagos y retenciones ---

func (a *API) ListarPagosAProveedores(ctx context.Context, r comprasapi.ListarPagosAProveedoresRequestObject) (comprasapi.ListarPagosAProveedoresResponseObject, error) {
	if _, err := compras(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.ListarPagos(ctx, limite(r.Params.Limite, 60))
	return ok(v), err
}

func (a *API) PagarAProveedor(ctx context.Context, r comprasapi.PagarAProveedorRequestObject) (comprasapi.PagarAProveedorResponseObject, error) {
	ses, err := compras(ctx)
	if err != nil {
		return nil, err
	}
	m, certificados, err := a.s.PagarAProveedor(ctx, ses, *r.Body)
	if err != nil {
		return nil, err
	}
	return ok(map[string]any{"ok": m, "certificados": certificados}), nil
}

// AnularPagoAProveedor es solo del admin (con nombre, no por pantalla):
// deshace plata ya pagada y certificados ya entregados.
func (a *API) AnularPagoAProveedor(ctx context.Context, r comprasapi.AnularPagoAProveedorRequestObject) (comprasapi.AnularPagoAProveedorResponseObject, error) {
	ses, err := auth.Exigir(ctx, sqlc.StaffRoleAdmin)
	if err != nil {
		return nil, err
	}
	if !plataforma.UUIDValido(r.Id) {
		return nil, fallo("Ese pago no existe.")
	}
	m, err := a.s.AnularPago(ctx, ses, r.Id, r.Body.Motivo)
	if err != nil {
		return nil, err
	}
	return hecho(m), nil
}

func (a *API) RetencionesPracticadasCsv(ctx context.Context, r comprasapi.RetencionesPracticadasCsvRequestObject) (comprasapi.RetencionesPracticadasCsvResponseObject, error) {
	if _, err := compras(ctx); err != nil {
		return nil, err
	}
	p := LeerPeriodoMensual(deTexto(r.Params.Periodo), time.Now())
	filas, err := a.s.RetencionesDelPeriodo(ctx, p.Desde, p.Hasta)
	if err != nil {
		return nil, err
	}
	return respuesta{csv: CsvRetenciones(filas), nombre: "retenciones-practicadas-" + p.Clave + ".csv"}, nil
}

func (a *API) CertificadoDeRetencion(ctx context.Context, r comprasapi.CertificadoDeRetencionRequestObject) (comprasapi.CertificadoDeRetencionResponseObject, error) {
	if _, err := compras(ctx); err != nil {
		return nil, err
	}
	c, err := a.s.CertificadoParaImprimir(ctx, r.Numero)
	if err != nil {
		return nil, err
	}
	if c == nil {
		return nil, noEncontrado("No existe ese certificado.")
	}
	return ok(c), nil
}

// CertificadoDeRetencionPdf es el certificado impreso, con el cálculo.
func (a *API) CertificadoDeRetencionPdf(ctx context.Context, r comprasapi.CertificadoDeRetencionPdfRequestObject) (comprasapi.CertificadoDeRetencionPdfResponseObject, error) {
	if _, err := compras(ctx); err != nil {
		return nil, err
	}
	c, err := a.s.CertificadoParaImprimir(ctx, r.Numero)
	if err != nil {
		return nil, err
	}
	if c == nil {
		return nil, noEncontrado("No existe ese certificado.")
	}
	emisor, err := documentos.EmisorDe(ctx, a.s.pool)
	if err != nil {
		return nil, err
	}
	b, err := pdf.CertificadoDeRetencion(DatosDelCertificadoPdf(c, emisor), time.Now())
	if err != nil {
		return nil, err
	}
	return archivoPdf{"retencion-" + c.Numero + ".pdf", b}, nil
}

func (a *API) RegimenesDeRetencion(ctx context.Context, r comprasapi.RegimenesDeRetencionRequestObject) (comprasapi.RegimenesDeRetencionResponseObject, error) {
	if _, err := compras(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.Regimenes(ctx, r.Params.Todos != nil && *r.Params.Todos)
	return ok(v), err
}

func (a *API) GuardarRegimen(ctx context.Context, r comprasapi.GuardarRegimenRequestObject) (comprasapi.GuardarRegimenResponseObject, error) {
	ses, err := admin(ctx, "/admin/arca")
	if err != nil {
		return nil, err
	}
	m, err := a.s.GuardarRegimen(ctx, ses, campos(*r.Body))
	if err != nil {
		return nil, err
	}
	return hecho(m), nil
}

func (a *API) RetencionesSufridas(ctx context.Context, r comprasapi.RetencionesSufridasRequestObject) (comprasapi.RetencionesSufridasResponseObject, error) {
	if _, err := admin(ctx, "/admin/arca"); err != nil {
		return nil, err
	}
	v, err := a.s.ListarRetencionesSufridas(ctx, limite(r.Params.Limite, 60))
	return ok(v), err
}

func (a *API) CreditoPorRetenciones(ctx context.Context, r comprasapi.CreditoPorRetencionesRequestObject) (comprasapi.CreditoPorRetencionesResponseObject, error) {
	if _, err := admin(ctx, "/admin/arca"); err != nil {
		return nil, err
	}
	v, err := a.s.CreditoPorRetenciones(ctx, r.Params.Desde, r.Params.Hasta)
	return ok(v), err
}

// --- gastos ---

func (a *API) ListarGastos(ctx context.Context, r comprasapi.ListarGastosRequestObject) (comprasapi.ListarGastosResponseObject, error) {
	if _, err := compras(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.ListarGastos(ctx, r.Params.Desde, r.Params.Hasta, limite(r.Params.Limite, 200))
	return ok(v), err
}

func (a *API) CargarGasto(ctx context.Context, r comprasapi.CargarGastoRequestObject) (comprasapi.CargarGastoResponseObject, error) {
	ses, err := compras(ctx)
	if err != nil {
		return nil, err
	}
	m, aviso, err := a.s.CargarGasto(ctx, ses, *r.Body)
	if err != nil {
		return nil, err
	}
	out := map[string]string{"ok": m}
	if aviso != "" {
		out["aviso"] = aviso
	}
	return ok(out), nil
}

func (a *API) GastosPorCategoria(ctx context.Context, r comprasapi.GastosPorCategoriaRequestObject) (comprasapi.GastosPorCategoriaResponseObject, error) {
	if _, err := compras(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.GastosPorCategoria(ctx, r.Params.Desde, r.Params.Hasta)
	return ok(v), err
}

func (a *API) GastosPorCircuito(ctx context.Context, r comprasapi.GastosPorCircuitoRequestObject) (comprasapi.GastosPorCircuitoResponseObject, error) {
	if _, err := compras(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.GastosPorCircuito(ctx, r.Params.Desde, r.Params.Hasta)
	return ok(v), err
}

func (a *API) SucursalesParaGasto(ctx context.Context, _ comprasapi.SucursalesParaGastoRequestObject) (comprasapi.SucursalesParaGastoResponseObject, error) {
	if _, err := compras(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.SucursalesParaGasto(ctx)
	return ok(v), err
}
