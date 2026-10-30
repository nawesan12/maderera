package mostrador

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"

	"mjbj/internal/api/mostradorapi"
	"mjbj/internal/auth"
	"mjbj/internal/caja"
	"mjbj/internal/plataforma"
	"mjbj/internal/roles"
	"mjbj/internal/sqlc"
	"mjbj/internal/ventas"
	"mjbj/internal/zodjs"
)

// API son los handlers de api/mostrador.yaml. Las acciones de app/mostrador
// pedían requireStaff(): cualquier persona del panel. Ahora piden lo mismo que
// la pantalla /mostrador (ver puesto): el depósito y el aserradero no entran
// al mostrador, y por la API cobraban, anulaban ventas y leían el padrón.
type API struct {
	s *Servicio
}

// NuevaAPI arma los handlers.
func NuevaAPI(s *Servicio) *API { return &API{s: s} }

var _ mostradorapi.StrictServerInterface = (*API)(nil)

type respuesta struct {
	codigo int
	v      any
}

func (o respuesta) escribir(w http.ResponseWriter) error {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "private, no-store")
	w.WriteHeader(o.codigo)
	return json.NewEncoder(w).Encode(plataforma.SinNulos(o.v))
}

func ok(v any) respuesta { return respuesta{http.StatusOK, v} }

func mensaje(m string) respuesta { return ok(map[string]string{"ok": m}) }

func (o respuesta) VisitPantallaDelMostradorResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitCobrarVentaResponse(w http.ResponseWriter) error     { return o.escribir(w) }
func (o respuesta) VisitDescargarVentasResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitAnularVentaDeMostradorResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitBuscarEnMostradorResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitPreciosDelClienteResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitBuscarClientesEnMostradorResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitAltaRapidaDeClienteResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitClientesRecientesResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitClienteDelMostradorResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitSaldoDeCuentaEnMostradorResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitCobrarCuentaEnMostradorResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitPresupuestoDeMostradorResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitAbrirCajaResponse(w http.ResponseWriter) error        { return o.escribir(w) }
func (o respuesta) VisitMovimientoDeCajaResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitCerrarCajaResponse(w http.ResponseWriter) error       { return o.escribir(w) }

// comoProblema: un Rechazo es un 422 con su mensaje (lo que la acción
// devolvía como `error`).
func comoProblema(err error) error {
	var r *Rechazo
	if errors.As(err, &r) {
		return plataforma.Invalido(map[string]string{"error": r.Mensaje})
	}
	return err
}

// puesto es quien entra a /mostrador.
func puesto(ctx context.Context) (*auth.Sesion, error) {
	return auth.Exigir(ctx, roles.QuienEntra("/mostrador")...)
}

func (a *API) PantallaDelMostrador(ctx context.Context, r mostradorapi.PantallaDelMostradorRequestObject) (mostradorapi.PantallaDelMostradorResponseObject, error) {
	if _, err := puesto(ctx); err != nil {
		return nil, err
	}
	p, err := a.s.Pantalla(ctx, r.Params.Sucursal)
	return ok(p), err
}

func (a *API) CobrarVenta(ctx context.Context, r mostradorapi.CobrarVentaRequestObject) (mostradorapi.CobrarVentaResponseObject, error) {
	ses, err := puesto(ctx)
	if err != nil {
		return nil, err
	}
	v, l := LeerVentaDeAccion(map[string]any(*r.Body))
	if _, m := l.Primero(); m != "" {
		// La acción mostraba issues[0].message tal cual.
		return nil, plataforma.Invalido(map[string]string{"error": m})
	}
	res, err := a.s.Cobrar(ctx, ses, v)
	return ok(res), err
}

func (a *API) DescargarVentas(ctx context.Context, r mostradorapi.DescargarVentasRequestObject) (mostradorapi.DescargarVentasResponseObject, error) {
	ses, err := puesto(ctx)
	if err != nil {
		return nil, err
	}
	lote, l := LeerLoteDeLaCola(r.Body.Cuerpo)
	if _, m := l.Primero(); m != "" {
		return respuesta{http.StatusBadRequest, map[string]any{"error": "cuerpo", "detalle": m}}, nil
	}
	return ok(a.s.Descargar(ctx, ses, lote)), nil
}

func (a *API) AnularVentaDeMostrador(ctx context.Context, r mostradorapi.AnularVentaDeMostradorRequestObject) (mostradorapi.AnularVentaDeMostradorResponseObject, error) {
	ses, err := puesto(ctx)
	if err != nil {
		return nil, err
	}
	res, err := a.s.Anular(ctx, r.Id, r.Body.Motivo, ses.UserID)
	if err != nil {
		return nil, err
	}
	if !res.Ok {
		return nil, plataforma.Invalido(map[string]string{"error": res.Error})
	}
	a.s.anotar(ctx, ses, sqlc.AccionAuditoriaAnular, "pedido", r.Id, "Anuló una venta de mostrador: "+zodjs.TrimJS(r.Body.Motivo), nil)
	out := map[string]any{"ok": "Venta anulada."}
	if res.FacturaPendiente != nil {
		out["facturaPendiente"] = *res.FacturaPendiente
	}
	return ok(out), nil
}

func (a *API) BuscarEnMostrador(ctx context.Context, r mostradorapi.BuscarEnMostradorRequestObject) (mostradorapi.BuscarEnMostradorResponseObject, error) {
	if _, err := puesto(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.Buscar(ctx, r.Params.Q, r.Params.Sucursal, vacioANulo(r.Params.Cliente))
	return ok(v), err
}

func vacioANulo(p *string) *string {
	if p == nil || *p == "" {
		return nil
	}
	return p
}

func (a *API) PreciosDelCliente(ctx context.Context, r mostradorapi.PreciosDelClienteRequestObject) (mostradorapi.PreciosDelClienteResponseObject, error) {
	if _, err := puesto(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.PreciosPara(ctx, r.Body.VariantIds, vacioANulo(r.Body.CustomerId))
	return ok(v), err
}

func (a *API) BuscarClientesEnMostrador(ctx context.Context, r mostradorapi.BuscarClientesEnMostradorRequestObject) (mostradorapi.BuscarClientesEnMostradorResponseObject, error) {
	if _, err := puesto(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.BuscarClientes(ctx, r.Params.Q)
	return ok(v), err
}

func (a *API) AltaRapidaDeCliente(ctx context.Context, r mostradorapi.AltaRapidaDeClienteRequestObject) (mostradorapi.AltaRapidaDeClienteResponseObject, error) {
	ses, err := puesto(ctx)
	if err != nil {
		return nil, err
	}
	alta, l := LeerAltaRapida(map[string]any(*r.Body))
	if _, m := l.Primero(); m != "" {
		return ok(ResultadoAlta{Error: m}), nil
	}
	v, err := a.s.AltaRapida(ctx, ses, alta)
	return ok(v), err
}

func (a *API) ClientesRecientes(ctx context.Context, r mostradorapi.ClientesRecientesRequestObject) (mostradorapi.ClientesRecientesResponseObject, error) {
	if _, err := puesto(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.ClientesRecientes(ctx, r.Params.Sucursal)
	return ok(v), err
}

func (a *API) ClienteDelMostrador(ctx context.Context, r mostradorapi.ClienteDelMostradorRequestObject) (mostradorapi.ClienteDelMostradorResponseObject, error) {
	if _, err := puesto(ctx); err != nil {
		return nil, err
	}
	c, err := a.s.ClientePorID(ctx, r.Id)
	if c == nil {
		return respuesta{http.StatusOK, nil}, err
	}
	return ok(c), err
}

func (a *API) SaldoDeCuentaEnMostrador(ctx context.Context, r mostradorapi.SaldoDeCuentaEnMostradorRequestObject) (mostradorapi.SaldoDeCuentaEnMostradorResponseObject, error) {
	if _, err := puesto(ctx); err != nil {
		return nil, err
	}
	s, err := a.s.SaldoDeCuenta(ctx, r.Id)
	return ok(map[string]float64{"saldo": s}), err
}

func (a *API) CobrarCuentaEnMostrador(ctx context.Context, r mostradorapi.CobrarCuentaEnMostradorRequestObject) (mostradorapi.CobrarCuentaEnMostradorResponseObject, error) {
	ses, err := puesto(ctx)
	if err != nil {
		return nil, err
	}
	v, err := a.s.CobrarCuenta(ctx, ses, r.Id, r.Body.BranchId, r.Body.Partes)
	if err != nil {
		return nil, comoProblema(err)
	}
	return ok(v), nil
}

func (a *API) PresupuestoDeMostrador(ctx context.Context, r mostradorapi.PresupuestoDeMostradorRequestObject) (mostradorapi.PresupuestoDeMostradorResponseObject, error) {
	ses, err := puesto(ctx)
	if err != nil {
		return nil, err
	}
	p, l := LeerPresupuesto(map[string]any(*r.Body))
	if _, m := l.Primero(); m != "" {
		return nil, plataforma.Invalido(map[string]string{"error": m})
	}
	id, numero, err := a.s.Presupuesto(ctx, ses, p)
	if err != nil {
		return nil, err
	}
	return ok(map[string]string{"ok": "Presupuesto " + numero + " emitido.", "quoteId": id, "numero": numero}), nil
}

func numeroONaN(p *float64) float64 {
	if p == nil {
		return math.NaN() // el NaN de JS llega como null
	}
	return *p
}

func (a *API) AbrirCaja(ctx context.Context, r mostradorapi.AbrirCajaRequestObject) (mostradorapi.AbrirCajaResponseObject, error) {
	ses, err := puesto(ctx)
	if err != nil {
		return nil, err
	}
	m, err := a.s.AbrirCaja(ctx, ses, r.Body.BranchId, numeroONaN(r.Body.FondoInicial))
	if err != nil {
		return nil, comoProblema(err)
	}
	return mensaje(m), nil
}

func (a *API) MovimientoDeCaja(ctx context.Context, r mostradorapi.MovimientoDeCajaRequestObject) (mostradorapi.MovimientoDeCajaResponseObject, error) {
	ses, err := puesto(ctx)
	if err != nil {
		return nil, err
	}
	m, err := a.s.MovimientoDeCaja(ctx, ses, r.Body.SessionId, string(r.Body.Tipo), numeroONaN(r.Body.Monto), r.Body.Motivo)
	if err != nil {
		return nil, comoProblema(err)
	}
	return mensaje(m), nil
}

func (a *API) CerrarCaja(ctx context.Context, r mostradorapi.CerrarCajaRequestObject) (mostradorapi.CerrarCajaResponseObject, error) {
	ses, err := puesto(ctx)
	if err != nil {
		return nil, err
	}
	m, err := a.s.CerrarCaja(ctx, ses, r.Body.SessionId, numeroONaN(r.Body.Contado), r.Body.Notas)
	if err != nil {
		return nil, comoProblema(err)
	}
	return mensaje(m), nil
}

// --- lo que arman los handlers ---

// Pantalla es lo que lee page.tsx del mostrador.
type Pantalla struct {
	Turno        *caja.TurnoAbierto      `json:"turno"`
	Movimientos  []caja.Movimiento       `json:"movimientos"`
	Cierre       []caja.RenglonDelCierre `json:"cierre"`
	Ventas       []caja.VentaDeHoy       `json:"ventas"`
	ListaGeneral *string                 `json:"listaGeneral"`
	FondoBase    float64                 `json:"fondoBase"`
}

// Pantalla junta el turno, sus movimientos, el cierre Z, las ventas de hoy,
// la lista general y el fondo de cambio de la sucursal.
func (s *Servicio) Pantalla(ctx context.Context, sucursal string) (Pantalla, error) {
	p := Pantalla{Movimientos: []caja.Movimiento{}, Cierre: []caja.RenglonDelCierre{}, Ventas: []caja.VentaDeHoy{}}
	if !plataforma.UUIDValido(sucursal) {
		return p, nil
	}
	var err error
	if p.Turno, err = caja.Abierto(ctx, s.pool, sucursal); err != nil {
		return p, err
	}
	if p.Ventas, err = caja.VentasDeHoy(ctx, s.pool, sucursal, s.ahora()); err != nil {
		return p, err
	}
	lista, err := ListaDelCliente(ctx, s.pool, nil)
	if err != nil {
		return p, err
	}
	p.ListaGeneral = lista.GeneralID
	if p.FondoBase, err = caja.FondoBase(ctx, s.pool, sucursal); err != nil {
		return p, err
	}
	if p.Turno != nil {
		if p.Movimientos, err = caja.MovimientosDelTurno(ctx, s.pool, p.Turno.ID); err != nil {
			return p, err
		}
		if p.Cierre, err = caja.CierreDelTurno(ctx, s.pool, p.Turno.ID); err != nil {
			return p, err
		}
	}
	return p, nil
}

// Cobrar es cobrarVenta: la venta en línea, con su bitácora si es nueva. El
// comprobante fiscal lo emite Next después (facturación sigue en TS).
func (s *Servicio) Cobrar(ctx context.Context, ses *auth.Sesion, v VentaPedida) (ResultadoVenta, error) {
	r, err := s.RegistrarVenta(ctx, v, ses.UserID)
	if err != nil || !r.Ok {
		return r, err
	}
	if r.Nueva {
		s.anotar(ctx, ses, sqlc.AccionAuditoriaCrear, "pedido", "", "Venta de mostrador "+r.Numero+" por $"+f2(r.Total), nil)
	}
	return r, nil
}

// FiscalPendiente es lo que Next necesita para emitir el comprobante de una
// venta de la cola.
type FiscalPendiente struct {
	CustomerID     *string               `json:"customerId"`
	ReceptorNombre string                `json:"receptorNombre"`
	Cuit           *string               `json:"cuit"`
	Lineas         []ventas.LineaDeVenta `json:"lineas"`
}

// ResultadoDeCola es lo que pasó con una venta de la cola.
type ResultadoDeCola struct {
	Clave   string           `json:"clave"`
	Estado  string           `json:"estado"` // sincronizada | rechazada | reintentar
	Numero  string           `json:"numero,omitempty"`
	OrderID string           `json:"orderId,omitempty"`
	Nueva   *bool            `json:"nueva,omitempty"`
	Motivo  string           `json:"motivo,omitempty"`
	Fiscal  *FiscalPendiente `json:"fiscal,omitempty"`
}

// Descarga es la respuesta de la cola.
type Descarga struct {
	Resultados []ResultadoDeCola `json:"resultados"`
	ServidorAt string            `json:"servidorAt"`
}

// Descargar es el drenaje de la cola (app/api/mostrador/ventas): una por una
// y en orden (la serie PED sigue el orden real de venta). Una regla de
// negocio es «rechazada» (no se arregla insistiendo); cualquier otra cosa,
// «reintentar». Las de la cola entran aunque pasen el límite de cuenta
// corriente: ya sucedieron.
func (s *Servicio) Descargar(ctx context.Context, ses *auth.Sesion, lote []VentaPedida) Descarga {
	out := Descarga{Resultados: []ResultadoDeCola{}}
	for _, v := range lote {
		// Quien vendió, no quien drena, si es alguien real. El TS lo decía y
		// no lo miraba: con un usuario que ya no existe, la caja (y el
		// movimiento de caja, con su clave foránea) fallaban y la venta
		// quedaba en «reintentar» para siempre.
		usuario := ses.UserID
		if v.UsuarioID != nil && *v.UsuarioID != ses.UserID {
			var existe bool
			if err := s.pool.QueryRow(ctx, `SELECT exists(SELECT 1 FROM "user" WHERE id = $1)`, *v.UsuarioID).Scan(&existe); err == nil && existe {
				usuario = *v.UsuarioID
			}
		}
		v.Autorizado = true
		r, err := s.RegistrarVenta(ctx, v, usuario)
		if err != nil {
			s.log.Error("mostrador.drenaje", "clave", v.Clave, "error", err)
			out.Resultados = append(out.Resultados, ResultadoDeCola{Clave: v.Clave, Estado: "reintentar", Motivo: "No se pudo guardar en este momento."})
			continue
		}
		if !r.Ok {
			out.Resultados = append(out.Resultados, ResultadoDeCola{Clave: v.Clave, Estado: "rechazada", Motivo: r.Error})
			continue
		}
		prov := ""
		if v.NumeroProvisorio != nil {
			prov = *v.NumeroProvisorio
		}
		if r.Nueva {
			s.anotar(ctx, ses, sqlc.AccionAuditoriaCrear, "pedido", r.OrderID, "Venta sin conexión "+prov+" → "+r.Numero+", subida por "+ses.Nombre, nil)
		}
		nueva := r.Nueva
		res := ResultadoDeCola{Clave: v.Clave, Estado: "sincronizada", Numero: r.Numero, OrderID: r.OrderID, Nueva: &nueva}
		if v.Comprobante == "fiscal" && r.Nueva {
			// Con las líneas de la venta, ya con el descuento repartido (el TS
			// mandaba las de entrada: ver progreso.md, tanda 5).
			res.Fiscal = &FiscalPendiente{CustomerID: v.CustomerID, ReceptorNombre: v.ContactoNombre, Cuit: v.Cuit, Lineas: r.Lineas}
		}
		out.Resultados = append(out.Resultados, res)
	}
	out.ServidorAt = FechaJS(s.ahora())
	return out
}
