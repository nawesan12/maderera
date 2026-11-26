// Package mostrador es el punto de venta (lib/mostrador/*, app/mostrador/
// actions.ts y la API de la copia local app/api/mostrador/*): cobrar,
// anular, la caja del turno, el buscador, el alta rápida de clientes, el
// presupuesto y el cobro de la cuenta en el mostrador, y las rutas de siempre
// de la caja sin conexión.
package mostrador

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/auth"
	"mjbj/internal/autorizacion"
	"mjbj/internal/caja"
	"mjbj/internal/cobros"
	"mjbj/internal/cortes"
	"mjbj/internal/jsmath"
	"mjbj/internal/numeracion"
	"mjbj/internal/plataforma"
	"mjbj/internal/precios"
	"mjbj/internal/facturacion"
	"mjbj/internal/productos"
	"mjbj/internal/reservas"
	"mjbj/internal/sqlc"
	"mjbj/internal/ventas"
)

// Servicio es el mostrador.
type Servicio struct {
	pool  *pgxpool.Pool
	log   *slog.Logger
	ahora func() time.Time
	// claveCola firma las ventas encoladas sin conexión (firma.go).
	claveCola []byte
	// aut es la segunda firma: el PIN de un admin (internal/autorizacion).
	aut *autorizacion.Servicio
	// fac es facturación, para la devolución parcial desde el mostrador
	// (la misma instancia que el panel: comparte el candado del CAE).
	fac *facturacion.Servicio
}

// Nuevo arma el servicio.
func Nuevo(pool *pgxpool.Pool, log *slog.Logger) *Servicio {
	return &Servicio{pool: pool, log: log, ahora: time.Now, aut: autorizacion.Nuevo(pool, log, "")}
}

// ConAutorizacion le da el servicio del PIN (con la clave de las fichas y
// los avisos a los admins).
func (s *Servicio) ConAutorizacion(a *autorizacion.Servicio) *Servicio {
	s.aut = a
	return s
}

// ConFacturacion le da el servicio de facturación (la devolución parcial).
func (s *Servicio) ConFacturacion(f *facturacion.Servicio) *Servicio {
	s.fac = f
	return s
}

// ResultadoVenta es lo que devuelve RegistrarVenta: la venta hecha (o la que
// ya estaba con esa clave) o el motivo por el que no se hizo.
type ResultadoVenta struct {
	Ok      bool                  `json:"ok"`
	OrderID string                `json:"orderId,omitempty"`
	Numero  string                `json:"numero,omitempty"`
	Total   float64               `json:"total"`
	Nueva   bool                  `json:"nueva"`
	Lineas  []ventas.LineaDeVenta `json:"lineas,omitempty"`
	Error   string                `json:"error,omitempty"`
	// Autorizacion: lo que falta para cobrar, si falta el PIN de un admin.
	Autorizacion *Autorizacion `json:"autorizacion,omitempty"`
	// Ficha: un PIN que ya se tecleó para esta venta. Si la venta falló
	// después por otra cosa, se reenvía con la ficha y no con el PIN.
	Ficha string `json:"ficha,omitempty"`
	// ClaveUsada: la misma clave llegó con otra venta adentro.
	ClaveUsada bool `json:"-"`
	// Lo que queda escrito con la venta.
	DejadoDeCobrar float64 `json:"-"`
	AutorizadoPor  string  `json:"-"`
	BajoLista      bool    `json:"-"`
	// CreditoSinAutorizar: lo que una venta sin conexión cargó a cuenta
	// pasado el límite, sin PIN.
	CreditoSinAutorizar float64 `json:"-"`
}

// Autorizacion es lo que la pantalla necesita para pedir el PIN: el motivo,
// la cifra que se autoriza y cómo salió el último intento.
type Autorizacion struct {
	Motivo string  `json:"motivo"`
	Monto  float64 `json:"monto"`
	// Credito: lo que además pasa el límite de cuenta corriente, cuando el
	// mismo PIN firma el precio y el crédito. El admin ve las dos cifras.
	Credito        float64    `json:"credito,omitempty"`
	PinIncorrecto  bool       `json:"pinIncorrecto,omitempty"`
	BloqueadoHasta *time.Time `json:"bloqueadoHasta,omitempty"`
	SinAdmins      bool       `json:"sinAdmins,omitempty"`
	// ConClave: sin PIN cargado, firma la contraseña de un admin.
	ConClave bool `json:"conClave,omitempty"`
}

// faltaDeAutorizacion pasa la falta del PIN a lo que contesta la venta.
func faltaDeAutorizacion(f *autorizacion.Falta) ResultadoVenta {
	return ResultadoVenta{Error: f.Mensaje(), Autorizacion: &Autorizacion{
		Motivo: string(f.Motivo), Monto: f.Monto, Credito: f.Credito, PinIncorrecto: f.PinIncorrecto, BloqueadoHasta: f.BloqueadoHasta, SinAdmins: f.SinAdmins,
		ConClave: f.ConClave,
	}}
}

func fallo(m string) ResultadoVenta { return ResultadoVenta{Error: m} }

// Lista es la lista de precios que le toca a un cliente: vive en
// internal/precios desde T3 (la usan también los pedidos).
type Lista = precios.Lista

// ListaDelCliente: sin cliente, la general; con cliente, la suya si tiene.
func ListaDelCliente(ctx context.Context, c precios.Consultador, cliente *string) (Lista, error) {
	return precios.ListaDelCliente(ctx, c, cliente)
}

// escalas son las escalas de descuento por medio de pago activas.
func escalas(ctx context.Context, q *sqlc.Queries) ([]ventas.EscalaDePago, error) {
	filas, err := q.EscalasDePago(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]ventas.EscalaDePago, len(filas))
	for i, f := range filas {
		out[i] = ventas.EscalaDePago{Medio: string(f.Medio), DesdeMonto: f.DesdeMonto.F(), Porcentaje: f.Porcentaje.F(), Etiqueta: f.Etiqueta}
	}
	return out, nil
}

// RegistrarVenta es registrarVentaDeMostrador: **la única función que
// registra una venta de mostrador**. Una venta pasa entera o no pasa, y la
// clave que trae la pantalla la hace repetible sin consecuencias (el candado
// hashtext(clave) y el índice único de orders.clave_mostrador).
//
//  1. El stock puede quedar negativo y la venta igual se hace.
//  2. Efectivo exige turno de caja abierto (salvo la venta diferida, que cae
//     en el turno que la contenía, o en ninguno y se asigna a mano).
//  3. Cuenta corriente no es un cobro: va al libro del cliente.
//  4. Lo que queda por debajo de la lista más allá del porcentaje libre, y
//     lo que pasa el límite de cuenta corriente, pide el PIN de un admin (T3).
//     Una venta sin conexión ya ocurrió: no se rechaza, se marca.
//
// `usuario` es quien vendió; `ses`, quien la manda (el PIN se pide por ella).
func (s *Servicio) RegistrarVenta(ctx context.Context, v VentaPedida, ses *auth.Sesion, usuario string) (ResultadoVenta, error) {
	sinConexion := v.NumeroProvisorio != nil
	// En línea, ni renglones a $0 ni fracciones de lo que se vende por
	// unidad. Va antes que RevisarVenta para que el $0 diga qué falta y no
	// «el total tiene que ser mayor a cero». Sin conexión la venta ya pasó:
	// la pantalla no deja armarla así, y rechazarla acá la sacaría de la
	// caja sin que nadie la vea. Pero «numeroProvisorio» lo pone el
	// navegador: la de la cola que lo trae entra marcada para el dueño, como
	// la que pasa lo libre (revisión del carril F).
	renglonRaro := false
	if p, err := revisarRenglones(ctx, s.pool, v.Lineas); err != nil {
		return ResultadoVenta{}, err
	} else if p != "" {
		if !sinConexion {
			return fallo(p), nil
		}
		renglonRaro = true
	}
	if p := ventas.RevisarVenta(v.Lineas, v.MedioPago, v.CustomerID); p != "" {
		return fallo(p), nil
	}
	q := sqlc.New(s.pool)
	ahora := s.ahora()
	huella := huellaDeVenta(v)

	// Primero si ya está hecha (T3, hallazgo 39): un reintento después de
	// llegar al límite de cuenta corriente daba «no se puede cargar» sobre una
	// venta que ya estaba, y la factura no salía.
	if hecha, err := ventaYaHecha(ctx, s.pool, v, huella); err != nil || hecha != nil {
		if hecha == nil {
			return ResultadoVenta{}, err
		}
		return *hecha, err
	}

	// El precio de profesional es de contado: cada medio tiene que estar
	// permitido.
	lista, err := ListaDelCliente(ctx, s.pool, v.CustomerID)
	if err != nil {
		return ResultadoVenta{}, err
	}
	// «A precio de lista»: esta venta va con la general (mes simulado, H031).
	if v.ALista {
		if lista, err = ListaDelCliente(ctx, s.pool, nil); err != nil {
			return ResultadoVenta{}, err
		}
	}
	// La regla de contado vale cuando la lista del cliente le da un precio
	// mejor en esta venta: una lista constructora con los precios de la
	// general bloqueaba el cheque sin darle nada a cambio (H037).
	conVentaja, err := listaConVentaja(ctx, s.pool, v.Lineas, lista)
	if err != nil {
		return ResultadoVenta{}, err
	}
	if v.CustomerID != nil && conVentaja {
		medios := []string{v.MedioPago}
		for _, p := range v.Pagos {
			medios = append(medios, p.Medio)
		}
		for _, m := range medios {
			if !ventas.MedioPermitido(m, true) {
				return fallo("Este cliente tiene precio de profesional, que es de contado. Cobrá por " +
					"transferencia, débito o efectivo, o pasá la venta a consumidor final."), nil
			}
		}
	}

	// Cada corte viaja aparte de los renglones: el despiece tiene que entrar
	// en lo que el plano acomoda. (Su placa puede no estar entre las líneas:
	// por debajo de media placa se cobra solo el corte.) El esquema ya exige
	// al menos una pieza por despiece.
	atarRenglonesAlCorte(&v)
	for _, k := range v.Cortes {
		if p := revisarCorte(k); p != "" {
			return fallo(p), nil
		}
	}
	for _, l := range v.Lineas {
		if l.Corte != nil && *l.Corte >= len(v.Cortes) {
			return fallo(`"` + l.Descripcion + `" es de un corte que no está en la venta. Sacalo y volvé a armar el corte.`), nil
		}
	}

	// El precio de lista de cada renglón lo pone el servidor: el del
	// navegador no se cree.
	if err := conPrecioDeLista(ctx, s.pool, v.Lineas, lista); err != nil {
		return ResultadoVenta{}, err
	}
	// Y el de las pasadas y el canto de cada corte, la tarifa de su placa.
	tarifas := make([]*cortes.TarifaDeCorte, len(v.Cortes))
	for i := range v.Cortes {
		if tarifas[i], err = tarifaDelCorte(ctx, s.pool, &v.Cortes[i], lista); err != nil {
			return ResultadoVenta{}, err
		}
	}
	conTarifaDelCorte(v.Lineas, tarifas)
	// Lo cobrado de cada corte tiene que ser lo de su plano.
	// Sin conexión el corte ya se cobró y el cliente espera las piezas: si no
	// cierra (la tarifa cambió mientras tanto), entra marcado y el trabajo
	// llega igual al taller.
	for i := range v.Cortes {
		p, err := s.revisarCobroDelCorte(ctx, v, i, tarifas[i])
		if err != nil {
			return ResultadoVenta{}, err
		}
		if p != "" {
			if !sinConexion {
				return fallo(p), nil
			}
			renglonRaro = true
		}
	}

	subtotal := ventas.TotalDeLaVenta(v.Lineas)

	// El descuento por forma de pago lo resuelve el servidor; uno tipeado a
	// mano gana sobre el automático, y nunca se suman.
	pedido := 0.0
	if v.Descuento != nil {
		pedido = *v.Descuento
	}
	esc, err := escalas(ctx, q)
	if err != nil {
		return ResultadoVenta{}, err
	}
	// La escala sigue a la plata que entra, no al medio declarado: con el
	// pago partido en medios distintos no hay descuento automático (el que
	// atiende puede tipear uno), y declarar efectivo pagando con crédito no
	// se lleva el de contado.
	//
	// La base de la escala es lo que se vende del catálogo y el corte: un
	// renglón a mano (el flete) sale al precio tipeado (H168).
	var escala *ventas.EscalaDePago
	baseEscala := 0.0
	for _, l := range v.Lineas {
		if ventas.EsElegibleParaLaEscala(l) {
			baseEscala += ventas.ACentavos(float64(l.Cantidad * l.PrecioUnitario))
		}
	}
	baseEscala = ventas.ACentavos(baseEscala)
	if ventas.UnSoloMedio(v.Pagos, v.MedioPago) && !v.SinEscala {
		escala = ventas.DescuentoPorMedioDePago(esc, v.MedioPago, baseEscala)
	}
	automatico := 0.0
	if escala != nil {
		automatico = ventas.MontoDelDescuentoDePago(baseEscala, escala.Porcentaje)
	}
	var motivoAutomatico *string
	var lineas []ventas.LineaDeVenta
	var descuento float64
	if pedido > 0 {
		lineas, descuento = ventas.AplicarDescuento(v.Lineas, pedido)
	} else {
		if escala != nil && escala.Etiqueta != "" {
			e := escala.Etiqueta
			motivoAutomatico = &e
		}
		lineas, descuento = ventas.AplicarDescuentoSobre(v.Lineas, automatico, ventas.EsElegibleParaLaEscala)
	}
	aDescontar := pedido
	if pedido <= 0 {
		aDescontar = automatico
	}
	total := ventas.TotalDeLaVenta(lineas)
	if total <= 0 {
		// Sin descuento, un total en cero es un precio que falta (comité
		// final, M14): «el descuento no puede llevarse toda la venta» sobre
		// un producto a $0 mandaba a buscar un descuento que nadie puso.
		if aDescontar <= 0 {
			return fallo("Falta poner el precio."), nil
		}
		return fallo("El descuento no puede llevarse toda la venta."), nil
	}

	pagos := ventas.NormalizarPagos(v.Pagos, v.MedioPago, total)
	if p := ventas.RevisarPagos(pagos, total, v.CustomerID); p != "" {
		return fallo(p), nil
	}
	// Contra la fecha de la venta: una de la cola con un cheque se cobró
	// cuando se cobró.
	momento := ahora
	if v.CobradaAt != nil {
		momento = ventas.FechaAcotada(*v.CobradaAt, ahora)
	}
	if p := ventas.RevisarFechasDeCheques(pagos, momento); p != "" {
		return fallo(p), nil
	}
	medioPago := ventas.MedioPrincipal(pagos)
	parteEfectivo := ventas.ImportePorMedio(pagos, ventas.Efectivo)
	parteCuenta := ventas.ImportePorMedio(pagos, ventas.CuentaCorriente)

	// Lo que se deja de cobrar: bajo la lista y el descuento tipeado. La
	// escala automática no cuenta, y lo que el corte no trae ya se rechazó
	// arriba (revisarCobroDelCorte).
	manual := 0.0
	if pedido > 0 {
		manual = descuento
	}
	desvio := ventas.DesvioDeLaVenta(v.Lineas, manual, 0)
	libre, err := PorcentajeLibre(ctx, s.pool)
	if err != nil {
		return ResultadoVenta{}, err
	}
	pidePrecio := !desvio.DentroDeLoLibre(libre)

	// Lo que se cobra por debajo del costo (mes simulado, H018): seis
	// fenólicos de 18 mm a $100 se cobraban sin decir nada porque el precio
	// era el de la lista. Pide la firma de un admin, como bajar de la lista;
	// sin conexión, se marca.
	bajoCosto, err := s.bajoElCosto(ctx, lineas)
	if err != nil {
		return ResultadoVenta{}, err
	}
	pideCosto := bajoCosto > 0

	// Cuenta corriente: límite y mora. Pasarse lo autoriza un admin con su
	// PIN (antes era un booleano que mandaba la pantalla). Si pasó sin
	// autorización, el límite se vuelve a mirar adentro de la transacción
	// (con el candado del cliente); si se autorizó, no.
	revisarLimite := false
	pideCredito := false
	pasaElLimite := false
	if parteCuenta > 0 && v.CustomerID != nil {
		cr, err := cobros.Credito(ctx, q, *v.CustomerID, parteCuenta, ahora)
		if err != nil {
			return ResultadoVenta{}, err
		}
		pasaElLimite = !cr.Puede
		// Una de la cola entra igual y queda marcada abajo: ya sucedió, y la
		// mercadería salió. La cuenta bloqueada no: se rechaza también sin
		// conexión, porque «numeroProvisorio» lo manda el navegador y
		// alcanzaba con ponerlo para cargarle deuda a un cliente bloqueado
		// (comité final, M1). Solo la bloqueada: el cliente sin cuenta
		// habilitada o sin saldo a favor que alcance también es «no
		// autorizable», y rechazarlo dejaba apartada, sin deuda y sin stock,
		// una venta que ya se entregó (revisión del carril F). La pantalla
		// sin conexión no deja elegir cuenta corriente para esos dos.
		if !cr.Puede && (!sinConexion || cr.Bloqueada) {
			if !cr.Autorizable {
				m := "No se puede cargar a cuenta corriente."
				if cr.Motivo != nil {
					m = *cr.Motivo
				}
				return fallo(m), nil
			}
			pideCredito = true
		}
		revisarLimite = cr.Puede
	}

	// Un solo PIN autoriza la venta entera, pero con las dos cifras a la
	// vista y en la ficha: lo que deja de cobrar y lo que pasa el límite.
	// Antes se mostraba solo lo primero, y el admin que firmaba un redondeo
	// de $3.000 aprobaba sin verlo un millón de deuda de un moroso.
	//
	// Sin conexión no se pide: se marca, las dos cosas, y se avisa en el
	// momento (Descargar). Quien corta el wifi para no llamar al admin no
	// se ahorra que el admin se entere.
	var firma *autorizacion.Firma
	bajoListaSinAutorizar := false
	creditoSinAutorizar := 0.0
	if sinConexion {
		bajoListaSinAutorizar = pidePrecio || renglonRaro || pideCosto
		if pasaElLimite {
			creditoSinAutorizar = parteCuenta
		}
	} else if pidePrecio || pideCredito || pideCosto {
		pedidoDePIN := autorizacion.Pedido{Motivo: autorizacion.Precio, Monto: desvio.Total, Clave: v.Clave, Sucursal: v.BranchID, PIN: v.PIN, Ficha: v.Ficha}
		switch {
		case !pidePrecio && pideCosto:
			pedidoDePIN.Motivo, pedidoDePIN.Monto = autorizacion.Costo, bajoCosto
			if pideCredito {
				pedidoDePIN.Credito = parteCuenta
			}
		case !pidePrecio:
			pedidoDePIN.Motivo, pedidoDePIN.Monto = autorizacion.Credito, parteCuenta
		case pideCredito:
			pedidoDePIN.Credito = parteCuenta
		}
		firma, err = s.aut.Exigir(ctx, ses, pedidoDePIN)
		var falta *autorizacion.Falta
		if errors.As(err, &falta) {
			return faltaDeAutorizacion(falta), nil
		}
		if err != nil {
			return ResultadoVenta{}, err
		}
		if pideCredito {
			revisarLimite = false
		}
	}

	// El vendedor asignado a la ficha.
	var vendedor *string
	if v.CustomerID != nil {
		err := s.pool.QueryRow(ctx, `SELECT seller_id FROM customers WHERE id = $1`, *v.CustomerID).Scan(&vendedor)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return ResultadoVenta{}, err
		}
	}

	calc := ventaCalculada{
		subtotal: subtotal, descuento: descuento, motivoAutomatico: motivoAutomatico, lineas: lineas, total: total,
		pagos: pagos, medioPago: medioPago, parteEfectivo: parteEfectivo, parteCuenta: parteCuenta, vendedor: vendedor, ahora: ahora,
		revisarLimite: revisarLimite, huella: huella, dejado: desvio.Total, bajoLista: bajoListaSinAutorizar,
		creditoSinAutorizar: creditoSinAutorizar,
	}
	if firma != nil {
		calc.autorizadoPor = &firma.UserID
	}
	var r ResultadoVenta
	err = plataforma.EnTransaccion(ctx, s.pool, func(tx pgx.Tx) error {
		var err error
		r, err = s.ventaEnTransaccion(ctx, tx, v, usuario, calc)
		if err == nil && !r.Ok {
			return errSinEscribir
		}
		return err
	})
	// La ficha vuelve aunque la venta se haya rechazado por otra cosa: se
	// corrige y se reenvía sin volver a llamar al admin.
	ficha := ""
	if firma != nil {
		ficha = firma.Ficha
	}
	if errors.Is(err, errSinEscribir) {
		r.Ficha = ficha
		return r, nil
	}
	var cobro *cobros.ErrorDeCobro
	if errors.As(err, &cobro) {
		// Un cheque repetido: la transacción ya volvió atrás entera.
		r := fallo(cobro.Mensaje)
		r.Ficha = ficha
		return r, nil
	}
	if err != nil {
		return ResultadoVenta{}, err
	}
	r.DejadoDeCobrar, r.BajoLista, r.CreditoSinAutorizar = desvio.Total, bajoListaSinAutorizar, creditoSinAutorizar
	if firma != nil && (pidePrecio || pideCredito || pideCosto) {
		r.AutorizadoPor = firma.Nombre
	}
	return r, nil
}

// errSinEscribir vuelve atrás una transacción que terminó en un rechazo de
// negocio (no escribió nada, pero así queda claro).
var errSinEscribir = errors.New("venta rechazada")

type ventaCalculada struct {
	subtotal, descuento, total, parteEfectivo, parteCuenta float64
	motivoAutomatico                                       *string
	lineas                                                 []ventas.LineaDeVenta
	pagos                                                  []ventas.PagoDeVenta
	medioPago                                              string
	vendedor                                               *string
	ahora                                                  time.Time
	// revisarLimite: el límite se vuelve a mirar acá adentro, con el candado
	// del cliente (si quien atiende no autorizó pasarse).
	revisarLimite bool
	// Lo de T3: la huella de la venta, lo dejado de cobrar, quién lo
	// autorizó y si es una venta sin conexión bajo la lista sin autorizar.
	huella              string
	dejado              float64
	autorizadoPor       *string
	bajoLista           bool
	creditoSinAutorizar float64
}

func texto(s string) *string { return &s }

func (s *Servicio) ventaEnTransaccion(ctx context.Context, tx pgx.Tx, v VentaPedida, usuario string, c ventaCalculada) (ResultadoVenta, error) {
	// El candado serializa los envíos repetidos de la misma venta.
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1::text))`, v.Clave); err != nil {
		return ResultadoVenta{}, err
	}
	if hecha, err := ventaYaHecha(ctx, tx, v, c.huella); err != nil || hecha != nil {
		if hecha == nil {
			return ResultadoVenta{}, err
		}
		if hecha.Ok {
			hecha.Lineas = c.lineas
		}
		return *hecha, err
	}

	// Después del «ya hecha»: una venta reenviada no se vuelve a frenar por
	// un saldo que ya la incluye.
	if c.revisarLimite {
		motivo, err := cobros.LimiteEnLaTransaccion(ctx, tx, *v.CustomerID, c.parteCuenta)
		if err != nil {
			return ResultadoVenta{}, err
		}
		if motivo != "" {
			// Se llegó al límite entre la consulta y la transacción: el PIN.
			return ResultadoVenta{Error: motivo, Autorizacion: &Autorizacion{Motivo: string(autorizacion.Credito), Monto: c.parteCuenta}}, nil
		}
	}

	// La fecha de la venta es la del mostrador, acotada.
	var cobrada *time.Time
	if v.CobradaAt != nil {
		f := ventas.FechaAcotada(*v.CobradaAt, c.ahora)
		cobrada = &f
	}
	diferida := v.CobradaAt != nil

	var sesion *string
	turnoCerrado := false
	if c.parteEfectivo > 0 {
		momento := c.ahora
		if cobrada != nil {
			momento = *cobrada
		}
		turno, hay, err := caja.TurnoQueContiene(ctx, tx, v.BranchID, momento)
		if err != nil {
			return ResultadoVenta{}, err
		}
		if !hay && !diferida {
			return fallo("No hay caja abierta en esta sucursal. Abrila antes de cobrar en efectivo."), nil
		}
		if hay {
			// El candado compartido frena el cierre hasta que esta venta
			// confirme: si no, el arqueo podía hacerse sin su efectivo.
			var estado string
			if err := tx.QueryRow(ctx, `SELECT estado FROM cash_sessions WHERE id = $1 FOR SHARE`, turno).Scan(&estado); err != nil {
				return ResultadoVenta{}, err
			}
			if estado != "abierta" && !diferida {
				return fallo("La caja se acaba de cerrar. Abrila antes de cobrar en efectivo."), nil
			}
			// Una venta de la cola que llega con su turno ya arqueado entra
			// como tardía (con la hora de llegada): con la de la venta
			// cambiaba la diferencia de un cierre ya contado (T3, hallazgo 9).
			turnoCerrado = estado != "abierta"
		}
		if hay {
			sesion = &turno
		}
	}

	// El número provisorio lo pone el navegador y la venta ya pasó: si otro
	// pedido ya lo tiene (una PC nueva con la caja de otra, dos PCs con la
	// misma), el INSERT chocaba con el índice único, la cola reintentaba para
	// siempre y la plata cobrada nunca entraba. Entra igual, con el número
	// desambiguado y marcada para el dueño, como las otras rarezas sin
	// conexión; el papel del cliente se encuentra por el número de siempre.
	if v.NumeroProvisorio != nil {
		nuevo, repetido, err := desambiguarProvisorio(ctx, tx, *v.NumeroProvisorio, v.Clave)
		if err != nil {
			return ResultadoVenta{}, err
		}
		if repetido {
			nota := "Número provisorio repetido: el papel del cliente dice " + *v.NumeroProvisorio + "."
			if v.Notas != nil && strings.TrimSpace(*v.Notas) != "" {
				nota = *v.Notas + "\n" + nota
			}
			v.NumeroProvisorio, v.Notas, c.bajoLista = &nuevo, &nota, true
		}
	}

	numero, err := numeracion.Pedido(ctx, tx)
	if err != nil {
		return ResultadoVenta{}, err
	}

	estado := "entregado"
	if v.Acopio {
		estado = "listo"
	} else if len(v.Cortes) > 0 {
		// Con un corte, el cliente se lleva las piezas cuando salen de la
		// máquina (mes simulado): quedaba «entregado» con el corte en cola,
		// fuera de En curso y con el aviso de entregado. El stock baja igual
		// al cobrar, y el remito del retiro no lo vuelve a sacar
		// (entregas.SalioConLaVenta). Al terminarse el corte pasa a listo.
		estado = "preparando"
	}
	estadoPago := "pagado"
	if c.parteCuenta >= c.total-0.009 {
		estadoPago = "pendiente"
	} else if c.parteCuenta > 0 {
		estadoPago = "parcial"
	}
	var motivo *string
	if c.descuento > 0 {
		motivo = v.DescuentoMotivo
		if motivo == nil {
			motivo = c.motivoAutomatico
		}
	}
	var sincronizada *time.Time
	if v.CobradaAt != nil {
		sincronizada = &c.ahora
	}
	var pedido string
	err = tx.QueryRow(ctx, `
		INSERT INTO orders (numero, clave_mostrador, numero_provisorio, cobrada_at, sincronizada_at, created_at,
		                    customer_id, contacto_nombre, contacto_telefono, branch_id, estado, origen, tipo_entrega,
		                    subtotal, descuento, descuento_motivo, total, medio_pago, estado_pago, seller_id, notas, created_by_user_id,
		                    huella_mostrador, dejado_de_cobrar, autorizado_por, bajo_lista_sin_autorizar, credito_sin_autorizar, comprobante)
		VALUES ($1, $2, $3, $4, $5, coalesce($6, now()), $7, $8, $9, $10, $11, 'mostrador', 'retiro',
		        $12::numeric, $13::numeric, $14, $15::numeric, $16, $17, $18, $19, $20, $21, $22::numeric, $23, $24, $25::numeric, $26)
		RETURNING id`,
		numero, v.Clave, v.NumeroProvisorio, v.CobradaAt, sincronizada, cobrada,
		v.CustomerID, v.ContactoNombre, v.ContactoTelefono, v.BranchID, estado,
		jsmath.Fijo2(c.subtotal), jsmath.Fijo2(c.descuento), motivo, jsmath.Fijo2(c.total), c.medioPago, estadoPago,
		c.vendedor, v.Notas, usuario, c.huella, jsmath.Fijo2(c.dejado), c.autorizadoPor, c.bajoLista, jsmath.Fijo2(c.creditoSinAutorizar),
		comprobanteDeLaVenta(v.Comprobante)).Scan(&pedido)
	if err != nil {
		return ResultadoVenta{}, err
	}

	// El presupuesto que armó la venta queda aceptado y atado al pedido.
	if v.PresupuestoID != nil {
		if err := atarAlPresupuesto(ctx, tx, pedido, *v.PresupuestoID); err != nil {
			var ep *ErrPresupuesto
			if errors.As(err, &ep) {
				return fallo(ep.Msj), nil
			}
			return ResultadoVenta{}, err
		}
	}

	// El alta en el historial del pedido: la ficha de una venta del
	// mostrador o de un acopio quedaba con el historial vacío.
	nota := "Venta de mostrador"
	if v.Acopio {
		nota = "Venta de mostrador en acopio"
	}
	if _, err := tx.Exec(ctx, `INSERT INTO order_status_history (order_id, estado, nota, created_by_user_id, created_at)
		VALUES ($1, $2, $3, $4, coalesce($5, now()))`, pedido, estado, nota, usuario, cobrada); err != nil {
		return ResultadoVenta{}, err
	}

	// Los cortes de la venta: cada uno nace en la cola del taller, atado al
	// pedido, con su despiece.
	for i := range v.Cortes {
		if err := insertarCorte(ctx, tx, v, &v.Cortes[i], pedido, usuario); err != nil {
			return ResultadoVenta{}, err
		}
	}

	// Cómo se pagó, renglón por renglón (siempre, aun con un solo pago).
	renglones := make([]string, len(c.pagos))
	for i, p := range c.pagos {
		cupon, tarjeta := nuloSiVacio(p.NroCupon), nuloSiVacio(p.Tarjeta)
		if p.Medio == ventas.Cheque {
			cupon, tarjeta = nil, nil
			if p.Cheque != nil {
				cupon, tarjeta = &p.Cheque.Numero, &p.Cheque.Banco
			}
		}
		cuotas := 1
		if p.Cuotas != nil && *p.Cuotas > 1 {
			cuotas = int(*p.Cuotas)
		}
		if err := tx.QueryRow(ctx, `
			INSERT INTO order_payments (order_id, medio, importe, nro_lote, nro_cupon, cuotas, tarjeta)
			VALUES ($1, $2, $3::numeric, $4, $5, $6, $7) RETURNING id`,
			pedido, p.Medio, jsmath.Fijo2(p.Importe), nuloSiVacio(p.NroLote), cupon, cuotas, tarjeta).Scan(&renglones[i]); err != nil {
			return ResultadoVenta{}, err
		}
	}

	// Los cheques entran a la cartera con la venta; uno repetido la vuelve atrás.
	for i, p := range c.pagos {
		if p.Medio != ventas.Cheque || p.Cheque == nil {
			continue
		}
		fecha, err := time.ParseInLocation("2006-01-02T15:04:05", p.Cheque.FechaPago+"T12:00:00", caja.Argentina)
		if err != nil {
			return ResultadoVenta{}, err
		}
		if _, err := cobros.RegistrarChequeRecibido(ctx, tx, cobros.ChequeRecibido{
			Tipo: p.Cheque.Tipo, Numero: p.Cheque.Numero, Banco: p.Cheque.Banco, Librador: p.Cheque.Librador,
			FechaPago: fecha, Importe: p.Importe, CustomerID: v.CustomerID, OrderPaymentID: &renglones[i], UsuarioID: &usuario,
		}); err != nil {
			return ResultadoVenta{}, err
		}
	}

	// El costo se congela en la línea, igual que el precio.
	conPres := make([]reservas.LineaConPresentacion, len(c.lineas))
	var variantes []string
	for i, l := range c.lineas {
		conPres[i] = reservas.LineaConPresentacion{VariantID: l.VariantID, Presentacion: l.Presentacion}
		if l.VariantID != nil {
			variantes = append(variantes, *l.VariantID)
		}
	}
	factores, err := reservas.FactoresDeStock(ctx, tx, conPres)
	if err != nil {
		return ResultadoVenta{}, err
	}
	costos, err := reservas.CostosParaCongelar(ctx, tx, variantes)
	if err != nil {
		return ResultadoVenta{}, err
	}
	for i, l := range c.lineas {
		var costo *string
		var alicuota *string
		if l.VariantID != nil {
			if k, ok := costos[*l.VariantID]; ok {
				costo = reservas.CostoPorUnidadDeVenta(k.CostoUnitario, factores[i].StockPorUnidad)
				a := k.AlicuotaIva
				alicuota = &a
			}
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO order_items (order_id, variant_id, descripcion, unidad, cantidad, precio_unitario, subtotal,
			                         presentacion, stock_por_unidad, costo_unitario, alicuota_iva, orden, precio_lista, del_corte)
			VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7::numeric, $8, $9::numeric, $10::numeric, $11::numeric, $12, $13::numeric, $14)`,
			pedido, l.VariantID, l.Descripcion, l.Unidad, jsmath.Fijo2(l.Cantidad), jsmath.Fijo2(l.PrecioUnitario),
			jsmath.Fijo2(ventas.ACentavos(float64(l.Cantidad*l.PrecioUnitario))), factores[i].Presentacion,
			// Atado a un despiece de la venta (migración 00175): lo que
			// «El personal» no cuenta como cargado a mano.
			jsmath.Texto(factores[i].StockPorUnidad), costo, alicuota, i, fijo2ONulo(l.PrecioLista), l.Corte != nil); err != nil {
			return ResultadoVenta{}, err
		}
	}

	if v.Acopio {
		// En acopio la mercadería no sale: se reserva.
		if err := reservas.ReservarPedido(ctx, tx, pedido); err != nil {
			return ResultadoVenta{}, err
		}
	} else if err := descontarStock(ctx, tx, v.BranchID, numero, usuario, c.lineas, factores); err != nil {
		return ResultadoVenta{}, err
	}

	if sesion != nil && c.parteEfectivo > 0 {
		// Al cajón entra solo la parte en efectivo, con la fecha de la venta.
		creado, declarado := cobrada, (*time.Time)(nil)
		if turnoCerrado {
			creado, declarado = nil, cobrada
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO cash_movements (session_id, tipo, monto, motivo, order_id, creado_por, created_at, declarado_at)
			VALUES ($1, 'venta', $2::numeric, $3, $4, $5, coalesce($6, now()), $7)`,
			*sesion, jsmath.Fijo2(c.parteEfectivo), numero, pedido, usuario, creado, declarado); err != nil {
			return ResultadoVenta{}, err
		}
	}

	if c.parteCuenta > 0 && v.CustomerID != nil {
		if _, err := tx.Exec(ctx, `
			INSERT INTO account_movements (customer_id, tipo, monto, detalle, referencia, created_by_user_id)
			VALUES ($1, 'compra', $2::numeric, $3, $4, $5)`,
			*v.CustomerID, jsmath.Fijo2(c.parteCuenta), "Venta de mostrador "+numero, numero, usuario); err != nil {
			return ResultadoVenta{}, err
		}
	}

	// La plata que entró, un renglón por cada pago que no sea deuda.
	for _, p := range c.pagos {
		if p.Medio == ventas.CuentaCorriente {
			continue
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO payments (order_id, customer_id, tipo, proveedor, medio, monto, estado, conciliado_por, conciliado_at, created_by_user_id)
			VALUES ($1, $2, 'pedido', 'mostrador', $3, $4::numeric, 'aprobado', $5, now(), $5)`,
			pedido, v.CustomerID, p.Medio, jsmath.Fijo2(p.Importe), usuario); err != nil {
			return ResultadoVenta{}, err
		}
	}

	return ResultadoVenta{Ok: true, OrderID: pedido, Numero: numero, Total: c.total, Nueva: true, Lineas: c.lineas}, nil
}

// comprobanteDeLaVenta es con qué salió la venta: «interno» o «fiscal»
// (migración 00230). Lo que no es ninguno de los dos queda nulo.
func comprobanteDeLaVenta(c string) *string {
	if c != "interno" && c != "fiscal" {
		return nil
	}
	return &c
}

func nuloSiVacio(p *string) *string {
	if p == nil || *p == "" {
		return nil
	}
	return p
}

// descontarStock baja el físico de cada línea con variante. **Toma el
// candado del stock** (el TS no lo tomaba: ver progreso.md, tanda 5), de
// todas las variantes juntas y en orden, para que dos ventas con las mismas
// variantes en otro orden no se traben entre sí.
func descontarStock(ctx context.Context, tx pgx.Tx, sucursal, numero, usuario string, lineas []ventas.LineaDeVenta, factores []reservas.FactorDeLinea) error {
	type salida struct {
		variante string
		unidades float64
	}
	var salidas []salida
	vistos := map[string]bool{}
	var orden []string
	for i, l := range lineas {
		if l.VariantID == nil {
			continue
		}
		u := ventas.UnidadesDeStock(l.Cantidad, factores[i].StockPorUnidad)
		if u <= 0 {
			continue
		}
		salidas = append(salidas, salida{*l.VariantID, u})
		if !vistos[*l.VariantID] {
			vistos[*l.VariantID] = true
			orden = append(orden, *l.VariantID)
		}
	}
	sort.Strings(orden)
	for _, v := range orden {
		if err := reservas.Bloquear(ctx, tx, v, sucursal); err != nil {
			return err
		}
	}
	for _, x := range salidas {
		if _, err := tx.Exec(ctx, `
			INSERT INTO inventory (variant_id, branch_id, qty) VALUES ($1, $2, -$3::numeric)
			ON CONFLICT (variant_id, branch_id) DO UPDATE SET qty = inventory.qty - $3::numeric, updated_at = now()`,
			x.variante, sucursal, jsmath.Texto(x.unidades)); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO inventory_movements (variant_id, branch_id, type, qty, note, created_by_user_id)
			VALUES ($1, $2, 'venta', $3::numeric, $4, $5)`, x.variante, sucursal, jsmath.Texto(-x.unidades), "Mostrador "+numero, usuario); err != nil {
			return err
		}
	}
	return nil
}

// revisarRenglones es lo que la venta en línea no deja pasar renglón por
// renglón:
//
//   - Un precio en $0 (comité final, M14 y decisión 4): no hay productos
//     que se regalen, y el $0 es un precio que falta cargar. Ctrl+Enter sobre
//     un producto sin precio lo cobraba igual.
//   - Una fracción de lo que se vende por unidad (M10): media bisagra se
//     cobraba y descontaba del stock, que no la admite (stock.go hace la
//     misma cuenta con productos.AdmiteDecimales). La unidad es la del
//     producto, no la del renglón, que la manda el navegador.
func revisarRenglones(ctx context.Context, c precios.Consultador, lineas []ventas.LineaDeVenta) (string, error) {
	var ids []string
	for _, l := range lineas {
		if l.PrecioUnitario == 0 {
			return `Falta poner el precio de "` + l.Descripcion + `".`, nil
		}
		if l.VariantID != nil {
			ids = append(ids, *l.VariantID)
		}
	}
	if len(ids) == 0 {
		return "", nil
	}
	filas, err := c.Query(ctx, `
		SELECT pv.id::text, p.unit FROM product_variants pv JOIN products p ON p.id = pv.product_id
		WHERE pv.id::text = ANY($1::text[])`, ids)
	if err != nil {
		return "", err
	}
	unidades := map[string]string{}
	for filas.Next() {
		var id, unidad string
		if err := filas.Scan(&id, &unidad); err != nil {
			filas.Close()
			return "", err
		}
		unidades[id] = unidad
	}
	filas.Close()
	if err := filas.Err(); err != nil {
		return "", err
	}
	for _, l := range lineas {
		if l.VariantID == nil {
			continue
		}
		u, ok := unidades[*l.VariantID]
		if ok && !productos.AdmiteDecimales(u) && l.Cantidad != math.Trunc(l.Cantidad) {
			return `"` + l.Descripcion + `" se vende por unidad: la cantidad va sin decimales.`, nil
		}
	}
	return "", nil
}

// revisarCorte: cada pieza tiene medidas y el despiece entra en lo que el
// plano puede acomodar.
func revisarCorte(k CorteDeMostrador) string {
	unidades := 0
	for _, p := range k.Piezas {
		if p.Cantidad <= 0 || p.LargoMm <= 0 || p.AnchoMm <= 0 {
			return "Hay una pieza del corte sin medidas o sin cantidad."
		}
		unidades += p.Cantidad
	}
	if unidades > cortes.TopeDeUnidades {
		return fmt.Sprintf("Son demasiadas piezas para un corte (el máximo es %d).", cortes.TopeDeUnidades)
	}
	return ""
}

func insertarCorte(ctx context.Context, tx pgx.Tx, v VentaPedida, k *CorteDeMostrador, pedido, usuario string) error {
	// El que ya estaba en la cola sin venta se ata a esta: sus piezas son
	// las de su ficha (con ellas se armó lo que se cobra).
	if k.Existente != nil {
		tag, err := tx.Exec(ctx, `UPDATE cutting_orders SET order_id = $2, customer_id = coalesce(customer_id, $3), updated_at = now()
			WHERE id = $1 AND order_id IS NULL AND estado <> 'cancelado'`, *k.Existente, pedido, v.CustomerID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return &cobros.ErrorDeCobro{Mensaje: "Ese corte ya está en otra venta, o se canceló."}
		}
		return nil
	}
	numero, err := numeracion.Corte(ctx, tx)
	if err != nil {
		return err
	}
	sierra := sierraConfigurada(ctx, tx) // el configurado, como el alta
	var corte string
	if err := tx.QueryRow(ctx, `
		INSERT INTO cutting_orders (numero, customer_id, order_id, contacto_nombre, branch_id, variant_id, material_descripcion,
		                            placa_largo_mm, placa_ancho_mm, mitad, placas, pasadas, canto_descripcion, acomodo_manual,
		                            ancho_sierra_mm, estado, created_by_user_id, motor_plano)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::numeric, 'en-cola', $16, $17)
		RETURNING id`,
		numero, v.CustomerID, pedido, v.ContactoNombre, v.BranchID, k.VariantID, k.MaterialDescripcion,
		k.PlacaLargoMm, k.PlacaAnchoMm, k.Mitad, k.Placas, k.Pasadas, k.CantoDescripcion, k.AcomodoManual,
		jsmath.Texto(sierra), usuario, int32(cortes.MotorMediaConSierra)).Scan(&corte); err != nil {
		return err
	}
	for i, p := range k.Piezas {
		if _, err := tx.Exec(ctx, `
			INSERT INTO cutting_items (cutting_order_id, largo_mm, ancho_mm, cantidad, respeta_veta, canto_largo, canto_ancho, etiqueta, aclaracion, orden)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
			corte, p.LargoMm, p.AnchoMm, p.Cantidad, p.RespetaVeta, p.CantoLargo, p.CantoAncho, p.Etiqueta, p.Aclaracion, i); err != nil {
			return err
		}
	}
	return nil
}

var _ = fmt.Sprintf

// desambiguarProvisorio devuelve el número con que se guarda una venta sin
// conexión: el mismo si nadie lo tiene, o con un sufijo de su clave si ya
// existe (y `repetido`). Toma un candado por el número, así dos ventas con el
// mismo número que suben a la vez no chocan en el índice único.
func desambiguarProvisorio(ctx context.Context, tx pgx.Tx, numero, clave string) (string, bool, error) {
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('provisorio:' || $1::text))`, numero); err != nil {
		return "", false, err
	}
	corta := strings.ToUpper(strings.ReplaceAll(clave, "-", ""))
	candidatos := []string{numero}
	if len(corta) >= 4 {
		candidatos = append(candidatos, numero+"-R"+corta[:4])
	}
	candidatos = append(candidatos, numero+"-R"+corta)
	for i, c := range candidatos {
		var existe bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM orders WHERE numero_provisorio = $1)`, c).Scan(&existe); err != nil {
			return "", false, err
		}
		if !existe {
			return c, i > 0, nil
		}
	}
	return "", false, fmt.Errorf("número provisorio %s repetido sin salida", numero)
}
