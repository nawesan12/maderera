// Package cuentas son las rutas de api/cuentas.yaml: la cartera de clientes,
// la cuenta corriente, los cobros, los cheques, los vendedores y el
// seguimiento, y la cuenta corriente del portal. La lógica está en
// internal/clientes e internal/cobros; acá se pide la sesión y el rol.
package cuentas

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/api/cuentasapi"
	"mjbj/internal/auth"
	"mjbj/internal/clientes"
	"mjbj/internal/cobros"
	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
	"mjbj/internal/roles"
	"mjbj/internal/sqlc"
)

// API son los handlers.
type API struct {
	pool             *pgxpool.Pool
	clientes         *clientes.Servicio
	cobros           *cobros.Servicio
	interna          plataforma.ConfigInterna
	ahora            func() time.Time
	sitio            string
	enviarInvitacion func(ctx context.Context, correo, nombre, url string)
	// enviarClave manda el link con que alguien del personal elige su
	// contraseña.
	enviarClave func(ctx context.Context, correo, nombre, url string)
}

// ConClaveDelPersonal le da a la API cómo mandar el link del alta del
// personal.
func (a *API) ConClaveDelPersonal(enviar func(ctx context.Context, correo, nombre, url string)) *API {
	a.enviarClave = enviar
	return a
}

// NuevaAPI arma los handlers.
func NuevaAPI(pool *pgxpool.Pool, cl *clientes.Servicio, co *cobros.Servicio, interna plataforma.ConfigInterna) *API {
	return &API{pool: pool, clientes: cl, cobros: co, interna: interna, ahora: time.Now}
}

// ConInvitacion le da a la API cómo mandar el link de la invitación al
// portal y el sitio con que se arma la dirección.
func (a *API) ConInvitacion(sitio string, enviar func(ctx context.Context, correo, nombre, url string)) *API {
	a.sitio, a.enviarInvitacion = strings.TrimSuffix(sitio, "/"), enviar
	return a
}

func (a *API) InvitarAlPortal(ctx context.Context, r cuentasapi.InvitarAlPortalRequestObject) (cuentasapi.InvitarAlPortalResponseObject, error) {
	ses, err := auth.Exigir(ctx, sqlc.StaffRoleAdmin, sqlc.StaffRoleVendedor)
	if err != nil {
		return nil, err
	}
	inv, err := a.clientes.InvitarAlPortal(ctx, ses, r.Id)
	if err != nil {
		return nil, err
	}
	url := a.sitio + "/entrar/" + inv.Token
	if a.enviarInvitacion != nil {
		a.enviarInvitacion(ctx, inv.Correo, inv.Nombre, url)
	}
	return ok(map[string]string{"ok": "Le mandamos a " + inv.Correo + " el link para entrar a su cuenta.", "url": url}), nil
}

var _ cuentasapi.StrictServerInterface = (*API)(nil)

type respuesta struct {
	codigo int
	v      any
}

func (o respuesta) escribir(w http.ResponseWriter) error {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(o.codigo)
	return json.NewEncoder(w).Encode(plataforma.SinNulos(o.v))
}

func ok(v any) respuesta { return respuesta{http.StatusOK, v} }

func mensaje(m string) respuesta { return ok(map[string]string{"ok": m}) }

func (o respuesta) VisitListarChequesResponse(w http.ResponseWriter) error    { return o.escribir(w) }
func (o respuesta) VisitCargarChequeResponse(w http.ResponseWriter) error     { return o.escribir(w) }
func (o respuesta) VisitChequesEnCarteraResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitChequesTerminadosResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitRechazarChequeDelClienteResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitCambiarEstadoDeChequeResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitListarClientesResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitGuardarClienteResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitFichaDeClienteResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitBloquearCuentaResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitCobrarAClienteResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitCajaDelCobroACuentaResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitCreditoDeClienteResponse(w http.ResponseWriter) error   { return o.escribir(w) }
func (o respuesta) VisitVincularCuentaWebResponse(w http.ResponseWriter) error  { return o.escribir(w) }
func (o respuesta) VisitHistorialDeClienteResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitInvitarAlPortalResponse(w http.ResponseWriter) error    { return o.escribir(w) }
func (o respuesta) VisitRegistrarMovimientoResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitCambiarPlazoResponse(w http.ResponseWriter) error      { return o.escribir(w) }
func (o respuesta) VisitResumenDeCuentaResponse(w http.ResponseWriter) error   { return o.escribir(w) }
func (o respuesta) VisitAnularReciboResponse(w http.ResponseWriter) error      { return o.escribir(w) }
func (o respuesta) VisitListarGestionesResponse(w http.ResponseWriter) error   { return o.escribir(w) }
func (o respuesta) VisitCrearGestionResponse(w http.ResponseWriter) error      { return o.escribir(w) }
func (o respuesta) VisitGestionesVencidasResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitMoverGestionResponse(w http.ResponseWriter) error      { return o.escribir(w) }
func (o respuesta) VisitListarVendedoresResponse(w http.ResponseWriter) error  { return o.escribir(w) }
func (o respuesta) VisitGuardarVendedorResponse(w http.ResponseWriter) error   { return o.escribir(w) }
func (o respuesta) VisitAlternarVendedorResponse(w http.ResponseWriter) error  { return o.escribir(w) }
func (o respuesta) VisitMiCreditoResponse(w http.ResponseWriter) error         { return o.escribir(w) }
func (o respuesta) VisitMiCuentaCorrienteResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitMisMovimientosResponse(w http.ResponseWriter) error    { return o.escribir(w) }
func (o respuesta) VisitReciboCompletoResponse(w http.ResponseWriter) error    { return o.escribir(w) }

func texto(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func numero(p *float64) float64 {
	if p == nil {
		return 0
	}
	return *p
}

func admin(ctx context.Context) (*auth.Sesion, error) { return auth.Exigir(ctx, sqlc.StaffRoleAdmin) }

// pantallaDelRecibo: un recibo lo abre quien cobra (mostrador, ficha del
// cliente, pedido, conciliación); de esas, la de pedidos es la más amplia.
// El aserradero no cobra y no ve recibos.
const pantallaDelRecibo = "/admin/pedidos"

func noEsta(m string) error { return plataforma.NuevoProblema(http.StatusNotFound, m) }

// staffOInterno deja pasar al personal o al servidor de Next con el secreto.
func (a *API) staffOInterno(ctx context.Context) error {
	if a.interna.EsInterno(plataforma.PedidoDe(ctx)) {
		return nil
	}
	_, err := auth.Exigir(ctx, roles.QuienEntra("/admin/clientes")...)
	return err
}

/* ---------------------------- clientes ---------------------------- */

func (a *API) ListarClientes(ctx context.Context, r cuentasapi.ListarClientesRequestObject) (cuentasapi.ListarClientesResponseObject, error) {
	if _, err := auth.Exigir(ctx, roles.QuienEntra("/admin/clientes")...); err != nil {
		return nil, err
	}
	p := r.Params
	f := clientes.FiltrosDeClientes{Busqueda: texto(p.Busqueda), Tipo: texto(p.Tipo), Rubro: texto(p.Rubro),
		Vendedor: texto(p.Vendedor)}
	if p.Pagina != nil {
		f.Pagina = *p.Pagina
	}
	if p.Cobrar != nil {
		f.PaginaDeudores = *p.Cobrar
	}
	v, err := a.clientes.Listar(ctx, f, a.ahora())
	return ok(v), err
}

func (a *API) GuardarCliente(ctx context.Context, r cuentasapi.GuardarClienteRequestObject) (cuentasapi.GuardarClienteResponseObject, error) {
	ses, err := auth.Exigir(ctx, roles.QuienEntra("/admin/clientes")...)
	if err != nil {
		return nil, err
	}
	b := r.Body
	id, m, err := a.clientes.GuardarConID(ctx, ses, clientes.FormCliente{ID: texto(b.Id), Nombre: b.Nombre, RazonSocial: texto(b.RazonSocial),
		Cuit: texto(b.Cuit), CondicionIva: texto(b.CondicionIva), Tipo: texto(b.Tipo), Email: texto(b.Email), Telefono: texto(b.Telefono),
		Direccion: texto(b.Direccion), Rubro: texto(b.Rubro), Asesor: texto(b.Asesor), SellerID: texto(b.SellerId),
		LimiteCredito: texto(b.LimiteCredito), PriceListID: texto(b.PriceListId), Notas: texto(b.Notas)})
	if err != nil {
		return nil, err
	}
	return ok(map[string]string{"ok": m, "id": id}), nil
}

func (a *API) FichaDeCliente(ctx context.Context, r cuentasapi.FichaDeClienteRequestObject) (cuentasapi.FichaDeClienteResponseObject, error) {
	if _, err := auth.Exigir(ctx, roles.QuienEntra("/admin/clientes")...); err != nil {
		return nil, err
	}
	f, err := a.clientes.Obtener(ctx, r.Id.String())
	if errors.Is(err, clientes.ErrNoEsta) {
		return nil, noEsta("Esa ficha ya no está.")
	}
	return ok(f), err
}

type historial struct {
	Movimientos []cobros.MovimientoDelCliente `json:"movimientos"`
	HayMas      bool                          `json:"hayMas"`
	Saldo       float64                       `json:"saldo"`
}

func (a *API) historial(ctx context.Context, cliente string, periodo *string, filtro *cuentasapi.Filtro) (historial, error) {
	q := sqlc.New(a.pool)
	f := ""
	if filtro != nil {
		f = string(*filtro)
	}
	movs, hayMas, err := cobros.Historial(ctx, q, cliente, cobros.DesdeDelPeriodo(texto(periodo), a.ahora()), f, 200)
	if err != nil {
		return historial{}, err
	}
	saldo, err := q.SaldoDeCliente(ctx, cliente)
	return historial{movs, hayMas, saldo}, err
}

func (a *API) HistorialDeCliente(ctx context.Context, r cuentasapi.HistorialDeClienteRequestObject) (cuentasapi.HistorialDeClienteResponseObject, error) {
	if _, err := auth.Exigir(ctx, roles.QuienEntra("/admin/clientes")...); err != nil {
		return nil, err
	}
	h, err := a.historial(ctx, r.Id.String(), (*string)(r.Params.Periodo), r.Params.Filtro)
	return ok(h), err
}

func (a *API) ResumenDeCuenta(ctx context.Context, r cuentasapi.ResumenDeCuentaRequestObject) (cuentasapi.ResumenDeCuentaResponseObject, error) {
	if err := a.staffOInterno(ctx); err != nil {
		return nil, err
	}
	v, err := cobros.Resumen(ctx, a.pool, r.Id.String(), a.ahora())
	if errors.Is(err, cobros.ErrNoEsta) {
		return nil, noEsta("Esa ficha ya no está.")
	}
	return ok(v), err
}

func (a *API) CreditoDeCliente(ctx context.Context, r cuentasapi.CreditoDeClienteRequestObject) (cuentasapi.CreditoDeClienteResponseObject, error) {
	if _, err := auth.Exigir(ctx, roles.QuienEntra("/admin/clientes")...); err != nil {
		return nil, err
	}
	v, err := cobros.Credito(ctx, sqlc.New(a.pool), r.Id.String(), numero(r.Params.Monto), a.ahora())
	return ok(v), err
}

func (a *API) RegistrarMovimiento(ctx context.Context, r cuentasapi.RegistrarMovimientoRequestObject) (cuentasapi.RegistrarMovimientoResponseObject, error) {
	ses, err := admin(ctx)
	if err != nil {
		return nil, err
	}
	if err := a.clientes.Movimiento(ctx, ses, r.Id, r.Body.Tipo, r.Body.Monto, texto(r.Body.Detalle), texto(r.Body.Fecha)); err != nil {
		return nil, err
	}
	return mensaje("Movimiento registrado."), nil
}

func (a *API) VincularCuentaWeb(ctx context.Context, r cuentasapi.VincularCuentaWebRequestObject) (cuentasapi.VincularCuentaWebResponseObject, error) {
	ses, err := auth.Exigir(ctx, sqlc.StaffRoleAdmin, sqlc.StaffRoleVendedor)
	if err != nil {
		return nil, err
	}
	if err := a.clientes.VincularCuentaWeb(ctx, ses, r.Id, r.Body.CuentaWebId); err != nil {
		return nil, err
	}
	return mensaje("Listo: ahora ve sus pedidos y su cuenta corriente desde el sitio."), nil
}

func (a *API) BloquearCuenta(ctx context.Context, r cuentasapi.BloquearCuentaRequestObject) (cuentasapi.BloquearCuentaResponseObject, error) {
	ses, err := admin(ctx)
	if err != nil {
		return nil, err
	}
	m, err := a.clientes.Bloquear(ctx, ses, r.Id, r.Body.Bloquear, texto(r.Body.Motivo))
	if err != nil {
		return nil, err
	}
	return mensaje(m), nil
}

func (a *API) CambiarPlazo(ctx context.Context, r cuentasapi.CambiarPlazoRequestObject) (cuentasapi.CambiarPlazoResponseObject, error) {
	ses, err := admin(ctx)
	if err != nil {
		return nil, err
	}
	m, err := a.clientes.Plazo(ctx, ses, r.Id, r.Body.Dias)
	if err != nil {
		return nil, err
	}
	return mensaje(m), nil
}

/* ----------------------------- cobros ----------------------------- */

// CobrarACliente: quien mueve plata (roles.ManejanPlata). Pedía «quien
// entra a Pedidos», y el depósito emitía recibos.
func (a *API) CobrarACliente(ctx context.Context, r cuentasapi.CobrarAClienteRequestObject) (cuentasapi.CobrarAClienteResponseObject, error) {
	ses, err := auth.Exigir(ctx, roles.ManejanPlata...)
	if err != nil {
		return nil, err
	}
	v, err := a.cobros.CobrarAClienteEn(ctx, ses, r.Id, texto(r.Body.OrderId), texto(r.Body.Concepto), r.Body.Partes, texto(r.Body.Clave), texto(r.Body.BranchId))
	return ok(v), err
}

// CajaDelCobroACuenta: lo que contestaría el cobro en efectivo desde la
// ficha, antes de cobrar (quien mueve plata, como el cobro).
func (a *API) CajaDelCobroACuenta(ctx context.Context, _ cuentasapi.CajaDelCobroACuentaRequestObject) (cuentasapi.CajaDelCobroACuentaResponseObject, error) {
	if _, err := auth.Exigir(ctx, roles.ManejanPlata...); err != nil {
		return nil, err
	}
	falta, err := a.cobros.CajaDelCobroACuenta(ctx)
	if err != nil {
		return nil, err
	}
	out := map[string]any{}
	if falta != nil {
		if falta.Sucursal != "" {
			out["sinCaja"] = falta.Sucursal
			out["fondoBase"] = falta.FondoBase
		}
		if len(falta.Sucursales) > 0 {
			out["sucursales"] = falta.Sucursales
		}
	}
	return ok(out), nil
}

// AnularRecibo: quien mueve plata (roles.ManejanPlata), como el cobro.
// Decidido el 19/11: cancelar un pedido pagado pide primero el reintegro, y
// lo hacen los roles que manejan plata; el pedido con recibo vivo no se
// cancela hasta anularlo.
func (a *API) AnularRecibo(ctx context.Context, r cuentasapi.AnularReciboRequestObject) (cuentasapi.AnularReciboResponseObject, error) {
	ses, err := auth.Exigir(ctx, roles.ManejanPlata...)
	if err != nil {
		return nil, err
	}
	m, err := a.cobros.AnularConPIN(ctx, ses, r.Id, r.Body.Motivo, texto(r.Body.Pin))
	if err != nil {
		return nil, err
	}
	return mensaje(m), nil
}

func (a *API) ReciboCompleto(ctx context.Context, r cuentasapi.ReciboCompletoRequestObject) (cuentasapi.ReciboCompletoResponseObject, error) {
	id := r.Id.String()
	if !a.interna.EsInterno(plataforma.PedidoDe(ctx)) {
		ses := auth.DeContexto(ctx)
		if ses == nil {
			return nil, plataforma.NuevoProblema(http.StatusUnauthorized, "Tenés que entrar para hacer esto.")
		}
		if ses.EsStaff() && !ses.Tiene(roles.QuienEntra(pantallaDelRecibo)...) {
			return nil, noEsta("Ese recibo no está.")
		}
		if !ses.EsStaff() {
			// El cliente ve solo los suyos; uno ajeno es como si no existiera.
			dueno, err := cobros.DuenoDelRecibo(ctx, a.pool, id)
			if err != nil && !errors.Is(err, cobros.ErrNoEsta) {
				return nil, err
			}
			propio, err := a.clienteDeLaSesion(ctx, ses)
			if err != nil {
				return nil, err
			}
			if dueno == nil || propio == nil || *dueno != propio.id {
				return nil, noEsta("Ese recibo no está.")
			}
		}
	}
	v, err := cobros.Recibo(ctx, a.pool, id)
	if errors.Is(err, cobros.ErrNoEsta) {
		return nil, noEsta("Ese recibo no está.")
	}
	return ok(v), err
}

func (a *API) CargarRetencionSufrida(ctx context.Context, r cuentasapi.CargarRetencionSufridaRequestObject) (cuentasapi.CargarRetencionSufridaResponseObject, error) {
	ses, err := admin(ctx)
	if err != nil {
		return nil, err
	}
	b := r.Body
	m, err := a.cobros.CargarRetencionSufrida(ctx, ses, cobros.FormRetencion{CustomerID: texto(b.CustomerId), Numero: texto(b.Numero),
		Impuesto: texto(b.Impuesto), CodigoRegimen: texto(b.CodigoRegimen), Base: texto(b.Base), Alicuota: b.Alicuota,
		Importe: texto(b.Importe), Fecha: texto(b.Fecha), Referencia: texto(b.Referencia)})
	if err != nil {
		return nil, err
	}
	return mensaje(m), nil
}

func (o respuesta) VisitCargarRetencionSufridaResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}

/* ----------------------------- cheques ---------------------------- */

func (a *API) ListarCheques(ctx context.Context, r cuentasapi.ListarChequesRequestObject) (cuentasapi.ListarChequesResponseObject, error) {
	if _, err := auth.Exigir(ctx, roles.QuienEntra("/admin/cheques")...); err != nil {
		return nil, err
	}
	v, err := cobros.Cheques(ctx, a.pool, texto(r.Params.Estado), texto(r.Params.Sentido))
	return ok(v), err
}

// ChequesTerminados: los que ya no mueven plata, de a páginas.
func (a *API) ChequesTerminados(ctx context.Context, r cuentasapi.ChequesTerminadosRequestObject) (cuentasapi.ChequesTerminadosResponseObject, error) {
	if _, err := auth.Exigir(ctx, roles.QuienEntra("/admin/cheques")...); err != nil {
		return nil, err
	}
	limite, desplazamiento := 30, 0
	if r.Params.Limite != nil {
		limite = *r.Params.Limite
	}
	if r.Params.Desplazamiento != nil {
		desplazamiento = *r.Params.Desplazamiento
	}
	v, total, err := cobros.ChequesTerminados(ctx, a.pool, limite, desplazamiento)
	if err != nil {
		return nil, err
	}
	return ok(map[string]any{"filas": v, "total": total}), nil
}

func (a *API) ChequesEnCartera(ctx context.Context, _ cuentasapi.ChequesEnCarteraRequestObject) (cuentasapi.ChequesEnCarteraResponseObject, error) {
	if _, err := auth.Exigir(ctx, roles.QuienEntra("/admin/compras/pagos")...); err != nil {
		return nil, err
	}
	v, err := cobros.EnCartera(ctx, a.pool)
	return ok(v), err
}

func (a *API) CargarCheque(ctx context.Context, r cuentasapi.CargarChequeRequestObject) (cuentasapi.CargarChequeResponseObject, error) {
	ses, err := admin(ctx)
	if err != nil {
		return nil, err
	}
	b := r.Body
	if err := a.cobros.CargarCheque(ctx, ses, cobros.FormCheque{Sentido: texto(b.Sentido), Tipo: texto(b.Tipo), Numero: texto(b.Numero),
		Banco: texto(b.Banco), Librador: texto(b.Librador), FechaPago: texto(b.FechaPago), Importe: texto(b.Importe),
		CustomerID: texto(b.CustomerId), Circuito: texto(b.Circuito), Notas: texto(b.Notas)}); err != nil {
		return nil, err
	}
	return mensaje("Cheque cargado."), nil
}

func (a *API) CambiarEstadoDeCheque(ctx context.Context, r cuentasapi.CambiarEstadoDeChequeRequestObject) (cuentasapi.CambiarEstadoDeChequeResponseObject, error) {
	ses, err := admin(ctx)
	if err != nil {
		return nil, err
	}
	v, err := a.cobros.CambiarEstado(ctx, ses, r.Id, r.Body.Estado, texto(r.Body.Motivo))
	return ok(v), err
}

// RechazarChequeDelCliente: quien mueve plata, desde la ficha del cliente
// (H272); quien no es admin, con el PIN de uno.
func (a *API) RechazarChequeDelCliente(ctx context.Context, r cuentasapi.RechazarChequeDelClienteRequestObject) (cuentasapi.RechazarChequeDelClienteResponseObject, error) {
	ses, err := auth.Exigir(ctx, roles.ManejanPlata...)
	if err != nil {
		return nil, err
	}
	v, err := a.cobros.RechazarConPIN(ctx, ses, r.Id.String(), r.Body.Motivo, texto(r.Body.Pin))
	return ok(v), err
}

/* ---------------------------- vendedores --------------------------- */

func (a *API) ListarVendedores(ctx context.Context, r cuentasapi.ListarVendedoresRequestObject) (cuentasapi.ListarVendedoresResponseObject, error) {
	if _, err := auth.Exigir(ctx, roles.QuienEntra("/admin/clientes")...); err != nil {
		return nil, err
	}
	v, err := a.clientes.Vendedores(ctx, r.Params.Activos != nil && *r.Params.Activos)
	return ok(v), err
}

func (a *API) GuardarVendedor(ctx context.Context, r cuentasapi.GuardarVendedorRequestObject) (cuentasapi.GuardarVendedorResponseObject, error) {
	ses, err := auth.Exigir(ctx, roles.QuienEntra("/admin/clientes")...)
	if err != nil {
		return nil, err
	}
	if err := a.clientes.GuardarVendedor(ctx, ses, texto(r.Body.Id), r.Body.Nombre, texto(r.Body.Tipo)); err != nil {
		return nil, err
	}
	return mensaje("Guardado."), nil
}

func (a *API) AlternarVendedor(ctx context.Context, r cuentasapi.AlternarVendedorRequestObject) (cuentasapi.AlternarVendedorResponseObject, error) {
	ses, err := auth.Exigir(ctx, roles.QuienEntra("/admin/clientes")...)
	if err != nil {
		return nil, err
	}
	m, err := a.clientes.AlternarVendedor(ctx, ses, r.Id.String())
	if err != nil {
		return nil, err
	}
	return mensaje(m), nil
}

/* ----------------------------- personal ---------------------------- */

func (o respuesta) VisitListarPersonalResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitAltaDePersonalResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitCambiarPuestoResponse(w http.ResponseWriter) error  { return o.escribir(w) }
func (o respuesta) VisitBajaDePersonalResponse(w http.ResponseWriter) error { return o.escribir(w) }

func (a *API) ListarPersonal(ctx context.Context, _ cuentasapi.ListarPersonalRequestObject) (cuentasapi.ListarPersonalResponseObject, error) {
	if _, err := auth.Exigir(ctx, roles.QuienEntra("/admin/personal")...); err != nil {
		return nil, err
	}
	v, err := a.clientes.Personal(ctx)
	return ok(v), err
}

func (a *API) AltaDePersonal(ctx context.Context, r cuentasapi.AltaDePersonalRequestObject) (cuentasapi.AltaDePersonalResponseObject, error) {
	ses, err := auth.Exigir(ctx, roles.QuienEntra("/admin/personal")...)
	if err != nil {
		return nil, err
	}
	clave := ""
	if r.Body.Clave != nil {
		clave = *r.Body.Clave
	}
	m, quien, token, err := a.clientes.AltaDePersonal(ctx, ses, r.Body.Nombre, r.Body.Correo, clave, sqlc.StaffRole(r.Body.Rol))
	if err != nil {
		return nil, err
	}
	out := map[string]string{"ok": m}
	// Sin clave: el link para elegirla va a su correo y vuelve a la
	// pantalla, para copiarlo o mandarlo por WhatsApp (recorrido, M4-006).
	if token != "" {
		url := a.sitio + "/entrar/clave/" + token
		if a.enviarClave != nil {
			a.enviarClave(ctx, strings.TrimSpace(strings.ToLower(r.Body.Correo)), quien, url)
		}
		out["enlace"], out["nombre"] = url, quien
	}
	return ok(out), nil
}

func (a *API) CambiarPuesto(ctx context.Context, r cuentasapi.CambiarPuestoRequestObject) (cuentasapi.CambiarPuestoResponseObject, error) {
	ses, err := auth.Exigir(ctx, roles.QuienEntra("/admin/personal")...)
	if err != nil {
		return nil, err
	}
	m, err := a.clientes.CambiarPuesto(ctx, ses, r.Id, sqlc.StaffRole(r.Body.Rol))
	if err != nil {
		return nil, err
	}
	return mensaje(m), nil
}

func (a *API) BajaDePersonal(ctx context.Context, r cuentasapi.BajaDePersonalRequestObject) (cuentasapi.BajaDePersonalResponseObject, error) {
	ses, err := auth.Exigir(ctx, roles.QuienEntra("/admin/personal")...)
	if err != nil {
		return nil, err
	}
	m, err := a.clientes.BajaDePersonal(ctx, ses, r.Id)
	if err != nil {
		return nil, err
	}
	return mensaje(m), nil
}

/* ---------------------------- seguimiento -------------------------- */

func (a *API) ListarGestiones(ctx context.Context, r cuentasapi.ListarGestionesRequestObject) (cuentasapi.ListarGestionesResponseObject, error) {
	if _, err := auth.Exigir(ctx, roles.QuienEntra("/admin/clientes")...); err != nil {
		return nil, err
	}
	v, err := a.clientes.Gestiones(ctx, r.Params.Cerradas != nil && *r.Params.Cerradas, texto(r.Params.Cliente), a.ahora())
	return ok(v), err
}

func (a *API) GestionesVencidas(ctx context.Context, _ cuentasapi.GestionesVencidasRequestObject) (cuentasapi.GestionesVencidasResponseObject, error) {
	if _, err := auth.Exigir(ctx, roles.QuienEntra("/admin/clientes")...); err != nil {
		return nil, err
	}
	n, err := a.clientes.GestionesVencidas(ctx, a.ahora())
	return ok(map[string]int{"cuantas": n}), err
}

func (a *API) CrearGestion(ctx context.Context, r cuentasapi.CrearGestionRequestObject) (cuentasapi.CrearGestionResponseObject, error) {
	ses, err := auth.Exigir(ctx, roles.QuienEntra("/admin/clientes")...)
	if err != nil {
		return nil, err
	}
	b := r.Body
	if err := a.clientes.CrearGestion(ctx, ses, texto(b.CustomerId), texto(b.Asunto), texto(b.Notas), texto(b.ProximaAccion)); err != nil {
		return nil, err
	}
	return mensaje("Seguimiento anotado."), nil
}

func (a *API) MoverGestion(ctx context.Context, r cuentasapi.MoverGestionRequestObject) (cuentasapi.MoverGestionResponseObject, error) {
	ses, err := auth.Exigir(ctx, roles.QuienEntra("/admin/clientes")...)
	if err != nil {
		return nil, err
	}
	c, err := a.clientes.MoverGestion(ctx, ses, r.Id, r.Body.Etapa, texto(r.Body.Nota), texto(r.Body.ProximaAccion), a.ahora())
	if err != nil {
		return nil, err
	}
	return ok(map[string]string{"ok": "Listo.", "customerId": c}), nil
}

/* ------------------------------ portal ----------------------------- */

type clientePortal struct {
	id     string
	limite float64
	estado string
}

// clienteDeLaSesion es la ficha activa del usuario (nil si no tiene).
func (a *API) clienteDeLaSesion(ctx context.Context, ses *auth.Sesion) (*clientePortal, error) {
	var c clientePortal
	err := a.pool.QueryRow(ctx, `SELECT id, limite_credito::float8, estado::text FROM customers WHERE user_id = $1 AND active LIMIT 1`,
		ses.UserID).Scan(&c.id, &c.limite, &c.estado)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &c, err
}

func (a *API) portal(ctx context.Context) (*clientePortal, error) {
	ses, err := auth.ExigirSesion(ctx)
	if err != nil {
		return nil, err
	}
	return a.clienteDeLaSesion(ctx, ses)
}

func (a *API) MiCuentaCorriente(ctx context.Context, _ cuentasapi.MiCuentaCorrienteRequestObject) (cuentasapi.MiCuentaCorrienteResponseObject, error) {
	c, err := a.portal(ctx)
	if err != nil {
		return nil, err
	}
	if c == nil {
		return ok(cobros.CuentaCorriente{Movimientos: []cobros.MovimientoDelResumen{}}), nil
	}
	v, err := cobros.DelCliente(ctx, a.pool, c.id, c.limite)
	if err != nil {
		return nil, err
	}
	// Lo cargado a la cuenta de pedidos que todavía no se entregaron: la
	// deuda nace con el pedido (así se reserva el crédito), y el cliente veía
	// una deuda sin comprobante (H082). Se distingue, no se descuenta.
	//
	// Del acopio que ya se retiró en parte cuenta solo lo que queda, a su
	// precio y en la proporción del total (como fragmentos.SinCobrarDeLoQueSalio):
	// con 35 de 40 placas retiradas sumaba el pedido entero.
	var sinEntregar float64
	if err := a.pool.QueryRow(ctx, `SELECT coalesce(sum(m.monto * greatest(1 - coalesce((
		  SELECT sum(di.cantidad * oi.subtotal / nullif(oi.cantidad, 0)) FROM delivery_items di
		  JOIN deliveries d ON d.id = di.delivery_id AND d.estado <> 'anulada' JOIN order_items oi ON oi.id = di.order_item_id
		  WHERE d.order_id = o.id) / nullif((SELECT sum(oi.subtotal) FROM order_items oi WHERE oi.order_id = o.id), 0), 0), 0)), 0)::float8
		FROM account_movements m
		JOIN orders o ON o.numero = m.referencia AND o.customer_id = m.customer_id
		WHERE m.customer_id = $1 AND m.tipo = 'compra' AND o.estado NOT IN ('entregado', 'cancelado')
		  AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id AND i.estado <> 'borrador')`, c.id).Scan(&sinEntregar); err != nil {
		return nil, err
	}
	return ok(miCuenta{v, jsmath.Redondear2(sinEntregar)}), nil
}

type miCuenta struct {
	cobros.CuentaCorriente
	SinEntregar float64 `json:"sinEntregar"`
}

func (a *API) MisMovimientos(ctx context.Context, r cuentasapi.MisMovimientosRequestObject) (cuentasapi.MisMovimientosResponseObject, error) {
	c, err := a.portal(ctx)
	if err != nil {
		return nil, err
	}
	if c == nil {
		return ok(historial{Movimientos: []cobros.MovimientoDelCliente{}}), nil
	}
	h, err := a.historial(ctx, c.id, (*string)(r.Params.Periodo), r.Params.Filtro)
	h.Movimientos = cobros.HistorialParaElCliente(h.Movimientos)
	return ok(h), err
}

// MiCredito es creditoDisponible del portal: el saldo a favor si no tiene
// límite, la morosa, y pasarse del límite.
func (a *API) MiCredito(ctx context.Context, r cuentasapi.MiCreditoRequestObject) (cuentasapi.MiCreditoResponseObject, error) {
	v, err := CreditoDeLaSesion(ctx, a.pool, auth.DeContexto(ctx), numero(r.Params.Monto))
	if err != nil {
		return nil, err
	}
	return ok(v), nil
}
