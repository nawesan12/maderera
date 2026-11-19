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
	"sort"
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
	"mjbj/internal/precios"
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
}

// faltaDeAutorizacion pasa la falta del PIN a lo que contesta la venta.
func faltaDeAutorizacion(f *autorizacion.Falta) ResultadoVenta {
	return ResultadoVenta{Error: f.Mensaje(), Autorizacion: &Autorizacion{
		Motivo: string(f.Motivo), Monto: f.Monto, Credito: f.Credito, PinIncorrecto: f.PinIncorrecto, BloqueadoHasta: f.BloqueadoHasta, SinAdmins: f.SinAdmins,
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
	if p := ventas.RevisarVenta(v.Lineas, v.MedioPago, v.CustomerID); p != "" {
		return fallo(p), nil
	}
	q := sqlc.New(s.pool)
	ahora := s.ahora()
	sinConexion := v.NumeroProvisorio != nil
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
	if v.CustomerID != nil && lista.Diferenciada() {
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

	// El corte viaja aparte de los renglones: el despiece tiene que entrar en
	// lo que el plano acomoda. (Su placa puede no estar entre las líneas: por
	// debajo de media placa se cobra solo el corte.)
	if v.Corte != nil && len(v.Corte.Piezas) > 0 {
		if p := revisarCorte(*v.Corte); p != "" {
			return fallo(p), nil
		}
	}

	// El precio de lista de cada renglón lo pone el servidor: el del
	// navegador no se cree.
	if err := conPrecioDeLista(ctx, s.pool, v.Lineas, lista); err != nil {
		return ResultadoVenta{}, err
	}
	// Y el de las pasadas y el canto del corte, la tarifa de su placa.
	tarifa, err := tarifaDelCorte(ctx, s.pool, v.Corte, lista)
	if err != nil {
		return ResultadoVenta{}, err
	}
	conTarifaDelCorte(v.Lineas, tarifa)

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
	var escala *ventas.EscalaDePago
	if ventas.UnSoloMedio(v.Pagos, v.MedioPago) {
		escala = ventas.DescuentoPorMedioDePago(esc, v.MedioPago, subtotal)
	}
	automatico := 0.0
	if escala != nil {
		automatico = ventas.MontoDelDescuentoDePago(subtotal, escala.Porcentaje)
	}
	aDescontar := automatico
	var motivoAutomatico *string
	if pedido > 0 {
		aDescontar = pedido
	} else if escala != nil && escala.Etiqueta != "" {
		e := escala.Etiqueta
		motivoAutomatico = &e
	}
	lineas, descuento := ventas.AplicarDescuento(v.Lineas, aDescontar)
	total := ventas.TotalDeLaVenta(lineas)
	if total <= 0 {
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

	// Lo que se deja de cobrar: bajo la lista, el descuento tipeado y lo que
	// el corte no trae. La escala automática no cuenta.
	faltaCorte, err := s.faltaDelCorte(ctx, v, lista, tarifa)
	if err != nil {
		return ResultadoVenta{}, err
	}
	manual := 0.0
	if pedido > 0 {
		manual = descuento
	}
	desvio := ventas.DesvioDeLaVenta(v.Lineas, manual, faltaCorte)
	libre, err := PorcentajeLibre(ctx, s.pool)
	if err != nil {
		return ResultadoVenta{}, err
	}
	pidePrecio := !desvio.DentroDeLoLibre(libre)

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
		// Una de la cola entra igual: ya sucedió (y queda marcada abajo).
		if !cr.Puede && !sinConexion {
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
		bajoListaSinAutorizar = pidePrecio
		if pasaElLimite {
			creditoSinAutorizar = parteCuenta
		}
	} else if pidePrecio || pideCredito {
		pedidoDePIN := autorizacion.Pedido{Motivo: autorizacion.Precio, Monto: desvio.Total, Clave: v.Clave, Sucursal: v.BranchID, PIN: v.PIN, Ficha: v.Ficha}
		switch {
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
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
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
	if firma != nil && (pidePrecio || pideCredito) {
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

	numero, err := numeracion.Pedido(ctx, tx)
	if err != nil {
		return ResultadoVenta{}, err
	}

	estado := "entregado"
	if v.Acopio {
		estado = "listo"
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
		                    huella_mostrador, dejado_de_cobrar, autorizado_por, bajo_lista_sin_autorizar, credito_sin_autorizar)
		VALUES ($1, $2, $3, $4, $5, coalesce($6, now()), $7, $8, $9, $10, $11, 'mostrador', 'retiro',
		        $12::numeric, $13::numeric, $14, $15::numeric, $16, $17, $18, $19, $20, $21, $22::numeric, $23, $24, $25::numeric)
		RETURNING id`,
		numero, v.Clave, v.NumeroProvisorio, v.CobradaAt, sincronizada, cobrada,
		v.CustomerID, v.ContactoNombre, v.ContactoTelefono, v.BranchID, estado,
		jsmath.Fijo2(c.subtotal), jsmath.Fijo2(c.descuento), motivo, jsmath.Fijo2(c.total), c.medioPago, estadoPago,
		c.vendedor, v.Notas, usuario, c.huella, jsmath.Fijo2(c.dejado), c.autorizadoPor, c.bajoLista, jsmath.Fijo2(c.creditoSinAutorizar)).Scan(&pedido)
	if err != nil {
		return ResultadoVenta{}, err
	}

	// El corte, si la venta lleva uno: nace en la cola del taller, atado al pedido.
	if v.Corte != nil && len(v.Corte.Piezas) > 0 {
		if err := insertarCorte(ctx, tx, v, pedido, usuario); err != nil {
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
			                         presentacion, stock_por_unidad, costo_unitario, alicuota_iva, orden, precio_lista)
			VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7::numeric, $8, $9::numeric, $10::numeric, $11::numeric, $12, $13::numeric)`,
			pedido, l.VariantID, l.Descripcion, l.Unidad, jsmath.Fijo2(l.Cantidad), jsmath.Fijo2(l.PrecioUnitario),
			jsmath.Fijo2(ventas.ACentavos(float64(l.Cantidad*l.PrecioUnitario))), factores[i].Presentacion,
			jsmath.Texto(factores[i].StockPorUnidad), costo, alicuota, i, fijo2ONulo(l.PrecioLista)); err != nil {
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

func insertarCorte(ctx context.Context, tx pgx.Tx, v VentaPedida, pedido, usuario string) error {
	numero, err := numeracion.Corte(ctx, tx)
	if err != nil {
		return err
	}
	k := v.Corte
	sierra := float64(cortes.AnchoDeSierraMm)
	_ = tx.QueryRow(ctx, `SELECT ancho_sierra_mm::float8 FROM calculator_settings LIMIT 1`).Scan(&sierra) // el configurado, como el alta
	if k.AnchoSierraMm != nil {
		if a := cortes.LeerAnchoDeSierra(jsmath.Texto(*k.AnchoSierraMm)); a != nil {
			sierra = *a
		}
	}
	var corte string
	if err := tx.QueryRow(ctx, `
		INSERT INTO cutting_orders (numero, customer_id, order_id, contacto_nombre, branch_id, variant_id, material_descripcion,
		                            placa_largo_mm, placa_ancho_mm, mitad, placas, pasadas, canto_descripcion, acomodo_manual,
		                            ancho_sierra_mm, estado, created_by_user_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::numeric, 'en-cola', $16)
		RETURNING id`,
		numero, v.CustomerID, pedido, v.ContactoNombre, v.BranchID, k.VariantID, k.MaterialDescripcion,
		k.PlacaLargoMm, k.PlacaAnchoMm, k.Mitad, k.Placas, k.Pasadas, k.CantoDescripcion, k.AcomodoManual,
		jsmath.Texto(sierra), usuario).Scan(&corte); err != nil {
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
