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

	"mjbj/internal/caja"
	"mjbj/internal/catalogo"
	"mjbj/internal/cobros"
	"mjbj/internal/cortes"
	"mjbj/internal/jsmath"
	"mjbj/internal/numeracion"
	"mjbj/internal/reservas"
	"mjbj/internal/sqlc"
	"mjbj/internal/ventas"
)

// Servicio es el mostrador.
type Servicio struct {
	pool  *pgxpool.Pool
	log   *slog.Logger
	ahora func() time.Time
}

// Nuevo arma el servicio.
func Nuevo(pool *pgxpool.Pool, log *slog.Logger) *Servicio {
	return &Servicio{pool: pool, log: log, ahora: time.Now}
}

// ResultadoVenta es lo que devuelve RegistrarVenta: la venta hecha (o la que
// ya estaba con esa clave) o el motivo por el que no se hizo.
type ResultadoVenta struct {
	Ok                   bool                  `json:"ok"`
	OrderID              string                `json:"orderId,omitempty"`
	Numero               string                `json:"numero,omitempty"`
	Total                float64               `json:"total"`
	Nueva                bool                  `json:"nueva"`
	Lineas               []ventas.LineaDeVenta `json:"lineas,omitempty"`
	Error                string                `json:"error,omitempty"`
	RequiereAutorizacion bool                  `json:"requiereAutorizacion,omitempty"`
}

func fallo(m string) ResultadoVenta { return ResultadoVenta{Error: m} }

// Lista es la lista de precios que le toca a un cliente (listaDelCliente).
type Lista struct {
	ID             *string `json:"id"`
	GeneralID      *string `json:"generalId"`
	FactorDerivado float64 `json:"factorDerivado"`
}

// ListaDelCliente: sin cliente, la general; con cliente, la suya si tiene.
func ListaDelCliente(ctx context.Context, c caja.Consultador, cliente *string) (Lista, error) {
	var general *string
	err := c.QueryRow(ctx, `SELECT id FROM price_lists WHERE is_default = true AND active = true LIMIT 1`).Scan(&general)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return Lista{}, err
	}
	if cliente == nil {
		return Lista{ID: general, GeneralID: general, FactorDerivado: 1}, nil
	}
	var propia *string
	var pct *jsmath.Num
	err = c.QueryRow(ctx, `
		SELECT c.price_list_id, l.porcentaje_sobre_general
		FROM customers c LEFT JOIN price_lists l ON l.id = c.price_list_id
		WHERE c.id = $1 LIMIT 1`, *cliente).Scan(&propia, &pct)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return Lista{}, err
	}
	l := Lista{ID: general, GeneralID: general, FactorDerivado: 1}
	if propia != nil {
		l.ID = propia
		l.FactorDerivado = catalogo.FactorDeLista(pct)
	}
	return l, nil
}

func (l Lista) diferenciada() bool {
	return l.ID != nil && (l.GeneralID == nil || *l.ID != *l.GeneralID)
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
//
// `usuario` es quien vendió.
func (s *Servicio) RegistrarVenta(ctx context.Context, v VentaPedida, usuario string) (ResultadoVenta, error) {
	if p := ventas.RevisarVenta(v.Lineas, v.MedioPago, v.CustomerID); p != "" {
		return fallo(p), nil
	}
	q := sqlc.New(s.pool)
	ahora := s.ahora()

	// El precio de profesional es de contado: cada medio tiene que estar
	// permitido.
	if v.CustomerID != nil {
		lista, err := ListaDelCliente(ctx, s.pool, v.CustomerID)
		if err != nil {
			return ResultadoVenta{}, err
		}
		if lista.diferenciada() {
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
	escala := ventas.DescuentoPorMedioDePago(esc, v.MedioPago, subtotal)
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

	pagos := ventas.NormalizarPagos(v.Pagos, v.MedioPago, total)
	if p := ventas.RevisarPagos(pagos, total, v.CustomerID); p != "" {
		return fallo(p), nil
	}
	medioPago := ventas.MedioPrincipal(pagos)
	parteEfectivo := ventas.ImportePorMedio(pagos, ventas.Efectivo)
	parteCuenta := ventas.ImportePorMedio(pagos, ventas.CuentaCorriente)

	// Cuenta corriente: límite y mora, con la válvula de quien atiende.
	if parteCuenta > 0 && v.CustomerID != nil {
		cr, err := cobros.Credito(ctx, q, *v.CustomerID, parteCuenta, ahora)
		if err != nil {
			return ResultadoVenta{}, err
		}
		if !cr.Puede && !(v.Autorizado && cr.Autorizable) {
			m := "No se puede cargar a cuenta corriente."
			if cr.Motivo != nil {
				m = *cr.Motivo
			}
			return ResultadoVenta{Error: m, RequiereAutorizacion: cr.Autorizable}, nil
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

	var r ResultadoVenta
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var err error
		r, err = s.ventaEnTransaccion(ctx, tx, v, usuario, ventaCalculada{
			subtotal: subtotal, descuento: descuento, motivoAutomatico: motivoAutomatico, lineas: lineas, total: total,
			pagos: pagos, medioPago: medioPago, parteEfectivo: parteEfectivo, parteCuenta: parteCuenta, vendedor: vendedor, ahora: ahora,
		})
		if err == nil && !r.Ok {
			return errSinEscribir
		}
		return err
	})
	if errors.Is(err, errSinEscribir) {
		return r, nil
	}
	var cobro *cobros.ErrorDeCobro
	if errors.As(err, &cobro) {
		// Un cheque repetido: la transacción ya volvió atrás entera.
		return fallo(cobro.Mensaje), nil
	}
	if err != nil {
		return ResultadoVenta{}, err
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
}

func texto(s string) *string { return &s }

func (s *Servicio) ventaEnTransaccion(ctx context.Context, tx pgx.Tx, v VentaPedida, usuario string, c ventaCalculada) (ResultadoVenta, error) {
	// El candado serializa los envíos repetidos de la misma venta.
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1::text))`, v.Clave); err != nil {
		return ResultadoVenta{}, err
	}
	var hecha struct {
		id, numero string
		total      jsmath.Num
	}
	err := tx.QueryRow(ctx, `SELECT id, numero, total FROM orders WHERE clave_mostrador = $1 LIMIT 1`, v.Clave).
		Scan(&hecha.id, &hecha.numero, &hecha.total)
	if err == nil {
		return ResultadoVenta{Ok: true, OrderID: hecha.id, Numero: hecha.numero, Total: hecha.total.F(), Nueva: false, Lineas: c.lineas}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return ResultadoVenta{}, err
	}

	// La fecha de la venta es la del mostrador, acotada.
	var cobrada *time.Time
	if v.CobradaAt != nil {
		f := ventas.FechaAcotada(*v.CobradaAt, c.ahora)
		cobrada = &f
	}
	diferida := v.CobradaAt != nil

	var sesion *string
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
		                    subtotal, descuento, descuento_motivo, total, medio_pago, estado_pago, seller_id, notas, created_by_user_id)
		VALUES ($1, $2, $3, $4, $5, coalesce($6, now()), $7, $8, $9, $10, $11, 'mostrador', 'retiro',
		        $12::numeric, $13::numeric, $14, $15::numeric, $16, $17, $18, $19, $20)
		RETURNING id`,
		numero, v.Clave, v.NumeroProvisorio, v.CobradaAt, sincronizada, cobrada,
		v.CustomerID, v.ContactoNombre, v.ContactoTelefono, v.BranchID, estado,
		jsmath.Fijo2(c.subtotal), jsmath.Fijo2(c.descuento), motivo, jsmath.Fijo2(c.total), c.medioPago, estadoPago,
		c.vendedor, v.Notas, usuario).Scan(&pedido)
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
			                         presentacion, stock_por_unidad, costo_unitario, alicuota_iva, orden)
			VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7::numeric, $8, $9::numeric, $10::numeric, $11::numeric, $12)`,
			pedido, l.VariantID, l.Descripcion, l.Unidad, jsmath.Fijo2(l.Cantidad), jsmath.Fijo2(l.PrecioUnitario),
			jsmath.Fijo2(ventas.ACentavos(float64(l.Cantidad*l.PrecioUnitario))), factores[i].Presentacion,
			jsmath.Texto(factores[i].StockPorUnidad), costo, alicuota, i); err != nil {
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
		if _, err := tx.Exec(ctx, `
			INSERT INTO cash_movements (session_id, tipo, monto, motivo, order_id, creado_por, created_at)
			VALUES ($1, 'venta', $2::numeric, $3, $4, $5, coalesce($6, now()))`,
			*sesion, jsmath.Fijo2(c.parteEfectivo), numero, pedido, usuario, cobrada); err != nil {
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
		if _, err := tx.Exec(ctx, `UPDATE inventory SET qty = qty - $3::numeric, updated_at = now() WHERE variant_id = $1 AND branch_id = $2`,
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

func insertarCorte(ctx context.Context, tx pgx.Tx, v VentaPedida, pedido, usuario string) error {
	numero, err := numeracion.Corte(ctx, tx)
	if err != nil {
		return err
	}
	k := v.Corte
	sierra := float64(cortes.AnchoDeSierraMm)
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
