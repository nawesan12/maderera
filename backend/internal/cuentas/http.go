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
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/api/cuentasapi"
	"mjbj/internal/auth"
	"mjbj/internal/clientes"
	"mjbj/internal/cobros"
	"mjbj/internal/plataforma"
	"mjbj/internal/sqlc"
)

// API son los handlers.
type API struct {
	pool     *pgxpool.Pool
	clientes *clientes.Servicio
	cobros   *cobros.Servicio
	interna  plataforma.ConfigInterna
	ahora    func() time.Time
}

// NuevaAPI arma los handlers.
func NuevaAPI(pool *pgxpool.Pool, cl *clientes.Servicio, co *cobros.Servicio, interna plataforma.ConfigInterna) *API {
	return &API{pool: pool, clientes: cl, cobros: co, interna: interna, ahora: time.Now}
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
func (o respuesta) VisitCambiarEstadoDeChequeResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitListarClientesResponse(w http.ResponseWriter) error     { return o.escribir(w) }
func (o respuesta) VisitGuardarClienteResponse(w http.ResponseWriter) error     { return o.escribir(w) }
func (o respuesta) VisitFichaDeClienteResponse(w http.ResponseWriter) error     { return o.escribir(w) }
func (o respuesta) VisitBloquearCuentaResponse(w http.ResponseWriter) error     { return o.escribir(w) }
func (o respuesta) VisitCobrarAClienteResponse(w http.ResponseWriter) error     { return o.escribir(w) }
func (o respuesta) VisitCreditoDeClienteResponse(w http.ResponseWriter) error   { return o.escribir(w) }
func (o respuesta) VisitVincularCuentaWebResponse(w http.ResponseWriter) error  { return o.escribir(w) }
func (o respuesta) VisitHistorialDeClienteResponse(w http.ResponseWriter) error { return o.escribir(w) }
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

func noEsta(m string) error { return plataforma.NuevoProblema(http.StatusNotFound, m) }

// staffOInterno deja pasar al personal o al servidor de Next con el secreto.
func (a *API) staffOInterno(ctx context.Context) error {
	if a.interna.EsInterno(plataforma.PedidoDe(ctx)) {
		return nil
	}
	_, err := auth.ExigirStaff(ctx)
	return err
}

/* ---------------------------- clientes ---------------------------- */

func (a *API) ListarClientes(ctx context.Context, r cuentasapi.ListarClientesRequestObject) (cuentasapi.ListarClientesResponseObject, error) {
	if _, err := auth.ExigirStaff(ctx); err != nil {
		return nil, err
	}
	p := r.Params
	v, err := a.clientes.Listar(ctx, clientes.FiltrosDeClientes{Busqueda: texto(p.Busqueda), Tipo: texto(p.Tipo), Rubro: texto(p.Rubro),
		Vendedor: texto(p.Vendedor)}, a.ahora())
	return ok(v), err
}

func (a *API) GuardarCliente(ctx context.Context, r cuentasapi.GuardarClienteRequestObject) (cuentasapi.GuardarClienteResponseObject, error) {
	ses, err := auth.ExigirStaff(ctx)
	if err != nil {
		return nil, err
	}
	b := r.Body
	m, err := a.clientes.Guardar(ctx, ses, clientes.FormCliente{ID: texto(b.Id), Nombre: b.Nombre, RazonSocial: texto(b.RazonSocial),
		Cuit: texto(b.Cuit), CondicionIva: texto(b.CondicionIva), Tipo: texto(b.Tipo), Email: texto(b.Email), Telefono: texto(b.Telefono),
		Direccion: texto(b.Direccion), Rubro: texto(b.Rubro), Asesor: texto(b.Asesor), SellerID: texto(b.SellerId),
		LimiteCredito: texto(b.LimiteCredito), PriceListID: texto(b.PriceListId), Notas: texto(b.Notas)})
	if err != nil {
		return nil, err
	}
	return mensaje(m), nil
}

func (a *API) FichaDeCliente(ctx context.Context, r cuentasapi.FichaDeClienteRequestObject) (cuentasapi.FichaDeClienteResponseObject, error) {
	if _, err := auth.ExigirStaff(ctx); err != nil {
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
	if _, err := auth.ExigirStaff(ctx); err != nil {
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
	if _, err := auth.ExigirStaff(ctx); err != nil {
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
	if err := a.clientes.Movimiento(ctx, ses, r.Id, r.Body.Tipo, r.Body.Monto, texto(r.Body.Detalle)); err != nil {
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

func (a *API) CobrarACliente(ctx context.Context, r cuentasapi.CobrarAClienteRequestObject) (cuentasapi.CobrarAClienteResponseObject, error) {
	ses, err := auth.ExigirStaff(ctx)
	if err != nil {
		return nil, err
	}
	v, err := a.cobros.CobrarACliente(ctx, ses, r.Id, texto(r.Body.OrderId), texto(r.Body.Concepto), r.Body.Partes)
	return ok(v), err
}

func (a *API) AnularRecibo(ctx context.Context, r cuentasapi.AnularReciboRequestObject) (cuentasapi.AnularReciboResponseObject, error) {
	ses, err := admin(ctx)
	if err != nil {
		return nil, err
	}
	m, err := a.cobros.Anular(ctx, ses, r.Id, r.Body.Motivo)
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
	if _, err := auth.ExigirStaff(ctx); err != nil {
		return nil, err
	}
	v, err := cobros.Cheques(ctx, a.pool, texto(r.Params.Estado), texto(r.Params.Sentido))
	return ok(v), err
}

func (a *API) ChequesEnCartera(ctx context.Context, _ cuentasapi.ChequesEnCarteraRequestObject) (cuentasapi.ChequesEnCarteraResponseObject, error) {
	if _, err := auth.ExigirStaff(ctx); err != nil {
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

/* ---------------------------- vendedores --------------------------- */

func (a *API) ListarVendedores(ctx context.Context, r cuentasapi.ListarVendedoresRequestObject) (cuentasapi.ListarVendedoresResponseObject, error) {
	if _, err := auth.ExigirStaff(ctx); err != nil {
		return nil, err
	}
	v, err := a.clientes.Vendedores(ctx, r.Params.Activos != nil && *r.Params.Activos)
	return ok(v), err
}

func (a *API) GuardarVendedor(ctx context.Context, r cuentasapi.GuardarVendedorRequestObject) (cuentasapi.GuardarVendedorResponseObject, error) {
	ses, err := auth.ExigirStaff(ctx)
	if err != nil {
		return nil, err
	}
	if err := a.clientes.GuardarVendedor(ctx, ses, texto(r.Body.Id), r.Body.Nombre, texto(r.Body.Tipo)); err != nil {
		return nil, err
	}
	return mensaje("Guardado."), nil
}

func (a *API) AlternarVendedor(ctx context.Context, r cuentasapi.AlternarVendedorRequestObject) (cuentasapi.AlternarVendedorResponseObject, error) {
	ses, err := auth.ExigirStaff(ctx)
	if err != nil {
		return nil, err
	}
	m, err := a.clientes.AlternarVendedor(ctx, ses, r.Id.String())
	if err != nil {
		return nil, err
	}
	return mensaje(m), nil
}

/* ---------------------------- seguimiento -------------------------- */

func (a *API) ListarGestiones(ctx context.Context, r cuentasapi.ListarGestionesRequestObject) (cuentasapi.ListarGestionesResponseObject, error) {
	if _, err := auth.ExigirStaff(ctx); err != nil {
		return nil, err
	}
	v, err := a.clientes.Gestiones(ctx, r.Params.Cerradas != nil && *r.Params.Cerradas, texto(r.Params.Cliente), a.ahora())
	return ok(v), err
}

func (a *API) GestionesVencidas(ctx context.Context, _ cuentasapi.GestionesVencidasRequestObject) (cuentasapi.GestionesVencidasResponseObject, error) {
	if _, err := auth.ExigirStaff(ctx); err != nil {
		return nil, err
	}
	n, err := a.clientes.GestionesVencidas(ctx, a.ahora())
	return ok(map[string]int{"cuantas": n}), err
}

func (a *API) CrearGestion(ctx context.Context, r cuentasapi.CrearGestionRequestObject) (cuentasapi.CrearGestionResponseObject, error) {
	ses, err := auth.ExigirStaff(ctx)
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
	ses, err := auth.ExigirStaff(ctx)
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
	return ok(v), err
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
