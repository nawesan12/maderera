package entregas

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/api/entregasapi"
	"mjbj/internal/auth"
	"mjbj/internal/documentos"
	"mjbj/internal/pdf"
	"mjbj/internal/plataforma"
	"mjbj/internal/roles"
)

// API son las rutas de api/entregas.yaml.
type API struct {
	s       *Servicio
	pool    *pgxpool.Pool
	interna plataforma.ConfigInterna
}

// NuevaAPI arma los handlers.
func NuevaAPI(s *Servicio, interna plataforma.ConfigInterna) *API {
	return &API{s: s, pool: s.pool, interna: interna}
}

var _ entregasapi.StrictServerInterface = (*API)(nil)

type respuesta struct {
	codigo int
	v      any
}

func (o respuesta) escribir(w http.ResponseWriter) error {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(o.codigo)
	return json.NewEncoder(w).Encode(plataforma.SinNulos(o.v))
}

func ok(v any) respuesta       { return respuesta{http.StatusOK, v} }
func hecho(m string) respuesta { return ok(map[string]string{"ok": m}) }
func noEsta(m string) error    { return plataforma.NuevoProblema(http.StatusNotFound, m) }
func conflicto(m string) error { return plataforma.NuevoProblema(http.StatusConflict, m) }
func invalido(campo, m string) error {
	if campo == "" {
		campo = "_"
	}
	return plataforma.Invalido(map[string]string{campo: m})
}

func (o respuesta) VisitZonasDeEnvioDelPanelResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitGuardarZonaDeEnvioResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitSaldoDeAcopioResponse(w http.ResponseWriter) error      { return o.escribir(w) }
func (o respuesta) VisitRemitosDelPedidoResponse(w http.ResponseWriter) error   { return o.escribir(w) }
func (o respuesta) VisitPrepararRemitoResponse(w http.ResponseWriter) error     { return o.escribir(w) }
func (o respuesta) VisitAnularRemitoResponse(w http.ResponseWriter) error       { return o.escribir(w) }
func (o respuesta) VisitFirmarRemitoResponse(w http.ResponseWriter) error       { return o.escribir(w) }
func (o respuesta) VisitRemitoPorTokenResponse(w http.ResponseWriter) error     { return o.escribir(w) }
func (o respuesta) VisitEntregasDeMiPedidoResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitRemitoDeConstanciaResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitRemitoCompletoResponse(w http.ResponseWriter) error     { return o.escribir(w) }
func (o respuesta) VisitRemitoParaAvisarResponse(w http.ResponseWriter) error   { return o.escribir(w) }

// archivo es el PDF del remito.
type archivo struct {
	nombre string
	datos  []byte
}

func (a archivo) VisitRemitoPdfResponse(w http.ResponseWriter) error {
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", `attachment; filename="`+a.nombre+`.pdf"`)
	w.Header().Set("Cache-Control", "private, no-store")
	w.WriteHeader(http.StatusOK)
	_, err := bytes.NewReader(a.datos).WriteTo(w)
	return err
}

// Los permisos: los de cada pantalla.
func pedidos(ctx context.Context) (*auth.Sesion, error) {
	return auth.Exigir(ctx, roles.QuienEntra("/admin/pedidos")...)
}

func (a *API) esInterno(ctx context.Context) bool {
	return a.interna.EsInterno(plataforma.PedidoDe(ctx))
}

// pedidosOInterno deja pasar a quien entra a la ficha del pedido o al
// servidor de Next con el secreto.
func (a *API) pedidosOInterno(ctx context.Context) error {
	if a.esInterno(ctx) {
		return nil
	}
	_, err := pedidos(ctx)
	return err
}

/* ------------------------- ficha del pedido ------------------------- */

func (a *API) SaldoDeAcopio(ctx context.Context, r entregasapi.SaldoDeAcopioRequestObject) (entregasapi.SaldoDeAcopioResponseObject, error) {
	if err := a.pedidosOInterno(ctx); err != nil {
		return nil, err
	}
	v, err := SaldoDeAcopio(ctx, a.pool, r.Id)
	return ok(v), err
}

func (a *API) RemitosDelPedido(ctx context.Context, r entregasapi.RemitosDelPedidoRequestObject) (entregasapi.RemitosDelPedidoResponseObject, error) {
	if err := a.pedidosOInterno(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.RemitosDelPedido(ctx, r.Id)
	return ok(v), err
}

func (a *API) PrepararRemito(ctx context.Context, r entregasapi.PrepararRemitoRequestObject) (entregasapi.PrepararRemitoResponseObject, error) {
	ses, err := pedidos(ctx)
	if err != nil {
		return nil, err
	}
	f, campo, msj := LeerRemito(*r.Body)
	if msj != "" {
		return nil, invalido(campo, msj)
	}
	e, err := a.s.CrearEntrega(ctx, ses, f)
	if err != nil {
		return nil, err
	}
	m := "Remito " + e.Numero + " listo. Todavía queda mercadería en acopio."
	if e.PedidoCompleto {
		m = "Remito " + e.Numero + " listo. Con esto el pedido queda entregado."
	}
	return ok(map[string]any{"ok": m, "id": e.ID, "numero": e.Numero, "firmaToken": e.FirmaToken, "pedidoCompleto": e.PedidoCompleto}), nil
}

func (a *API) AnularRemito(ctx context.Context, r entregasapi.AnularRemitoRequestObject) (entregasapi.AnularRemitoResponseObject, error) {
	ses, err := pedidos(ctx)
	if err != nil {
		return nil, err
	}
	if err := a.s.AnularEntrega(ctx, ses, r.Id); err != nil {
		return nil, err
	}
	return hecho("Remito anulado. La mercadería volvió al stock."), nil
}

/* ----------------------------- mostrador ---------------------------- */

func (a *API) RemitoDeConstancia(ctx context.Context, r entregasapi.RemitoDeConstanciaRequestObject) (entregasapi.RemitoDeConstanciaResponseObject, error) {
	ses, err := auth.Exigir(ctx, roles.QuienEntra("/mostrador")...)
	if err != nil {
		return nil, err
	}
	var nombre *string
	if r.Body != nil {
		nombre = r.Body.ReceptorNombre
	}
	e, err := a.s.RemitoDeConstancia(ctx, ses, r.Id, nombre)
	if err != nil {
		return nil, err
	}
	return ok(map[string]string{"ok": "Remito " + e.Numero + " emitido.", "remitoId": e.ID, "remitoNumero": e.Numero}), nil
}

/* ------------------------- el remito completo ------------------------ */

func (a *API) RemitoCompleto(ctx context.Context, r entregasapi.RemitoCompletoRequestObject) (entregasapi.RemitoCompletoResponseObject, error) {
	if err := a.pedidosOInterno(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.RemitoCompleto(ctx, r.Id)
	if errors.Is(err, ErrNoEsta) {
		return nil, noEsta("No encontrado")
	}
	return ok(v), err
}

func (a *API) RemitoParaAvisar(ctx context.Context, r entregasapi.RemitoParaAvisarRequestObject) (entregasapi.RemitoParaAvisarResponseObject, error) {
	if !a.esInterno(ctx) {
		return nil, plataforma.NuevoProblema(http.StatusForbidden, "Solo para el servidor.")
	}
	v, err := a.s.DatosParaAvisar(ctx, r.Id)
	if errors.Is(err, ErrNoEsta) {
		return nil, noEsta("No encontrado")
	}
	return ok(v), err
}

// RemitoPdf: el personal de pedidos baja cualquiera, el
// servidor de Next también (WhatsApp), y el cliente solo los suyos. A quien no
// puede verlo, 404 y no 403: un 403 confirma que existe.
func (a *API) RemitoPdf(ctx context.Context, r entregasapi.RemitoPdfRequestObject) (entregasapi.RemitoPdfResponseObject, error) {
	if !a.esInterno(ctx) {
		ses := auth.DeContexto(ctx)
		if ses == nil {
			return nil, noEsta("No encontrado")
		}
		// Del personal, quien entra a los pedidos (antes cualquier rol,
		// también el aserradero).
		if ses.EsStaff() && !ses.Tiene(roles.QuienEntra("/admin/pedidos")...) {
			return nil, noEsta("No encontrado")
		}
		if !ses.EsStaff() {
			dueno, err := a.s.DuenoDelRemito(ctx, r.Id)
			if errors.Is(err, ErrNoEsta) {
				return nil, noEsta("No encontrado")
			}
			if err != nil {
				return nil, err
			}
			var propio *string
			if err := a.pool.QueryRow(ctx, `SELECT id FROM customers WHERE user_id = $1 AND active LIMIT 1`, ses.UserID).Scan(&propio); err != nil && !esSinFilas(err) {
				return nil, err
			}
			if dueno == nil || propio == nil || *dueno != *propio {
				return nil, noEsta("No encontrado")
			}
		}
	}
	rem, err := a.s.RemitoCompleto(ctx, r.Id)
	if errors.Is(err, ErrNoEsta) {
		return nil, noEsta("No encontrado")
	}
	if err != nil {
		return nil, err
	}
	emisor, err := documentos.EmisorDe(ctx, a.pool)
	if err != nil {
		return nil, err
	}
	b, err := pdf.Remito(pdf.DatosRemito{Remito: rem.ParaElPdf(), Emisor: emisor}, timeNow())
	if err != nil {
		return nil, err
	}
	return archivo{rem.Numero, b}, nil
}

/* ------------------------------ la firma ----------------------------- */

func (a *API) RemitoPorToken(ctx context.Context, r entregasapi.RemitoPorTokenRequestObject) (entregasapi.RemitoPorTokenResponseObject, error) {
	v, err := a.s.RemitoPorToken(ctx, r.Token)
	if errors.Is(err, ErrNoEsta) {
		return nil, noEsta("No encontrado")
	}
	return ok(v), err
}

// MsjYaFirmado: el remito no está para firmar (ya se firmó, se anuló o el
// enlace no existe).
const MsjYaFirmado = "Este remito ya está firmado o el link venció. Pedile uno nuevo a la maderera."

func (a *API) FirmarRemito(ctx context.Context, r entregasapi.FirmarRemitoRequestObject) (entregasapi.FirmarRemitoResponseObject, error) {
	m := *r.Body
	f, campo, msj := LeerFirma(m)
	if msj != "" {
		return nil, invalido(campo, msj)
	}
	// La IP: la que vio Next si lo pide Next (con el secreto), o la de quien
	// pide.
	var ip *string
	if a.esInterno(ctx) {
		if s, es := m["ip"].(string); es && s != "" {
			ip = &s
		}
	} else if req := plataforma.PedidoDe(ctx); req != nil {
		s := plataforma.IPDelCliente(req)
		ip = &s
	}
	v, err := a.s.RegistrarFirma(ctx, f, ip)
	if err != nil {
		return nil, err
	}
	if v == nil {
		return nil, conflicto(MsjYaFirmado)
	}
	return ok(v), nil
}

/* ------------------------------ el portal ---------------------------- */

func (a *API) EntregasDeMiPedido(ctx context.Context, r entregasapi.EntregasDeMiPedidoRequestObject) (entregasapi.EntregasDeMiPedidoResponseObject, error) {
	ses, err := auth.ExigirSesion(ctx)
	if err != nil {
		return nil, err
	}
	v, err := a.s.DelPortal(ctx, ses, r.Id)
	if err != nil {
		return nil, err
	}
	if v == nil {
		return nil, noEsta("No encontrado")
	}
	return ok(v), nil
}

/* ------------------------------ las zonas ---------------------------- */

func envios(ctx context.Context) (*auth.Sesion, error) {
	return auth.Exigir(ctx, roles.QuienEntra("/admin/envios")...)
}

func (a *API) ZonasDeEnvioDelPanel(ctx context.Context, _ entregasapi.ZonasDeEnvioDelPanelRequestObject) (entregasapi.ZonasDeEnvioDelPanelResponseObject, error) {
	if _, err := envios(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.Zonas(ctx)
	return ok(v), err
}

func (a *API) GuardarZonaDeEnvio(ctx context.Context, r entregasapi.GuardarZonaDeEnvioRequestObject) (entregasapi.GuardarZonaDeEnvioResponseObject, error) {
	ses, err := envios(ctx)
	if err != nil {
		return nil, err
	}
	if err := a.s.GuardarZona(ctx, ses, *r.Body); err != nil {
		return nil, err
	}
	return hecho("Zona guardada."), nil
}
