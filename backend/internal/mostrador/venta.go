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
	"mjbj/internal/clientes"
	"mjbj/internal/cobros"
	"mjbj/internal/cortes"
	"mjbj/internal/entregas"
	"mjbj/internal/facturacion"
	"mjbj/internal/formato"
	"mjbj/internal/jsmath"
	"mjbj/internal/numeracion"
	"mjbj/internal/plataforma"
	"mjbj/internal/precios"
	"mjbj/internal/productos"
	"mjbj/internal/reglas"
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
	// AvisoStock: la venta dejó medidas con lo disponible en negativo.
	AvisoStock string `json:"avisoStock,omitempty"`
	// Autorizacion: lo que falta para cobrar, si falta el PIN de un admin.
	Autorizacion *Autorizacion `json:"autorizacion,omitempty"`
	// Ficha: un PIN que ya se tecleó para esta venta. Si la venta falló
	// después por otra cosa, se reenvía con la ficha y no con el PIN.
	Ficha string `json:"ficha,omitempty"`
	// Repetida: el número de la venta igual de recién (M3S4-015). Se vuelve
	// a mandar con repetidaOk para cobrarla igual.
	Repetida string `json:"repetida,omitempty"`

	// ClaveUsada: la misma clave llegó con otra venta adentro.
	ClaveUsada bool `json:"-"`
	// Lo que queda escrito con la venta.
	DejadoDeCobrar float64 `json:"-"`
	AutorizadoPor  string  `json:"-"`
	// Firma es cómo autorizó (PIN, contraseña o la sesión de un admin).
	Firma     *autorizacion.Firma `json:"-"`
	BajoLista bool                `json:"-"`
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
	// El corte de la cola que se cobra trae a su cliente (o el nombre y el
	// teléfono que se anotaron): salía a «Consumidor final», el pedido no
	// aparecía en la ficha y no había a quién avisar (mes simulado, M2S2-062
	// y M3S4-041).
	if err := s.clienteDelCorte(ctx, &v); err != nil {
		return ResultadoVenta{}, err
	}
	if p := ventas.RevisarVenta(v.Lineas, v.MedioPago, v.CustomerID); p != "" {
		return fallo(p), nil
	}
	// Con comprobante fiscal, el CUIT con que saldría se revisa antes de
	// cobrar: la venta a «Carpintería Prueba» con 30-71234567-8 quedaba
	// registrada y el comprobante no salía («El CUIT no es válido», mes
	// simulado, ítem 9). Sin conexión la venta ya pasó: entra, y el
	// comprobante se resuelve desde Facturación.
	if !sinConexion && v.Comprobante == "fiscal" {
		if p, err := revisarCuitDelComprobante(ctx, s.pool, v); err != nil {
			return ResultadoVenta{}, err
		} else if p != "" {
			return fallo(p), nil
		}
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
	// Con la regla contado_por_lista en «siempre», la lista propia es de
	// contado aunque en esta venta no dé mejor precio.
	if !conVentaja && lista.Diferenciada() && reglas.Es(ctx, s.pool, reglas.ContadoPorLista, "siempre") {
		conVentaja = true
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
	// Con la regla descuento_al_flete en «si», el renglón a mano también.
	elegible := ventas.EsElegibleParaLaEscala
	if reglas.Es(ctx, s.pool, reglas.DescuentoAlFlete, "si") {
		elegible = ventas.TodoEsElegible
	}
	var escala *ventas.EscalaDePago
	baseEscala := 0.0
	for _, l := range v.Lineas {
		if elegible(l) {
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
	// Con la regla descuento_con_escala en «suma», el descuento tipeado va
	// además del de la forma de pago: el 5 % del vendedor le sacaba el 10 %
	// de efectivo y el cliente pagaba más (mes simulado, M2S2-018).
	sumaEscala := pedido > 0 && automatico > 0 && reglas.Es(ctx, s.pool, reglas.DescuentoConEscala, "suma")
	if sumaEscala {
		conEscala, d1 := ventas.AplicarDescuentoSobre(v.Lineas, automatico, elegible)
		var d2 float64
		lineas, d2 = ventas.AplicarDescuento(conEscala, pedido)
		descuento = ventas.ACentavos(d1 + d2)
		if escala.Etiqueta != "" {
			e := escala.Etiqueta
			motivoAutomatico = &e
		}
	} else if pedido > 0 {
		lineas, descuento = ventas.AplicarDescuento(v.Lineas, pedido)
	} else {
		if escala != nil && escala.Etiqueta != "" {
			e := escala.Etiqueta
			motivoAutomatico = &e
		}
		lineas, descuento = ventas.AplicarDescuentoSobre(v.Lineas, automatico, elegible)
	}
	aDescontar := pedido
	if pedido <= 0 {
		aDescontar = automatico
	} else if sumaEscala {
		aDescontar = pedido + automatico
	}
	total := ventas.TotalDeLaVenta(lineas)
	// Con la regla redondeo_efectivo en «al_peso», lo que se paga todo en
	// efectivo va sin centavos, a favor del cliente: «$ 354.211,50» con el
	// cliente contando billetes (mes simulado, M2S1-180).
	redondeo := 0.0
	if total > 1 && v.MedioPago == ventas.Efectivo && ventas.UnSoloMedio(v.Pagos, v.MedioPago) &&
		total != math.Floor(total) && reglas.Es(ctx, s.pool, reglas.RedondeoEfectivo, "al_peso") {
		var d float64
		lineas, d = ventas.AplicarDescuento(lineas, ventas.ACentavos(total-math.Floor(total)))
		redondeo = d
		descuento = ventas.ACentavos(descuento + d)
		aDescontar += d
		total = ventas.TotalDeLaVenta(lineas)
	}
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
	// La misma venta al mismo cliente hace un momento (otra clave): se
	// pregunta antes de cobrarla otra vez. Dos ventas iguales a Wood Frame
	// con 29 segundos de diferencia dejaron la cuenta pasada del límite (mes
	// simulado, M3S4-015). Sin conexión ya pasó: no se pregunta.
	if !sinConexion && !v.RepetidaOk && v.CustomerID != nil {
		if numero, hace, err := ventaIgualDeRecien(ctx, s.pool, v, total, ahora); err != nil {
			return ResultadoVenta{}, err
		} else if numero != "" {
			r := fallo("Es igual a " + numero + ", de hace " + hace + ".")
			r.Repetida = numero
			return r, nil
		}
	}
	// La tarjeta en línea, con lote y cupón (regla lote_y_cupon, H032): sin
	// ellos no se concilia contra el posnet. Sin conexión la venta ya pasó.
	if !sinConexion && !reglas.Es(ctx, s.pool, reglas.LoteYCupon, "opcional") {
		if p := ventas.FaltaLoteOCupon(pagos); p != "" {
			return fallo(p), nil
		}
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
		// Lo tipeado: sin la escala que se sumó ni el redondeo del efectivo,
		// que no son del vendedor.
		manual = descuento
		if sumaEscala {
			manual = ventas.ACentavos(manual - automatico)
		}
		manual = ventas.ACentavos(manual - redondeo)
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
		sumaEscala: sumaEscala, redondeo: redondeo, recibido: v.EfectivoRecibido,
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
		r.AutorizadoPor, r.Firma = firma.Nombre, firma
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
	// sumaEscala: el descuento tipeado y el de la forma de pago se sumaron;
	// redondeo: lo que se dejó de cobrar para que el efectivo cierre sin
	// centavos; recibido: con cuánto pagó en efectivo (00350).
	sumaEscala bool
	redondeo   float64
	recibido   *float64
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
		// Cobrar un corte que ya salió de la máquina: el pedido nace listo
		// para entregar, no en «Preparando» (mes simulado, M3S4-040).
		listos, err := cortesYaTerminados(ctx, tx, v.Cortes)
		if err != nil {
			return ResultadoVenta{}, err
		}
		if listos {
			estado = "listo"
		}
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
		} else if c.motivoAutomatico != nil && c.sumaEscala {
			m := *motivo + " + " + *c.motivoAutomatico
			motivo = &m
		}
		if c.redondeo > 0 {
			m := "Redondeo"
			if motivo != nil && *motivo != "" {
				m = *motivo + " · redondeo"
			}
			motivo = &m
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
		                    huella_mostrador, dejado_de_cobrar, autorizado_por, bajo_lista_sin_autorizar, credito_sin_autorizar, comprobante,
		                    efectivo_recibido)
		VALUES ($1, $2, $3, $4, $5, coalesce($6, now()), $7, $8, $9, $10, $11, 'mostrador', 'retiro',
		        $12::numeric, $13::numeric, $14, $15::numeric, $16, $17, $18, $19, $20, $21, $22::numeric, $23, $24, $25::numeric, $26,
		        $27::numeric)
		RETURNING id`,
		numero, v.Clave, v.NumeroProvisorio, v.CobradaAt, sincronizada, cobrada,
		v.CustomerID, v.ContactoNombre, v.ContactoTelefono, v.BranchID, estado,
		jsmath.Fijo2(c.subtotal), jsmath.Fijo2(c.descuento), motivo, jsmath.Fijo2(c.total), c.medioPago, estadoPago,
		c.vendedor, v.Notas, usuario, c.huella, jsmath.Fijo2(c.dejado), c.autorizadoPor, c.bajoLista, jsmath.Fijo2(c.creditoSinAutorizar),
		comprobanteDeLaVenta(v.Comprobante), recibidoDeLaVenta(c)).Scan(&pedido)
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
		// Lo que se lleva fiado sale con su remito, para firmar (M2S1-073).
		if estado == "entregado" {
			if _, err := entregas.ConstanciaParaFirmar(ctx, tx, pedido, &v.BranchID, &usuario); err != nil {
				return ResultadoVenta{}, err
			}
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

	aviso, err := vendidoDeMas(ctx, tx, pedido, v.BranchID)
	if err != nil {
		return ResultadoVenta{}, err
	}
	return ResultadoVenta{Ok: true, OrderID: pedido, Numero: numero, Total: c.total, Nueva: true, Lineas: c.lineas, AvisoStock: aviso}, nil
}

// ventaIgualDeRecien es el número de una venta de mostrador al mismo cliente,
// por el mismo total, con los mismos renglones y de los últimos dos minutos,
// y hace cuánto fue («29 s»). "" si no hay.
func ventaIgualDeRecien(ctx context.Context, db *pgxpool.Pool, v VentaPedida, total float64, ahora time.Time) (string, string, error) {
	var numero string
	var creada time.Time
	var renglones []string
	err := db.QueryRow(ctx, `
		SELECT o.numero, o.created_at,
		       (SELECT array_agg(coalesce(oi.variant_id::text, oi.descripcion) || ':' || oi.cantidad::text ORDER BY 1) FROM order_items oi WHERE oi.order_id = o.id)
		FROM orders o
		WHERE o.customer_id = $1 AND o.origen = 'mostrador' AND o.estado <> 'cancelado' AND o.clave_mostrador <> $2
		  AND o.total = $3::numeric AND o.created_at >= $4::timestamptz - interval '2 minutes'
		ORDER BY o.created_at DESC LIMIT 1`, *v.CustomerID, v.Clave, jsmath.Fijo2(total), ahora).Scan(&numero, &creada, &renglones)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", nil
	}
	if err != nil {
		return "", "", err
	}
	// Los renglones también: mismo total con otra cosa es otra venta.
	cantidades := map[string]float64{}
	for _, l := range v.Lineas {
		k := l.Descripcion
		if l.VariantID != nil {
			k = *l.VariantID
		}
		cantidades[k] += l.Cantidad
	}
	for _, r := range renglones {
		i := strings.LastIndex(r, ":")
		if i < 0 {
			continue
		}
		cantidades[r[:i]] -= jsmath.Numero(r[i+1:])
	}
	for _, c := range cantidades {
		if math.Abs(c) > 1e-9 {
			return "", "", nil
		}
	}
	seg := int(ahora.Sub(creada).Seconds())
	if seg < 0 {
		seg = 0
	}
	hace := fmt.Sprintf("%d s", seg)
	if seg >= 60 {
		hace = fmt.Sprintf("%d min", seg/60)
	}
	return numero, hace, nil
}

// clienteDelCorte completa el cliente de una venta que cobra un corte de la
// cola sin venta, si la pantalla no lo eligió: el de la ficha del corte, o
// el nombre y el teléfono que se anotaron con él.
func (s *Servicio) clienteDelCorte(ctx context.Context, v *VentaPedida) error {
	if v.CustomerID != nil {
		return nil
	}
	for _, k := range v.Cortes {
		if k.Existente == nil {
			continue
		}
		var cliente, nombre, contacto, telefono *string
		err := s.pool.QueryRow(ctx, `
			SELECT co.customer_id::text, c.nombre, nullif(trim(co.contacto_nombre), ''), nullif(trim(co.contacto_telefono), '')
			FROM cutting_orders co LEFT JOIN customers c ON c.id = co.customer_id
			WHERE co.id = $1 AND co.order_id IS NULL`, *k.Existente).Scan(&cliente, &nombre, &contacto, &telefono)
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		if err != nil {
			return err
		}
		sinNombre := strings.TrimSpace(v.ContactoNombre) == "" || strings.EqualFold(strings.TrimSpace(v.ContactoNombre), "Consumidor final")
		switch {
		case cliente != nil:
			v.CustomerID = cliente
			if nombre != nil {
				v.ContactoNombre = *nombre
			}
		case contacto != nil && sinNombre:
			v.ContactoNombre = *contacto
		}
		if v.ContactoTelefono == nil && telefono != nil {
			v.ContactoTelefono = telefono
		}
		return nil
	}
	return nil
}

// vendidoDeMas dice qué medidas de la venta quedaron con lo disponible en
// negativo: se vendió más de lo que hay, y hay que pedirlo (mes simulado,
// H218: 135 placas vendidas con 70 en el galpón, sin ningún aviso). La venta
// se hace igual —vender a pedido es parte del negocio—, pero se dice.
func vendidoDeMas(ctx context.Context, tx pgx.Tx, pedido string, sucursal string) (string, error) {
	// Con lo que hay en el estante y para quién está apartado: «faltan 1»
	// con tres latas a la vista no se entendía, y el vendedor le sacaba la
	// lata a un pedido web sin saberlo (mes simulado, M3S1-064).
	filas, err := tx.Query(ctx, `
		SELECT DISTINCT p.name || ' ' || v.label, (i.qty - i.reservado)::float8, greatest(i.qty, 0)::float8,
		       (SELECT string_agg(DISTINCT o2.numero, ', ') FROM stock_reservations sr2
		          JOIN order_items oi2 ON oi2.id = sr2.order_item_id JOIN orders o2 ON o2.id = oi2.order_id
		         WHERE sr2.variant_id = i.variant_id AND sr2.branch_id = i.branch_id AND sr2.estado = 'activa' AND o2.id <> $1)
		FROM order_items oi
		JOIN product_variants v ON v.id = oi.variant_id
		JOIN products p ON p.id = v.product_id
		JOIN inventory i ON i.variant_id = oi.variant_id AND i.branch_id = coalesce(
		  (SELECT sr.branch_id FROM stock_reservations sr WHERE sr.order_item_id = oi.id AND sr.estado = 'activa' LIMIT 1), $2::uuid)
		WHERE oi.order_id = $1 AND i.qty - i.reservado < 0
		ORDER BY 1`, pedido, nuloSiVacio(&sucursal))
	if err != nil {
		return "", err
	}
	var partes []string
	var nombre string
	var disponible, fisico float64
	var reservados *string
	if _, err := pgx.ForEachRow(filas, []any{&nombre, &disponible, &fisico, &reservados}, func() error {
		p := nombre + " (faltan " + formato.Cantidad(-disponible)
		if reservados != nil && *reservados != "" {
			p += "; quedan " + formato.Cantidad(fisico) + " apartadas para " + *reservados
		}
		partes = append(partes, p+")")
		return nil
	}); err != nil {
		return "", err
	}

	if len(partes) == 0 {
		return "", nil
	}
	return "Se vendió más de lo que hay: " + strings.Join(partes, ", ") + ".", nil
}

// recibidoDeLaVenta es con cuánto pagó, si pagó todo en efectivo y alcanzó:
// el ticket dice el vuelto (mes simulado, M3S1-061).
func recibidoDeLaVenta(c ventaCalculada) *string {
	if c.recibido == nil || !(*c.recibido >= c.total-0.005) || c.parteEfectivo < c.total-0.005 || *c.recibido > 1e9 {
		return nil
	}
	f := jsmath.Fijo2(*c.recibido)
	return &f
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

// soloElCorte: la venta no lleva mercadería fuera de la del corte.
func soloElCorte(v VentaPedida) bool {
	for _, l := range v.Lineas {
		if l.VariantID != nil && l.Corte == nil {
			return false
		}
	}
	return true
}

func insertarCorte(ctx context.Context, tx pgx.Tx, v VentaPedida, k *CorteDeMostrador, pedido, usuario string) error {
	// El que ya estaba en la cola sin venta se ata a esta: sus piezas son
	// las de su ficha (con ellas se armó lo que se cobra).
	if k.Existente != nil {
		// El de una venta rehecha vuelve a la cola al atarse (ver anular.go).
		tag, err := tx.Exec(ctx, `UPDATE cutting_orders SET order_id = $2, customer_id = coalesce(customer_id, $3), updated_at = now(),
			  estado = CASE WHEN estado = 'cancelado' THEN 'en-cola'::estado_corte ELSE estado END, rehacer_de = NULL
			WHERE id = $1 AND order_id IS NULL AND (estado <> 'cancelado' OR rehacer_de IS NOT NULL)`, *k.Existente, pedido, v.CustomerID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return &cobros.ErrorDeCobro{Mensaje: "Ese corte ya está en otra venta, o se canceló."}
		}
		// El día que lo pasa a buscar es el del pedido: la venta nacía sin
		// «Lo retira el» aunque el corte lo tenía (mes simulado, PED-1155).
		_, err = tx.Exec(ctx, `UPDATE orders o SET entregar_el = co.retira_el FROM cutting_orders co
			WHERE o.id = $2 AND co.id = $1 AND o.entregar_el IS NULL AND co.retira_el IS NOT NULL`, *k.Existente, pedido)
		if err != nil {
			return err
		}
		// La venta que solo cobra el corte: a nombre del cliente del corte
		// (figuraba «Consumidor final»), y se retira donde está el corte, no
		// en la caja que cobró (mes simulado 2: un corte del Aserradero se
		// daba por entregado en Casa Central sin traslado). La plata entra
		// igual al turno que la cobró, y caja_branch_id guarda cuál: el Z
		// de la otra sucursal la sumaba sin que pasara por su cajón (mes
		// 23, PED-1142).
		if soloElCorte(v) {
			_, err = tx.Exec(ctx, `UPDATE orders o SET
				  contacto_nombre = CASE WHEN o.customer_id IS NULL AND lower(o.contacto_nombre) = 'consumidor final' THEN co.contacto_nombre ELSE o.contacto_nombre END,
				  contacto_telefono = coalesce(o.contacto_telefono, co.contacto_telefono),
				  customer_id = coalesce(o.customer_id, co.customer_id),
				  caja_branch_id = coalesce(o.caja_branch_id, o.branch_id),
				  branch_id = coalesce(co.branch_id, o.branch_id)
				FROM cutting_orders co WHERE o.id = $2 AND co.id = $1`, *k.Existente, pedido)
		}
		return err
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
		jsmath.Texto(sierra), usuario, int32(cortes.MotorActual)).Scan(&corte); err != nil {
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

// revisarCuitDelComprobante es el problema del CUIT con que saldría el
// comprobante fiscal de la venta, o "": el tipeado si no hay ficha, el de la
// ficha si la hay (como facturacion.EmitirParaLaVenta).
func revisarCuitDelComprobante(ctx context.Context, db *pgxpool.Pool, v VentaPedida) (string, error) {
	cuit := ""
	if v.CustomerID != nil && *v.CustomerID != "" {
		var c *string
		err := db.QueryRow(ctx, `SELECT cuit FROM customers WHERE id = $1`, *v.CustomerID).Scan(&c)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return "", err
		}
		if c != nil {
			cuit = *c
		}
	} else if v.Cuit != nil {
		cuit = *v.Cuit
	}
	if strings.TrimSpace(cuit) == "" {
		return "", nil
	}
	_, msj := clientes.LeerDocumento(cuit)
	return msj, nil
}

// cortesYaTerminados dice si todos los cortes de la venta son de la cola y ya
// salieron de la máquina. Uno nuevo, que nace con la venta, todavía no.
func cortesYaTerminados(ctx context.Context, tx pgx.Tx, ks []CorteDeMostrador) (bool, error) {
	ids := make([]string, 0, len(ks))
	for _, k := range ks {
		if k.Existente == nil {
			return false, nil
		}
		ids = append(ids, *k.Existente)
	}
	var todos bool
	err := tx.QueryRow(ctx, `SELECT count(*) = $2 FROM cutting_orders WHERE id::text = ANY($1) AND estado IN ('terminado', 'retirado')`,
		ids, len(ids)).Scan(&todos)
	return todos, err
}
