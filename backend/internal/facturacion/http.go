package facturacion

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"strings"
	"time"

	"mjbj/internal/api/facturacionapi"
	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/fiscal"
	"mjbj/internal/plataforma"
	"mjbj/internal/roles"
	"mjbj/internal/sqlc"
)

// Las rutas de api/facturacion.yaml. Los permisos son los del TS: leer y
// emitir, cualquier persona del panel (requireStaff); anular, las notas, el
// emisor y los puntos de venta, el admin (requireStaffRole("admin")).

// API son los handlers.
type API struct {
	s       *Servicio
	interna plataforma.ConfigInterna
}

// NuevaAPI arma los handlers.
func NuevaAPI(s *Servicio, interna plataforma.ConfigInterna) *API {
	return &API{s: s, interna: interna}
}

var _ facturacionapi.StrictServerInterface = (*API)(nil)

type respuesta struct {
	codigo int
	v      any
	// Un archivo: el CSV (bytes, Next le pone sus cabeceras) o el PDF.
	datos       []byte
	tipo        string
	disposicion string
}

func (o respuesta) escribir(w http.ResponseWriter) error {
	if o.tipo != "" {
		w.Header().Set("Content-Type", o.tipo)
		w.Header().Set("Content-Disposition", o.disposicion)
		w.Header().Set("Cache-Control", "private, no-store")
		w.WriteHeader(http.StatusOK)
		_, err := bytes.NewReader(o.datos).WriteTo(w)
		return err
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(o.codigo)
	return json.NewEncoder(w).Encode(plataforma.SinNulos(o.v))
}

func ok(v any) respuesta { return respuesta{codigo: http.StatusOK, v: v} }

func mensaje(m string) respuesta { return ok(map[string]string{"ok": m}) }

func emitido(id string) respuesta { return ok(map[string]string{"invoiceId": id}) }

func (o respuesta) VisitEstadoDeArcaResponse(w http.ResponseWriter) error       { return o.escribir(w) }
func (o respuesta) VisitListarComprobantesResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitAnularComprobanteResponse(w http.ResponseWriter) error  { return o.escribir(w) }
func (o respuesta) VisitAutorizarComprobanteResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitCobrarComprobanteResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitCorregirReceptorYReintentarResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitNotaDeCreditoParcialResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitNotaDeDebitoResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitGuardarEmisorFiscalResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitLibroIvaVentasResponse(w http.ResponseWriter) error     { return o.escribir(w) }
func (o respuesta) VisitLibroIvaVentasCsvResponse(w http.ResponseWriter) error  { return o.escribir(w) }
func (o respuesta) VisitPedidoParaFacturarResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitFacturarPedidoResponse(w http.ResponseWriter) error     { return o.escribir(w) }
func (o respuesta) VisitListarPuntosDeVentaResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitGuardarPuntoDeVentaResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitResumenDeFacturacionResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitComprobanteCompletoResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitComprobanteEnPdfResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitMisComprobantesResponse(w http.ResponseWriter) error  { return o.escribir(w) }
func (o respuesta) VisitEmisorFiscalResponse(w http.ResponseWriter) error     { return o.escribir(w) }
func (o respuesta) VisitEmitirComprobanteManualResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitEmitirComprobanteInternoResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitAutorizarComprobanteInternoResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitLetraQueSaldriaResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitComprobanteDeLaVentaResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}

func admin(ctx context.Context) (*auth.Sesion, error) { return auth.Exigir(ctx, sqlc.StaffRoleAdmin) }

func noEsta(m string) error { return plataforma.NuevoProblema(http.StatusNotFound, m) }

// comoProblema pasa un motivo de negocio a un 422 que el panel muestra.
func comoProblema(err error) error {
	if m := Mensaje(err); m != "" {
		return plataforma.Invalido(map[string]string{"factura": m})
	}
	return err
}

func (a *API) esInterno(ctx context.Context) bool {
	return a.interna.EsInterno(plataforma.PedidoDe(ctx))
}

func (a *API) soloInterno(ctx context.Context) error {
	if a.esInterno(ctx) {
		return nil
	}
	return plataforma.NuevoProblema(http.StatusForbidden, "Solo para el servidor.")
}

func (a *API) staffOInterno(ctx context.Context) error {
	if a.esInterno(ctx) {
		return nil
	}
	_, err := auth.ExigirStaff(ctx)
	return err
}

func texto2(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

/* ------------------------------ el emisor ------------------------------ */

func (a *API) EmisorFiscal(ctx context.Context, _ facturacionapi.EmisorFiscalRequestObject) (facturacionapi.EmisorFiscalResponseObject, error) {
	if err := a.staffOInterno(ctx); err != nil {
		return nil, err
	}
	e, err := a.s.ObtenerEmisor(ctx)
	return ok(e), err
}

func (a *API) GuardarEmisorFiscal(ctx context.Context, r facturacionapi.GuardarEmisorFiscalRequestObject) (facturacionapi.GuardarEmisorFiscalResponseObject, error) {
	ses, err := admin(ctx)
	if err != nil {
		return nil, err
	}
	m, err := a.s.GuardarEmisor(ctx, ses, *r.Body)
	if err != nil {
		return nil, err
	}
	return mensaje(m), nil
}

func (a *API) ListarPuntosDeVenta(ctx context.Context, _ facturacionapi.ListarPuntosDeVentaRequestObject) (facturacionapi.ListarPuntosDeVentaResponseObject, error) {
	if _, err := auth.ExigirStaff(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.PuntosDeVenta(ctx)
	return ok(v), err
}

func (a *API) GuardarPuntoDeVenta(ctx context.Context, r facturacionapi.GuardarPuntoDeVentaRequestObject) (facturacionapi.GuardarPuntoDeVentaResponseObject, error) {
	ses, err := admin(ctx)
	if err != nil {
		return nil, err
	}
	m, err := a.s.GuardarPuntoDeVenta(ctx, ses, *r.Body)
	if err != nil {
		return nil, err
	}
	return mensaje(m), nil
}

func (a *API) EstadoDeArca(ctx context.Context, _ facturacionapi.EstadoDeArcaRequestObject) (facturacionapi.EstadoDeArcaResponseObject, error) {
	if _, err := auth.ExigirStaff(ctx); err != nil {
		return nil, err
	}
	return ok(a.s.Estado(ctx)), nil
}

/* ---------------------------- las lecturas ----------------------------- */

func (a *API) ListarComprobantes(ctx context.Context, r facturacionapi.ListarComprobantesRequestObject) (facturacionapi.ListarComprobantesResponseObject, error) {
	if _, err := auth.ExigirStaff(ctx); err != nil {
		return nil, err
	}
	p := r.Params
	f := Filtros{Estado: texto2(p.Estado), Desde: p.Desde, Hasta: p.Hasta, Busqueda: texto2(p.Busqueda)}
	if p.Cobro != nil {
		f.Cobro = string(*p.Cobro)
	}
	if p.Tope != nil {
		f.Tope = *p.Tope
	}
	v, err := a.s.Listar(ctx, f)
	return ok(v), err
}

func (a *API) ResumenDeFacturacion(ctx context.Context, r facturacionapi.ResumenDeFacturacionRequestObject) (facturacionapi.ResumenDeFacturacionResponseObject, error) {
	if _, err := auth.ExigirStaff(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.ResumenDe(ctx, r.Params.Desde, r.Params.Hasta)
	return ok(v), err
}

// puedeVer: el servidor de Next, el personal, o el cliente dueño. A quien no
// puede verlo, 404 (un 403 confirmaría que existe).
func (a *API) puedeVer(ctx context.Context, c *Completo) error {
	if a.esInterno(ctx) {
		return nil
	}
	ses := auth.DeContexto(ctx)
	if ses == nil {
		return noEsta("No encontrado")
	}
	if ses.EsStaff() {
		return nil
	}
	propio, err := a.s.ClienteDeLaSesion(ctx, ses.UserID)
	if err != nil {
		return err
	}
	if propio == "" || c.CustomerID == nil || *c.CustomerID != propio {
		return noEsta("No encontrado")
	}
	return nil
}

func (a *API) leer(ctx context.Context, id string) (*Completo, error) {
	c, err := a.s.Obtener(ctx, id)
	if errors.Is(err, ErrNoEsta) {
		return nil, noEsta("No encontrado")
	}
	if err != nil {
		return nil, err
	}
	if err := a.puedeVer(ctx, c); err != nil {
		return nil, err
	}
	return c, nil
}

func (a *API) ComprobanteCompleto(ctx context.Context, r facturacionapi.ComprobanteCompletoRequestObject) (facturacionapi.ComprobanteCompletoResponseObject, error) {
	c, err := a.leer(ctx, r.Id.String())
	if err != nil {
		return nil, err
	}
	return ok(c), nil
}

func (a *API) ComprobanteEnPdf(ctx context.Context, r facturacionapi.ComprobanteEnPdfRequestObject) (facturacionapi.ComprobanteEnPdfResponseObject, error) {
	c, err := a.leer(ctx, r.Id.String())
	if err != nil {
		return nil, err
	}
	b, nombre, err := a.s.Pdf(ctx, c)
	if err != nil {
		return nil, err
	}
	return respuesta{datos: b, tipo: "application/pdf", disposicion: `attachment; filename="` + nombre + `"`}, nil
}

func (a *API) MisComprobantes(ctx context.Context, _ facturacionapi.MisComprobantesRequestObject) (facturacionapi.MisComprobantesResponseObject, error) {
	ses, err := auth.Exigir(ctx)
	if err != nil {
		return nil, err
	}
	cliente, err := a.s.ClienteDeLaSesion(ctx, ses.UserID)
	if err != nil {
		return nil, err
	}
	if cliente == "" {
		return ok([]Propio{}), nil
	}
	v, err := a.s.DelCliente(ctx, cliente)
	return ok(v), err
}

type libroConPeriodo struct {
	Libro
	Desde time.Time `json:"desde"`
	Hasta time.Time `json:"hasta"`
	Clave string    `json:"clave"`
}

// libroIva es el permiso de los dos libros IVA: el de quien entra a
// /admin/arca (el admin), igual que el libro de compras. Antes el de ventas
// lo leía cualquier persona del panel, y es la facturación entera del mes
// con los CUIT de los clientes.
func libroIva(ctx context.Context) (*auth.Sesion, error) {
	return auth.Exigir(ctx, roles.QuienEntra("/admin/arca")...)
}

func (a *API) LibroIvaVentas(ctx context.Context, r facturacionapi.LibroIvaVentasRequestObject) (facturacionapi.LibroIvaVentasResponseObject, error) {
	if _, err := libroIva(ctx); err != nil {
		return nil, err
	}
	p := LeerPeriodo(texto2(r.Params.Periodo), a.s.ahora())
	l, err := a.s.LibroIva(ctx, p.Desde, p.Hasta)
	return ok(libroConPeriodo{l, p.Desde, p.Hasta, p.Clave}), err
}

func (a *API) LibroIvaVentasCsv(ctx context.Context, r facturacionapi.LibroIvaVentasCsvRequestObject) (facturacionapi.LibroIvaVentasCsvResponseObject, error) {
	ses, err := libroIva(ctx)
	if err != nil {
		return nil, err
	}
	p := LeerPeriodo(texto2(r.Params.Periodo), a.s.ahora())
	l, err := a.s.LibroIva(ctx, p.Desde, p.Hasta)
	if err != nil {
		return nil, err
	}
	nombre := "libro-iva-ventas-" + p.Clave + ".csv"
	bitacora.Anotar(ctx, a.s.q, a.s.log, ses, sqlc.AccionAuditoriaExportar, "libro_iva", "", "Exportó el libro IVA ventas de "+p.Clave, nil)
	return respuesta{datos: []byte(CsvLibroIva(l)), tipo: "application/octet-stream", disposicion: `attachment; filename="` + nombre + `"`}, nil
}

func (a *API) PedidoParaFacturar(ctx context.Context, r facturacionapi.PedidoParaFacturarRequestObject) (facturacionapi.PedidoParaFacturarResponseObject, error) {
	if _, err := auth.ExigirStaff(ctx); err != nil {
		return nil, err
	}
	p, err := a.s.PedidoParaFacturar(ctx, r.Id.String())
	if errors.Is(err, ErrNoEsta) {
		return nil, noEsta("No encontramos ese pedido.")
	}
	return ok(p), err
}

/* ----------------------------- las acciones ---------------------------- */

func (a *API) FacturarPedido(ctx context.Context, r facturacionapi.FacturarPedidoRequestObject) (facturacionapi.FacturarPedidoResponseObject, error) {
	ses, err := auth.ExigirStaff(ctx)
	if err != nil {
		return nil, err
	}
	id, err := a.s.FacturarPedido(ctx, ses, r.Id.String())
	if err != nil {
		return nil, comoProblema(err)
	}
	return emitido(id), nil
}

func (a *API) EmitirComprobanteManual(ctx context.Context, r facturacionapi.EmitirComprobanteManualRequestObject) (facturacionapi.EmitirComprobanteManualResponseObject, error) {
	ses, err := auth.ExigirStaff(ctx)
	if err != nil {
		return nil, err
	}
	l := r.Body.Lineas
	id, err := a.s.EmitirManual(ctx, ses, r.Body.Campos, LineasManuales{Descripcion: l.Descripcion, Cantidad: l.Cantidad, Precio: l.Precio, Alicuota: l.Alicuota})
	if err != nil {
		return nil, comoProblema(err)
	}
	return emitido(id), nil
}

// AutorizarComprobante: el resultado de ARCA va siempre con 200, con `ok` o
// con `error` (un rechazo no es un error del pedido). Queda en la bitácora
// salga como salga, y con el CAE se le manda al cliente el definitivo.
func (a *API) AutorizarComprobante(ctx context.Context, r facturacionapi.AutorizarComprobanteRequestObject) (facturacionapi.AutorizarComprobanteResponseObject, error) {
	ses, err := auth.ExigirStaff(ctx)
	if err != nil {
		return nil, err
	}
	res, err := a.autorizarYAnotar(ctx, ses, r.Id.String())
	if err != nil {
		return nil, err
	}
	return res, nil
}

// autorizarYAnotar pide el CAE, deja el intento en la bitácora y, si salió,
// encola el aviso al cliente.
func (a *API) autorizarYAnotar(ctx context.Context, ses *auth.Sesion, id string) (respuesta, error) {
	m, err := a.s.Autorizar(ctx, id)
	motivo := Mensaje(err)
	if err != nil && motivo == "" {
		return respuesta{}, err
	}
	desc := "Autorizó un comprobante en ARCA"
	if motivo != "" {
		desc = "Intentó autorizar un comprobante en ARCA y falló: " + motivo
	}
	bitacora.Anotar(ctx, a.s.q, a.s.log, ses, sqlc.AccionAuditoriaCambiarEstado, "factura", id, desc, nil)
	if motivo != "" {
		return ok(map[string]string{"error": motivo}), nil
	}
	if err := a.s.AvisarFactura(ctx, id); err != nil {
		a.s.log.Error("encolando el aviso de la factura", "invoiceId", id, "error", err)
	}
	return mensaje(m), nil
}

func (a *API) CorregirReceptorYReintentar(ctx context.Context, r facturacionapi.CorregirReceptorYReintentarRequestObject) (facturacionapi.CorregirReceptorYReintentarResponseObject, error) {
	ses, err := admin(ctx)
	if err != nil {
		return nil, err
	}
	id := r.Id.String()
	if err := a.s.CorregirReceptor(ctx, id, *r.Body); err != nil {
		return nil, comoProblema(err)
	}
	bitacora.Anotar(ctx, a.s.q, a.s.log, ses, sqlc.AccionAuditoriaEditar, "factura", id,
		"Corrigió los datos del receptor de un comprobante rechazado por ARCA", nil)
	res, err := a.autorizarYAnotar(ctx, ses, id)
	if err != nil {
		return nil, err
	}
	return res, nil
}

func (a *API) AnularComprobante(ctx context.Context, r facturacionapi.AnularComprobanteRequestObject) (facturacionapi.AnularComprobanteResponseObject, error) {
	ses, err := admin(ctx)
	if err != nil {
		return nil, err
	}
	c := *r.Body
	c["id"] = r.Id.String()
	motivo, err := validarAnulacion(c)
	if err != nil {
		return nil, err
	}
	id, err := a.s.Anular(ctx, r.Id.String(), motivo, &ses.UserID)
	if err != nil {
		return nil, comoProblema(err)
	}
	bitacora.Anotar(ctx, a.s.q, a.s.log, ses, sqlc.AccionAuditoriaAnular, "factura", r.Id.String(),
		"Anuló un comprobante con nota de crédito: "+motivo, map[string]any{"notaDeCreditoId": id})
	return emitido(id), nil
}

func (a *API) NotaDeCreditoParcial(ctx context.Context, r facturacionapi.NotaDeCreditoParcialRequestObject) (facturacionapi.NotaDeCreditoParcialResponseObject, error) {
	ses, err := admin(ctx)
	if err != nil {
		return nil, err
	}
	motivo := trimJS(r.Body.Motivo)
	if largoJS(motivo) < 4 {
		return nil, comoProblema(errEmision("Escribí el motivo de la nota de crédito."))
	}
	parciales := []fiscal.CantidadAAcreditar{}
	for _, p := range r.Body.Parciales {
		if p.Cantidad != nil && *p.Cantidad > 0 {
			parciales = append(parciales, fiscal.CantidadAAcreditar{ItemID: p.ItemId, Cantidad: *p.Cantidad})
		}
	}
	if len(parciales) == 0 {
		return nil, comoProblema(errEmision("Poné qué cantidad se acredita de cada renglón."))
	}
	id, err := a.s.NotaDeCredito(ctx, r.Id.String(), motivo, &ses.UserID, parciales, false)
	if err != nil {
		return nil, comoProblema(err)
	}
	bitacora.Anotar(ctx, a.s.q, a.s.log, ses, sqlc.AccionAuditoriaCrear, "factura", r.Id.String(),
		"Emitió una nota de crédito parcial: "+motivo, map[string]any{"notaDeCreditoId": id})
	return emitido(id), nil
}

func (a *API) NotaDeDebito(ctx context.Context, r facturacionapi.NotaDeDebitoRequestObject) (facturacionapi.NotaDeDebitoResponseObject, error) {
	ses, err := admin(ctx)
	if err != nil {
		return nil, err
	}
	b := r.Body
	motivo, concepto := trimJS(b.Motivo), trimJS(b.Concepto)
	switch {
	case largoJS(motivo) < 4:
		return nil, comoProblema(errEmision("Escribí el motivo de la nota de débito."))
	case concepto == "":
		return nil, comoProblema(errEmision("Poné el concepto."))
	case b.Importe == nil || !(*b.Importe > 0) || math.IsInf(*b.Importe, 0):
		return nil, comoProblema(errEmision("El importe tiene que ser mayor a cero."))
	}
	alic := 0.0
	if b.Alicuota != nil {
		alic = *b.Alicuota
	} else {
		alic = nan()
	}
	id, err := a.s.NotaDeDebito(ctx, r.Id.String(), motivo, []Linea{{LineaEntrada: fiscal.LineaEntrada{Descripcion: concepto,
		Unidad: ptr("unidad"), Cantidad: 1, PrecioFinalUnitario: *b.Importe, Alicuota: &alic}}}, &ses.UserID)
	if err != nil {
		return nil, comoProblema(err)
	}
	bitacora.Anotar(ctx, a.s.q, a.s.log, ses, sqlc.AccionAuditoriaCrear, "factura", r.Id.String(),
		"Emitió una nota de débito por "+concepto+": "+motivo, map[string]any{"notaDeDebitoId": id})
	return emitido(id), nil
}

func (a *API) CobrarComprobante(ctx context.Context, r facturacionapi.CobrarComprobanteRequestObject) (facturacionapi.CobrarComprobanteResponseObject, error) {
	ses, err := auth.ExigirStaff(ctx)
	if err != nil {
		return nil, err
	}
	c := *r.Body
	v, err := a.s.Cobrar(ctx, ses, r.Id.String(), c["modo"], c["monto"], c["partes"])
	if err != nil {
		return nil, comoProblema(err)
	}
	return ok(v), nil
}

/* ------------------------- las rutas internas -------------------------- */

func (a *API) EmitirComprobanteInterno(ctx context.Context, r facturacionapi.EmitirComprobanteInternoRequestObject) (facturacionapi.EmitirComprobanteInternoResponseObject, error) {
	if err := a.soloInterno(ctx); err != nil {
		return nil, err
	}
	b := r.Body
	d := DatosEmision{CustomerID: b.CustomerId, OrderID: b.OrderId, ReceptorNombre: b.ReceptorNombre, ReceptorCuit: b.ReceptorCuit,
		ReceptorCondicionIva: string(b.ReceptorCondicionIva), ReceptorDomicilio: b.ReceptorDomicilio, PuntoVentaID: b.PuntoVentaId,
		FechaVencimiento: b.FechaVencimiento, Observaciones: b.Observaciones, CreatedByUserID: b.CreatedByUserId, Lineas: make([]Linea, len(b.Lineas))}
	for i, l := range b.Lineas {
		d.Lineas[i] = Linea{LineaEntrada: fiscal.LineaEntrada{Descripcion: l.Descripcion, Unidad: l.Unidad, Cantidad: l.Cantidad,
			PrecioFinalUnitario: l.PrecioFinalUnitario, Alicuota: l.Alicuota}, ItemOrigenID: l.ItemOrigenId}
	}
	id, err := a.s.EmitirComprobante(ctx, d)
	if m := Mensaje(err); m != "" {
		return ok(map[string]string{"error": m}), nil
	}
	if err != nil {
		return nil, err
	}
	return ok(map[string]string{"invoiceId": id}), nil
}

func (a *API) AutorizarComprobanteInterno(ctx context.Context, r facturacionapi.AutorizarComprobanteInternoRequestObject) (facturacionapi.AutorizarComprobanteInternoResponseObject, error) {
	if err := a.soloInterno(ctx); err != nil {
		return nil, err
	}
	m, err := a.s.Autorizar(ctx, r.Id.String())
	if motivo := Mensaje(err); motivo != "" {
		return ok(map[string]string{"error": motivo}), nil
	}
	if err != nil {
		return nil, err
	}
	return mensaje(m), nil
}

func (a *API) LetraQueSaldria(ctx context.Context, r facturacionapi.LetraQueSaldriaRequestObject) (facturacionapi.LetraQueSaldriaResponseObject, error) {
	if err := a.soloInterno(ctx); err != nil {
		return nil, err
	}
	var cliente *string
	if r.Params.CustomerId != nil {
		c := r.Params.CustomerId.String()
		cliente = &c
	}
	letra, receptor, err := a.s.LetraQueSaldria(ctx, cliente, r.Params.Cuit)
	return ok(map[string]string{"letra": letra, "receptor": receptor}), err
}

func (a *API) ComprobanteDeLaVenta(ctx context.Context, r facturacionapi.ComprobanteDeLaVentaRequestObject) (facturacionapi.ComprobanteDeLaVentaResponseObject, error) {
	if err := a.soloInterno(ctx); err != nil {
		return nil, err
	}
	b := r.Body
	p := PedidoDeComprobante{OrderID: b.OrderId.String(), CustomerID: b.CustomerId, ReceptorNombre: b.ReceptorNombre, Cuit: b.Cuit,
		UsuarioID: b.UsuarioId, Lineas: make([]LineaDeVenta, len(b.Lineas))}
	for i, l := range b.Lineas {
		p.Lineas[i] = LineaDeVenta{Descripcion: l.Descripcion, Unidad: l.Unidad, Cantidad: l.Cantidad, PrecioUnitario: l.PrecioUnitario}
	}
	v, err := a.s.EmitirParaLaVenta(ctx, p)
	return ok(v), err
}

func trimJS(s string) string { return strings.TrimSpace(s) }

func largoJS(s string) int { return plataforma.LargoJS(s) }

func nan() float64 { return math.NaN() }

// validarAnulacion es el esquema de anular: el id y el motivo.
func validarAnulacion(c map[string]string) (string, error) {
	var e esquema
	e.uuid("id", get(c, "id"), false)
	motivo, _ := e.cadena("motivo", get(c, "motivo"), false, 4, "Escribí el motivo de la anulación.", 300)
	return motivo, e.Problema()
}
