package mostrador

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"math"
	"net/http"

	"mjbj/internal/api/mostradorapi"
	"mjbj/internal/auth"
	"mjbj/internal/autorizacion"
	"mjbj/internal/caja"
	"mjbj/internal/facturacion"
	"mjbj/internal/formato"
	"mjbj/internal/jsmath"
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
func (o respuesta) VisitAbrirCajaResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitDevolucionDeMostradorDatosResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitDevolucionDeMostradorResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitDevolucionDeMostradorCalculoResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitMovimientoDeCajaResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitCerrarCajaResponse(w http.ResponseWriter) error       { return o.escribir(w) }
func (o respuesta) VisitDesvincularTerminalResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}

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
	b := r.Body
	pedido := PedidoDeAnulacion{Motivo: b.Motivo, VolvioLaMercaderia: b.VolvioLaMercaderia == nil || *b.VolvioLaMercaderia}
	if b.Pin != nil {
		pedido.PIN = *b.Pin
	}
	if b.Ficha != nil {
		pedido.Ficha = *b.Ficha
	}
	res, err := a.s.Anular(ctx, ses, r.Id, pedido)
	if err != nil {
		return nil, err
	}
	if res.Autorizacion != nil {
		// Falta el PIN: no es un error del formulario, la pantalla lo pide.
		return ok(map[string]any{"error": res.Error, "autorizacion": res.Autorizacion}), nil
	}
	if !res.Ok {
		return nil, plataforma.Invalido(map[string]string{"error": res.Error})
	}
	desc := "Anuló la venta " + res.Numero + " (" + formato.Importe(res.Total) + "): " + zodjs.TrimJS(b.Motivo)
	if !pedido.VolvioLaMercaderia {
		desc += ". La mercadería no volvió"
	}
	var detalle any
	if res.AutorizadoPor != "" || !pedido.VolvioLaMercaderia {
		detalle = map[string]any{"autorizadoPor": res.AutorizadoPor, "volvioLaMercaderia": pedido.VolvioLaMercaderia, "total": res.Total}
	}
	a.s.anotar(ctx, ses, sqlc.AccionAuditoriaAnular, "pedido", r.Id, desc, detalle)
	out := map[string]any{"ok": "Venta anulada.", "porAfuera": res.PorAfuera}
	if res.PorAfuera > 0.005 {
		out["ok"] = "Venta anulada. Por afuera se devuelven " + formato.Moneda(res.PorAfuera) + "."
	}
	if res.FacturaPendiente != nil {
		out["facturaPendiente"] = *res.FacturaPendiente
		out["facturaSinCae"] = res.FacturaSinCAE
		// El vendedor no entra a Facturación: la factura que quedó viva se
		// le avisa a administración en el momento, en vez de mandarlo a una
		// pantalla que no puede abrir (mes simulado, H178). En Caja queda
		// marcada como «factura sin nota de crédito» hasta que se resuelva.
		if !ses.Tiene(sqlc.StaffRoleAdmin) {
			que := "emitirle la nota de crédito"
			if res.FacturaSinCAE {
				que = "darla de baja"
			}
			a.s.aut.Avisar(ctx, "Factura de una venta anulada", res.Numero+" se anuló en el mostrador ("+ses.Nombre+") y su factura quedó viva: hay que "+que+".")
			out["avisado"] = true
		}
	}
	// Lo que tenía la venta, para «Rehacer»: anular y volver a cargarla con
	// otro cliente sin que el stock salga dos veces (H269). El precio es el de
	// lista del renglón (el descuento de la venta ya estaba repartido en el
	// precio, y rehacerla lo aplicaría otra vez). Los renglones de un corte
	// no: el corte se vuelve a armar.
	renglones, conCorte, err := renglonesParaRehacer(ctx, a.s, r.Id)
	if err != nil {
		return nil, err
	}
	out["renglones"], out["conCorte"] = renglones, conCorte
	return ok(out), nil
}

// renglonesParaRehacer son los renglones de la venta que no salen de un
// corte, con su precio de lista si lo tienen.
func renglonesParaRehacer(ctx context.Context, s *Servicio, pedido string) ([]map[string]any, bool, error) {
	filas, err := s.pool.Query(ctx, `
		SELECT variant_id, descripcion, unidad, cantidad, coalesce(precio_lista, precio_unitario), presentacion, del_corte
		FROM order_items WHERE order_id::text = $1 ORDER BY orden, id`, pedido)
	if err != nil {
		return nil, false, err
	}
	defer filas.Close()
	out := []map[string]any{}
	conCorte := false
	for filas.Next() {
		var variante, presentacion *string
		var descripcion, unidad string
		var cantidad, precio jsmath.Num
		var delCorte bool
		if err := filas.Scan(&variante, &descripcion, &unidad, &cantidad, &precio, &presentacion, &delCorte); err != nil {
			return nil, false, err
		}
		if delCorte {
			conCorte = true
			continue
		}
		out = append(out, map[string]any{"variantId": variante, "descripcion": descripcion, "unidad": unidad,
			"cantidad": cantidad.F(), "precioUnitario": precio.F(), "presentacion": presentacion})
	}
	return out, conCorte, filas.Err()
}

// facturaDeLaVenta es la factura (no su nota) de una venta del mostrador.
func (a *API) facturaDeLaVenta(ctx context.Context, pedido string) (string, error) {
	var id string
	err := a.s.pool.QueryRow(ctx, `SELECT i.id::text FROM invoices i JOIN orders o ON o.id = i.order_id
		WHERE o.id::text = $1 AND o.origen = 'mostrador' AND i.tipo::text NOT LIKE 'nota%' AND i.estado <> 'anulada'
		ORDER BY i.created_at LIMIT 1`, pedido).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", plataforma.NuevoProblema(http.StatusNotFound, "Esa venta no tiene factura: anulala y volvé a cobrar lo que se lleva.")
	}
	return id, err
}

// DevolucionDeMostradorDatos es la ficha de la devolución desde el
// mostrador (mes simulado, H270): devolver uno de cuatro obligaba a anular
// la venta entera, devolver todo a la tarjeta y cobrar de nuevo.
func (a *API) DevolucionDeMostradorDatos(ctx context.Context, r mostradorapi.DevolucionDeMostradorDatosRequestObject) (mostradorapi.DevolucionDeMostradorDatosResponseObject, error) {
	if _, err := puesto(ctx); err != nil {
		return nil, err
	}
	if a.s.fac == nil {
		return nil, plataforma.NuevoProblema(http.StatusNotFound, "La devolución no está disponible.")
	}
	factura, err := a.facturaDeLaVenta(ctx, r.Id)
	if err != nil {
		return nil, err
	}
	d, err := a.s.fac.ParaDevolver(ctx, factura)
	if err != nil || d == nil {
		if err == nil || errors.Is(err, facturacion.ErrNoEsta) {
			return nil, plataforma.NuevoProblema(http.StatusNotFound, "Esa venta no tiene nada para devolver.")
		}
		return nil, err
	}
	return ok(d), nil
}

func renglonesDelMostrador(rs []mostradorapi.MostradorRenglonADevolver) []facturacion.RenglonADevolver {
	out := make([]facturacion.RenglonADevolver, len(rs))
	for i, x := range rs {
		out[i] = facturacion.RenglonADevolver{ItemID: x.ItemId, Cantidad: x.Cantidad, AlStock: x.AlStock, DelAcopio: x.DelAcopio}
	}
	return out
}

func (a *API) DevolucionDeMostradorCalculo(ctx context.Context, r mostradorapi.DevolucionDeMostradorCalculoRequestObject) (mostradorapi.DevolucionDeMostradorCalculoResponseObject, error) {
	if _, err := puesto(ctx); err != nil {
		return nil, err
	}
	factura, err := a.facturaDeLaVenta(ctx, r.Id)
	if err != nil {
		return nil, err
	}
	total, err := a.s.fac.CalcularDevolucion(ctx, factura, renglonesDelMostrador(r.Body.Renglones))
	if err != nil {
		if m := facturacion.Mensaje(err); m != "" {
			return nil, plataforma.Invalido(map[string]string{"error": m})
		}
		return nil, err
	}
	return ok(map[string]float64{"importe": total}), nil
}

// DevolucionDeMostrador la hace. Un vendedor necesita el PIN (o la
// contraseña) de un admin por el importe, como para anular: es plata que
// sale de la venta. La sesión de un admin ya firma.
func (a *API) DevolucionDeMostrador(ctx context.Context, r mostradorapi.DevolucionDeMostradorRequestObject) (mostradorapi.DevolucionDeMostradorResponseObject, error) {
	ses, err := puesto(ctx)
	if err != nil {
		return nil, err
	}
	factura, err := a.facturaDeLaVenta(ctx, r.Id)
	if err != nil {
		return nil, err
	}
	b := r.Body
	pin, ficha := "", ""
	if b.Pin != nil {
		pin = *b.Pin
	}
	if b.Ficha != nil {
		ficha = *b.Ficha
	}
	var sucursal string
	_ = a.s.pool.QueryRow(ctx, `SELECT coalesce(branch_id::text, '') FROM orders WHERE id::text = $1`, r.Id).Scan(&sucursal)
	firma, err := a.s.aut.Exigir(ctx, ses, autorizacion.Pedido{Motivo: autorizacion.Anular, Monto: b.Importe, Clave: "devolucion:" + b.Clave,
		Sucursal: sucursal, PIN: pin, Ficha: ficha})
	var falta *autorizacion.Falta
	if errors.As(err, &falta) {
		fa := faltaDeAutorizacion(falta)
		return ok(map[string]any{"error": fa.Error, "autorizacion": fa.Autorizacion}), nil
	}
	if err != nil {
		return nil, err
	}
	p := facturacion.PedidoDeDevolucion{InvoiceID: factura, Clave: b.Clave, Destino: string(b.Destino), Motivo: b.Motivo,
		Importe: &b.Importe, Renglones: renglonesDelMostrador(b.Renglones)}
	if b.SinStock != nil {
		p.SinStock = string(*b.SinStock)
	}
	if b.SucursalId != nil {
		p.BranchID = *b.SucursalId
	}
	d, err := a.s.fac.DevolucionParcial(ctx, ses.UserID, p)
	if err != nil {
		if m := facturacion.Mensaje(err); m != "" {
			return nil, plataforma.Invalido(map[string]string{"error": m})
		}
		return nil, err
	}
	if !d.Repetida {
		desc := "Devolución de " + formato.Importe(d.Importe) + " por " + p.Destino + " desde el mostrador: " + zodjs.TrimJS(p.Motivo)
		if firma != nil && firma.UserID != ses.UserID {
			desc += " (autorizó " + firma.Nombre + ")"
		}
		a.s.anotar(ctx, ses, sqlc.AccionAuditoriaCrear, "factura", factura, desc, map[string]any{"devolucionId": d.ID, "notaDeCreditoId": d.NotaID})
	}
	return ok(map[string]any{"ok": "Devolución de " + formato.Importe(d.Importe) + " hecha.", "notaId": d.NotaID}), nil
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
	if err != nil {
		return nil, err
	}
	pendientes, err := a.s.PedidosSinCobrar(ctx, r.Id)
	return ok(map[string]any{"saldo": s, "sinCobrar": pendientes}), err
}

func (a *API) CobrarCuentaEnMostrador(ctx context.Context, r mostradorapi.CobrarCuentaEnMostradorRequestObject) (mostradorapi.CobrarCuentaEnMostradorResponseObject, error) {
	ses, err := puesto(ctx)
	if err != nil {
		return nil, err
	}
	clave := ""
	if r.Body.Clave != nil {
		clave = *r.Body.Clave
	}
	v, err := a.s.CobrarCuenta(ctx, ses, r.Id, r.Body.BranchId, r.Body.Partes, clave)
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

// DesvincularTerminal es solo del admin (el default prudente del comité
// final): soltar una terminal deja esa PC sin poder cobrar sin conexión.
func (a *API) DesvincularTerminal(ctx context.Context, r mostradorapi.DesvincularTerminalRequestObject) (mostradorapi.DesvincularTerminalResponseObject, error) {
	ses, err := auth.Exigir(ctx, sqlc.StaffRoleAdmin)
	if err != nil {
		return nil, err
	}
	locales := 0
	if r.Body.Pendientes != nil {
		locales = *r.Body.Pendientes
	}
	m, err := a.s.Desvincular(ctx, ses, r.Body.CajaId, locales)
	if err != nil {
		return nil, comoProblema(err)
	}
	return mensaje(m), nil
}

func (a *API) AbrirCaja(ctx context.Context, r mostradorapi.AbrirCajaRequestObject) (mostradorapi.AbrirCajaResponseObject, error) {
	ses, err := puesto(ctx)
	if err != nil {
		return nil, err
	}
	motivo, puesto := "", ""
	if r.Body.Motivo != nil {
		motivo = *r.Body.Motivo
	}
	if r.Body.CajaId != nil {
		puesto = *r.Body.CajaId
	}
	m, err := a.s.AbrirCaja(ctx, ses, r.Body.BranchId, numeroONaN(r.Body.FondoInicial), motivo, puesto)
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
	// DescuentoLibrePct: la pantalla avisa apenas una venta lo pasa, antes
	// de cobrar, para llamar al admin mientras se termina de cargar.
	DescuentoLibrePct float64 `json:"descuentoLibrePct"`
	// UltimoContado: lo que quedó contado al cerrar el último turno. La
	// apertura lo propone (caja.UltimoContado).
	UltimoContado *float64 `json:"ultimoContado"`
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
	if p.DescuentoLibrePct, err = PorcentajeLibre(ctx, s.pool); err != nil {
		return p, err
	}
	if p.Turno == nil {
		if p.UltimoContado, err = caja.UltimoContado(ctx, s.pool, sucursal); err != nil {
			return p, err
		}
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
	r, err := s.RegistrarVenta(ctx, v, ses, ses.UserID)
	if err != nil {
		return r, err
	}
	if r.ClaveUsada {
		// La misma clave con otra venta adentro: no es la venta que se pide.
		return r, plataforma.NuevoProblema(http.StatusConflict, r.Error)
	}
	if !r.Ok {
		return r, nil
	}
	if r.Nueva {
		s.anotar(ctx, ses, sqlc.AccionAuditoriaCrear, "pedido", r.OrderID, "Venta de mostrador "+r.Numero+" por $"+f2(r.Total), controlDeLaVenta(r))
	}
	return r, nil
}

// controlDeLaVenta es el detalle de la bitácora: lo dejado de cobrar y quién
// lo autorizó (también va en columnas de orders, para sumarlo).
func controlDeLaVenta(r ResultadoVenta) any {
	if r.DejadoDeCobrar <= 0 && r.AutorizadoPor == "" && !r.BajoLista && r.CreditoSinAutorizar <= 0 {
		return nil
	}
	d := map[string]any{"dejadoDeCobrar": r.DejadoDeCobrar}
	if r.AutorizadoPor != "" {
		d["autorizadoPor"] = r.AutorizadoPor
	}
	if r.BajoLista {
		d["bajoListaSinAutorizar"] = true
	}
	if r.CreditoSinAutorizar > 0 {
		d["creditoSinAutorizar"] = r.CreditoSinAutorizar
	}
	return d
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
		// Y solo con la firma de la sesión que la encoló: sin ella, cualquiera
		// que drenara la cola firmaba a nombre de otro vendedor real.
		firmada := v.UsuarioID != nil && v.FirmaUsuario != nil && s.FirmaValida(*v.FirmaUsuario, *v.UsuarioID, v.CobradaAt)
		if v.UsuarioID != nil && *v.UsuarioID != ses.UserID && !firmada {
			s.log.Warn("mostrador.drenaje: venta de otro usuario sin firma válida; queda a nombre de quien la sube",
				"clave", v.Clave, "dice", *v.UsuarioID, "sube", ses.UserID)
		}
		if v.UsuarioID != nil && *v.UsuarioID != ses.UserID && firmada {
			var existe bool
			// Y que sea alguien que atiende el mostrador: si no, cualquier
			// vendedor firmaba ventas a nombre del administrador.
			if err := s.pool.QueryRow(ctx, `
				SELECT exists(SELECT 1 FROM profiles WHERE user_id = $1 AND role = 'staff' AND staff_role IN ('admin', 'vendedor'))`,
				*v.UsuarioID).Scan(&existe); err == nil && existe {
				usuario = *v.UsuarioID
			}
		}
		v.Autorizado = true
		r, err := s.RegistrarVenta(ctx, v, ses, usuario)
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
			desc := "Venta sin conexión " + prov + " → " + r.Numero + ", subida por " + ses.Nombre
			if r.BajoLista {
				// Ya pasó y no se rechaza, pero queda marcada: va en rojo en el
				// inicio del panel.
				desc += ": bajo lista sin autorizar (" + formato.Importe(r.DejadoDeCobrar) + ")"
			}
			if r.CreditoSinAutorizar > 0 {
				desc += ": a cuenta pasado el límite sin autorizar (" + formato.Importe(r.CreditoSinAutorizar) + ")"
			}
			s.anotar(ctx, ses, sqlc.AccionAuditoriaCrear, "pedido", r.OrderID, desc, controlDeLaVenta(r))
			// Y se avisa en el momento, no a fin de semana: el número
			// provisorio lo pone el puesto, así que «sin conexión» puede ser
			// un wifi apagado a propósito para no llamar al admin.
			if r.BajoLista || r.CreditoSinAutorizar > 0 {
				motivo, monto, credito := autorizacion.Precio, r.DejadoDeCobrar, r.CreditoSinAutorizar
				if !r.BajoLista {
					motivo, monto, credito = autorizacion.Credito, r.CreditoSinAutorizar, 0
				}
				s.aut.Avisar(ctx, "Venta sin conexión sin PIN", r.Numero+" de "+nombreDe(ctx, s, usuario, ses)+": "+
					autorizacion.QueSeAutoriza(motivo, monto, credito)+".")
			}
		}
		nueva := r.Nueva
		res := ResultadoDeCola{Clave: v.Clave, Estado: "sincronizada", Numero: r.Numero, OrderID: r.OrderID, Nueva: &nueva}
		// También si ya estaba: un reintento después de un corte puede haber
		// dejado la venta sin su comprobante. Emitir es idempotente (una
		// venta, un comprobante).
		if v.Comprobante == "fiscal" {
			// Con las líneas de la venta, ya con el descuento repartido (el TS
			// mandaba las de entrada: ver progreso.md, tanda 5).
			res.Fiscal = &FiscalPendiente{CustomerID: v.CustomerID, ReceptorNombre: v.ContactoNombre, Cuit: v.Cuit, Lineas: r.Lineas}
		}
		out.Resultados = append(out.Resultados, res)
	}
	out.ServidorAt = FechaJS(s.ahora())
	return out
}

// nombreDe es el nombre de quien vendió (el de la sesión, si es quien sube).
func nombreDe(ctx context.Context, s *Servicio, usuario string, ses *auth.Sesion) string {
	if usuario == ses.UserID {
		return ses.Nombre
	}
	var n string
	if err := s.pool.QueryRow(ctx, `SELECT name FROM "user" WHERE id = $1`, usuario).Scan(&n); err != nil {
		return ses.Nombre
	}
	return n
}
