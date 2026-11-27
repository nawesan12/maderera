package facturacion

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/fiscal"
	"mjbj/internal/jsmath"
	"mjbj/internal/pdf"
	"mjbj/internal/ventas/fragmentos"
)

// Las lecturas de lib/dal/admin/facturacion.ts y de misComprobantes.

// MediosDeContado son los que cuentan como contado para el filtro.
// «tarjeta» es como queda en invoice_payments (medio_cobro) un cobro con
// débito o crédito: sin ella, una factura cobrada con tarjeta no salía en el
// filtro de contado. «debito» y «credito» no existen en el enum.
var MediosDeContado = []string{"efectivo", "transferencia", "tarjeta", "debito", "credito", "mercado_pago", "cheque", "deposito", "echeq"}

// Listado es ComprobanteListado.
type Listado struct {
	ID               string     `json:"id"`
	Tipo             string     `json:"tipo"`
	PuntoVenta       int64      `json:"puntoVenta"`
	Numero           int64      `json:"numero"`
	Estado           string     `json:"estado"`
	ReceptorNombre   string     `json:"receptorNombre"`
	ReceptorCuit     *string    `json:"receptorCuit"`
	Total            float64    `json:"total"`
	Cobrado          float64    `json:"cobrado"`
	Cae              *string    `json:"cae"`
	FechaEmision     time.Time  `json:"fechaEmision"`
	FechaVencimiento *time.Time `json:"fechaVencimiento"`
	Medios           []string   `json:"medios"`
	// EnCuenta: la deuda de esta factura vive en la cuenta corriente del
	// cliente (se pasó a cuenta, o el pedido se vendió a cuenta). No es un
	// cobro: la columna dice «En cuenta corriente», no «Cobrado».
	EnCuenta bool `json:"enCuenta"`
	// Pedido es el número del pedido que factura (PED-1046), si tiene.
	Pedido *string `json:"pedido"`
	// VentaAnulada: el pedido se canceló. Su saldo es cero, pero no por
	// cobrada: la columna decía «Cobrado» (mes simulado).
	VentaAnulada bool `json:"ventaAnulada"`
}

// SaldoDeFactura es, sobre la fila `i` de invoices, su `c` (los cobros de
// invoice_payments sumados: cobrado, y cobrado_contado sin el pase a cuenta
// corriente) y su pedido `o` (LEFT JOIN), lo que falta cobrar de la factura.
//
// Antes salía solo de invoice_payments, y esa tabla la llena únicamente el
// cobro desde Facturación: la venta cobrada en el mostrador (order_payments),
// el pedido cobrado con un recibo y el cobrado en línea seguían con todo el
// saldo, con «Registrar cobro» a mano para cobrarle dos veces al cliente
// (simulación del mes, H130). Ahora la factura de un pedido debe, como
// mucho, lo que el pedido debe (fragmentos.SinCobrarDelPedido: la misma
// regla de «Me deben»). La que se debe en la cuenta corriente
// (EnCuentaDeFactura) debe, como mucho, el saldo de esa cuenta: con la cuenta
// en cero por los recibos está cobrada, y con saldo se puede cobrar desde acá
// (el pase a cuenta no es un cobro). Las notas de crédito, las anuladas y los
// borradores no se cobran. La de un pedido partido (a_cuenta, H047) debe las
// dos cosas: el resto sin cobrar y, de la parte a cuenta, lo que la cuenta
// todavía debe. De la cuenta, cada factura debe solo su parte
// (deudaQueLeTocaALaFactura), y lo acreditado con notas de crédito o una
// devolución ya no se debe: la factura devuelta a la cuenta seguía con su
// total y ofrecía cobrarlo entero (mes simulado, M3S2-002).
const SaldoDeFactura = `(CASE WHEN i.estado IN ('anulada', 'borrador') OR i.tipo::text LIKE 'nota_credito%' THEN 0
	WHEN o.a_cuenta IS NOT NULL AND o.estado <> 'cancelado' AND i.tipo::text LIKE 'factura%' THEN least(greatest(i.total - coalesce(c.cobrado_contado, 0) - i.acreditado, 0),
	  coalesce(` + fragmentos.SinCobrarDelPedido + `, 0) + least(o.a_cuenta, ` + deudaQueLeTocaALaFactura + `))
	WHEN ` + EnCuentaDeFactura + ` THEN least(greatest(i.total - coalesce(c.cobrado_contado, 0) - i.acreditado, 0), ` + deudaQueLeTocaALaFactura + `)
	WHEN i.order_id IS NULL OR i.tipo::text NOT LIKE 'factura%' THEN greatest(i.total - coalesce(c.cobrado, 0) - i.acreditado, 0)
	ELSE least(greatest(i.total - coalesce(c.cobrado, 0) - i.acreditado, 0), coalesce(` + fragmentos.SinCobrarDelPedido + `, 0)) END)`

// deudaQueLeTocaALaFactura es, de lo que el cliente debe en la cuenta, la
// parte que todavía corresponde a la factura `i`: los recibos cancelan
// primero lo más viejo, así que lo que se debe es lo último que se cargó.
// Es el saldo de la cuenta menos los cargos posteriores al de esta factura
// (sus compras, las de otros pedidos y las notas de débito), nunca menos de
// cero. Antes cada factura a cuenta tomaba el saldo entero de la cuenta: dos
// facturas de un cliente que debía $ 321.400 decían $ 321.400 cada una y la
// columna sumaba el doble (mes simulado, M2S1-013).
const deudaQueLeTocaALaFactura = `greatest(coalesce((SELECT sum(amc.monto) FROM account_movements amc WHERE amc.customer_id = i.customer_id), 0)
	  - coalesce((SELECT sum(amp.monto) FROM account_movements amp WHERE amp.customer_id = i.customer_id AND amp.monto > 0
	      AND amp.created_at > ` + cargoDeLaFactura + `), 0), 0)`

// cargoDeLaFactura es cuándo la factura `i` (con su pedido `o`) entró a la
// cuenta: el cargo del pedido, el pase a cuenta corriente o, la manual, su
// emisión (el cargo va en la misma transacción).
const cargoDeLaFactura = `(CASE WHEN o.id IS NOT NULL THEN coalesce((SELECT min(amf.created_at) FROM account_movements amf
	    WHERE amf.customer_id = i.customer_id AND amf.referencia = o.numero AND amf.monto > 0),
	    (SELECT min(ipf.created_at) FROM invoice_payments ipf WHERE ipf.invoice_id = i.id AND ipf.medio = 'cuenta_corriente'), i.created_at)
	  ELSE coalesce((SELECT min(ipf.created_at) FROM invoice_payments ipf WHERE ipf.invoice_id = i.id AND ipf.medio = 'cuenta_corriente'), i.created_at) END)`

// etiquetaDeLaFactura es etiqueta() en SQL para una factura `i`: la
// referencia con la que la manual carga su deuda en la cuenta.
const etiquetaDeLaFactura = `('Factura ' || upper(split_part(i.tipo::text, '_', 2)) || ' ' || lpad(i.punto_venta::text, 4, '0') || '-' || lpad(i.numero::text, 8, '0'))`

// EnCuentaDeFactura: la factura `i` (con su pedido `o`) se debe en la cuenta
// corriente: tiene el cobro «cuenta_corriente», o su pedido fue a cuenta
// (medio cuenta corriente, el resto del mostrador cargado a la cuenta, o la
// compra asentada en la cuenta con el número del pedido), o es una manual
// emitida a cuenta corriente: su compra entró a la cuenta al emitirse y no
// se cobró de contado en el mismo acto. Esa última ofrecía «Pasar a cuenta
// corriente» como si no estuviera cargada (mes simulado, M3S4-008).
const EnCuentaDeFactura = `(EXISTS (SELECT 1 FROM invoice_payments ipc WHERE ipc.invoice_id = i.id AND ipc.medio = 'cuenta_corriente')
	OR (o.id IS NOT NULL AND o.estado <> 'cancelado' AND (o.medio_pago IS NOT DISTINCT FROM 'cuenta_corriente' OR o.estado_pago = 'parcial'
	  OR EXISTS (SELECT 1 FROM account_movements am WHERE am.customer_id = o.customer_id AND am.referencia = o.numero AND am.tipo = 'compra')))
	OR (i.order_id IS NULL AND i.customer_id IS NOT NULL AND i.tipo::text LIKE 'factura%'
	  AND EXISTS (SELECT 1 FROM account_movements amm WHERE amm.customer_id = i.customer_id AND amm.tipo = 'compra'
	    AND amm.created_at = i.created_at AND amm.referencia = ` + etiquetaDeLaFactura + `)
	  AND NOT EXISTS (SELECT 1 FROM invoice_payments ipm WHERE ipm.invoice_id = i.id AND ipm.medio <> 'cuenta_corriente' AND ipm.created_at = i.created_at)))`

// EstadoAnuladaViva es el filtro de las facturas con CAE de ventas anuladas
// a las que les falta acreditar algo (fragmentos.FacturaViva).
const EstadoAnuladaViva = "anulada-viva"

// Filtros son los de listarComprobantes.
type Filtros struct {
	Estado   string
	Desde    *time.Time
	Hasta    *time.Time
	Cobro    string // contado | cuenta | todos
	Busqueda string
	Tope     int
	// Cliente: solo las de esa ficha. ConSaldo: solo las que deben algo
	// (SaldoDeFactura). Los usa la carga de una retención sufrida para
	// proponer la factura sobre la que retuvieron (M2S1-113).
	Cliente  string
	ConSaldo bool
}

// condicionesDeListado arma el WHERE de los filtros. El de la forma de
// cobro va en la consulta: antes se aplicaba en Go después del LIMIT, y
// «las de contado» de un mes con muchas facturas a cuenta salían cortas sin
// avisar.
func condicionesDeListado(f Filtros) (string, []any) {
	var cond []string
	var args []any
	arg := func(v any) string {
		args = append(args, v)
		return "$" + strconv.Itoa(len(args))
	}
	switch {
	case f.Estado == EstadoAnuladaViva:
		// Las facturas de ventas anuladas que siguen con su débito: a donde
		// llevan el Resumen y el Cierre, cada una con su nota de crédito a
		// un clic.
		// También las que no tienen CAE: no se van a autorizar y hay que
		// darlas de baja (fragmentos.FacturaSinBaja).
		cond = append(cond, "i.order_id IN (SELECT id FROM orders WHERE estado = 'cancelado')",
			"(("+fragmentos.FacturaSinAcreditar+") OR ("+fragmentos.FacturaSinBajaDeLaFila+"))")
	case f.Estado != "" && f.Estado != "todos":
		cond = append(cond, "i.estado::text = "+arg(f.Estado))
	}
	if f.Desde != nil {
		cond = append(cond, "i.fecha_emision >= "+arg(*f.Desde))
	}
	if f.Hasta != nil {
		cond = append(cond, "i.fecha_emision <= "+arg(*f.Hasta))
	}
	if t := strings.TrimSpace(f.Busqueda); t != "" {
		o := []string{"i.receptor_nombre ILIKE " + arg("%"+t+"%")}
		if d := fiscal.SoloDigitos(t); d != "" {
			p := arg("%" + d + "%")
			o = append(o, "i.receptor_cuit LIKE "+p, "i.numero::text LIKE "+p)
		}
		cond = append(cond, "("+strings.Join(o, " OR ")+")")
	}
	if f.Cliente != "" {
		cond = append(cond, "i.customer_id = "+arg(f.Cliente)+"::uuid")
	}
	if f.ConSaldo {
		cond = append(cond, SaldoDeFactura+" > 0.005")
	}
	// La forma de cobro: «cuenta» es la que se debe en la cuenta corriente
	// (EnCuentaDeFactura); «contado», la que tiene un cobro de contado desde
	// Facturación o es de un pedido que se pagó sin pasar por la cuenta.
	// Antes solo miraba invoice_payments, y una venta cobrada en el mostrador
	// no era «de contado».
	switch f.Cobro {
	case "cuenta":
		cond = append(cond, EnCuentaDeFactura)
	case "contado":
		cond = append(cond, "NOT "+EnCuentaDeFactura, "(EXISTS (SELECT 1 FROM invoice_payments p WHERE p.invoice_id = i.id AND p.medio::text = ANY("+
			arg(MediosDeContado)+")) OR (o.id IS NOT NULL AND o.estado_pago IN ('pagado', 'reintegrado')))")
	}
	if len(cond) == 0 {
		return "", args
	}
	return "WHERE " + strings.Join(cond, " AND "), args
}

// desdeListado es el FROM del listado y de su conteo: la factura, sus
// cobros sumados (c) y su pedido (o), que usan SaldoDeFactura y el filtro
// de la forma de cobro.
const desdeListado = `FROM invoices i LEFT JOIN (SELECT invoice_id, sum(monto) AS cobrado, sum(monto) FILTER (WHERE medio <> 'cuenta_corriente') AS cobrado_contado, array_agg(DISTINCT medio::text) AS medios
			FROM invoice_payments GROUP BY invoice_id) c ON c.invoice_id = i.id
		LEFT JOIN orders o ON o.id = i.order_id
		`

// columnasDeListado: «cobrado» es el total menos SaldoDeFactura, así la
// pantalla sigue restando total − cobrado.
const columnasDeListado = `SELECT i.id, i.tipo::text, i.punto_venta, i.numero, i.estado::text, i.receptor_nombre, i.receptor_cuit,
		i.total::float8, (i.total - ` + SaldoDeFactura + `)::float8, i.cae, i.fecha_emision, i.fecha_vencimiento, coalesce(c.medios, '{}'),
		` + EnCuentaDeFactura + `, o.numero, coalesce(o.estado = 'cancelado', false)
		` + desdeListado

func leerListado(filas pgx.Rows) ([]Listado, error) {
	defer filas.Close()
	out := []Listado{}
	for filas.Next() {
		var l Listado
		var medios []*string
		if err := filas.Scan(&l.ID, &l.Tipo, &l.PuntoVenta, &l.Numero, &l.Estado, &l.ReceptorNombre, &l.ReceptorCuit, &l.Total, &l.Cobrado,
			&l.Cae, &l.FechaEmision, &l.FechaVencimiento, &medios, &l.EnCuenta, &l.Pedido, &l.VentaAnulada); err != nil {
			return nil, err
		}
		l.Medios = []string{}
		for _, m := range medios {
			if m != nil && *m != "" {
				l.Medios = append(l.Medios, *m)
			}
		}
		out = append(out, l)
	}
	return out, filas.Err()
}

// Listar es listarComprobantes: lo cobrado se suma de los cobros (no se
// guarda en la factura) y «contado» es tener algún cobro de contado.
func (s *Servicio) Listar(ctx context.Context, f Filtros) ([]Listado, error) {
	where, args := condicionesDeListado(f)
	tope := f.Tope
	if tope <= 0 {
		tope = 200
	}
	filas, err := s.pool.Query(ctx, columnasDeListado+where+` ORDER BY i.fecha_emision DESC, i.numero DESC LIMIT `+strconv.Itoa(tope), args...)
	if err != nil {
		return nil, err
	}
	return leerListado(filas)
}

// PaginaDeComprobantes es una página del listado con lo que suma el filtro
// entero.
type PaginaDeComprobantes struct {
	Filas []Listado `json:"filas"`
	// Total: cuántos comprobantes cumplen el filtro.
	Total int `json:"total"`
	// Suma: lo facturado por el filtro entero, sumado en la base. Las notas
	// de crédito restan; las anuladas, las rechazadas y los borradores no
	// cuentan (no son facturación).
	Suma float64 `json:"suma"`
	// Cantidad: cuántos comprobantes suma Suma.
	Cantidad int `json:"cantidad"`
}

// cuentaComoFacturado: lo que suma el encabezado de Facturación y la
// tarjeta del período. Un rechazo real de ARCA tampoco es facturación (hay
// que corregirlo o darlo de baja). Lo sin CAE de una venta anulada tampoco:
// no se va a autorizar, se da de baja, y mientras tanto sumaba ventas que no
// existen (mes simulado, M2S2-034).
const cuentaComoFacturado = `i.estado NOT IN ('anulada', 'rechazada', 'borrador')
	AND NOT (i.cae IS NULL AND i.order_id IS NOT NULL AND EXISTS (SELECT 1 FROM orders ocf WHERE ocf.id = i.order_id AND ocf.estado = 'cancelado'))`

// ListarPagina es el listado de a páginas. Antes la pantalla pedía 200 (o
// 500 con un rango o una búsqueda), sumaba en Next lo que había llegado y no
// decía que había más: un mes con 600 facturas mostraba un total falso.
func (s *Servicio) ListarPagina(ctx context.Context, f Filtros, limite, desplazamiento int) (PaginaDeComprobantes, error) {
	p := PaginaDeComprobantes{Filas: []Listado{}}
	where, args := condicionesDeListado(f)
	var suma jsmath.Num
	// La suma y la cantidad del encabezado son del mismo conjunto. Antes la
	// cantidad contaba todos y la suma dejaba afuera los rechazados: «$ 9 M
	// en 36 comprobantes» sumaba 18 (H246). Ahora los dos cuentan lo que es
	// facturación: sin anuladas ni borradores, con o sin CAE, y la nota de
	// crédito resta. Total sigue siendo cuántas filas tiene el listado (las
	// páginas).
	if err := s.pool.QueryRow(ctx, `SELECT count(*)::int,
		  coalesce(sum(CASE WHEN i.tipo::text LIKE 'nota_credito%' THEN -i.total ELSE i.total END)
		    FILTER (WHERE `+cuentaComoFacturado+`), 0),
		  count(*) FILTER (WHERE `+cuentaComoFacturado+`)::int
		`+desdeListado+where, args...).Scan(&p.Total, &suma, &p.Cantidad); err != nil {
		return p, err
	}
	p.Suma = suma.F()
	n := len(args)
	filas, err := s.pool.Query(ctx, columnasDeListado+where+` ORDER BY i.fecha_emision DESC, i.numero DESC LIMIT $`+strconv.Itoa(n+1)+` OFFSET $`+strconv.Itoa(n+2),
		append(args, limite, desplazamiento)...)
	if err != nil {
		return p, err
	}
	p.Filas, err = leerListado(filas)
	return p, err
}

// Item es una fila de invoice_items, como la devolvía drizzle (los numeric
// como texto).
type Item struct {
	ID                  string  `json:"id"`
	InvoiceID           string  `json:"invoiceId"`
	Descripcion         string  `json:"descripcion"`
	Unidad              string  `json:"unidad"`
	Cantidad            string  `json:"cantidad"`
	PrecioUnitario      string  `json:"precioUnitario"`
	AlicuotaIva         string  `json:"alicuotaIva"`
	Neto                string  `json:"neto"`
	Iva                 string  `json:"iva"`
	Subtotal            string  `json:"subtotal"`
	InvoiceItemOrigenID *string `json:"invoiceItemOrigenId"`
	Orden               int64   `json:"orden"`
}

// CobroDeFactura es una fila de invoice_payments.
type CobroDeFactura struct {
	ID              string    `json:"id"`
	InvoiceID       string    `json:"invoiceId"`
	Medio           string    `json:"medio"`
	Monto           string    `json:"monto"`
	Referencia      *string   `json:"referencia"`
	ReceiptID       *string   `json:"receiptId"`
	// Recibo es el número del recibo: la manual cobrada decía «recibo» sin
	// número y la de un pedido «REC-0035» (M2S3-090).
	Recibo          *string   `json:"recibo"`
	Fecha           time.Time `json:"fecha"`
	CreatedByUserID *string   `json:"createdByUserId"`
	CreatedAt       time.Time `json:"createdAt"`
}

// TributoDeFactura es una fila de invoice_tributos.
type TributoDeFactura struct {
	ID            string `json:"id"`
	InvoiceID     string `json:"invoiceId"`
	Codigo        string `json:"codigo"`
	Descripcion   string `json:"descripcion"`
	BaseImponible string `json:"baseImponible"`
	Alicuota      string `json:"alicuota"`
	Importe       string `json:"importe"`
}

// Completo es el comprobante con renglones, cobros y tributos (leerComprobante).
type Completo struct {
	ID                   string     `json:"id"`
	Tipo                 string     `json:"tipo"`
	PuntoVenta           int64      `json:"puntoVenta"`
	Numero               int64      `json:"numero"`
	Estado               string     `json:"estado"`
	CustomerID           *string    `json:"customerId"`
	OrderID              *string    `json:"orderId"`
	ReceptorNombre       string     `json:"receptorNombre"`
	ReceptorCuit         *string    `json:"receptorCuit"`
	ReceptorCondicionIva string     `json:"receptorCondicionIva"`
	ReceptorDomicilio    *string    `json:"receptorDomicilio"`
	Neto                 string     `json:"neto"`
	Iva21                string     `json:"iva21"`
	Iva105               string     `json:"iva105"`
	Iva27                string     `json:"iva27"`
	Exento               string     `json:"exento"`
	TributosTotal        string     `json:"tributosTotal"`
	Total                string     `json:"total"`
	Cae                  *string    `json:"cae"`
	CaeVencimiento       *time.Time `json:"caeVencimiento"`
	// CaeAmbiente: un CAE de homologación es de prueba (no va al libro IVA
	// y el PDF lo dice).
	CaeAmbiente         *string   `json:"caeAmbiente"`
	ObservacionesArca   *string   `json:"observacionesArca"`
	ComprobanteOrigenID *string   `json:"comprobanteOrigenId"`
	Acreditado          string    `json:"acreditado"`
	Debitado            string    `json:"debitado"`
	FechaEmision        time.Time `json:"fechaEmision"`
	// La fecha con que se emitió, si al reintentar salió con la del día.
	FechaEmisionOriginal *time.Time `json:"fechaEmisionOriginal"`
	FechaVencimiento     *time.Time `json:"fechaVencimiento"`
	Observaciones        *string    `json:"observaciones"`
	PuntoVentaNombre     *string    `json:"puntoVentaNombre"`
	// Sucursal es la de la venta (la del pedido) y, sin pedido, la del punto
	// de venta. La venta del Aserradero facturada con el punto de venta de
	// Casa Central decía «Casa Central» (H341).
	Sucursal *string            `json:"sucursal"`
	Items    []Item             `json:"items"`
	Cobros   []CobroDeFactura   `json:"cobros"`
	Tributos []TributoDeFactura `json:"tributos"`
	Cobrado  float64            `json:"cobrado"`
	Saldo    float64            `json:"saldo"`
	// EnCuenta: la deuda vive en la cuenta corriente (EnCuentaDeFactura).
	EnCuenta bool `json:"enCuenta"`
	// Pedido y VentaAnulada: el número del pedido y si se canceló.
	Pedido       *string `json:"pedido"`
	VentaAnulada bool    `json:"ventaAnulada"`
	// CobrosDelPedido: con qué se cobró el pedido fuera de Facturación (la
	// caja del mostrador, los recibos del pedido, lo cobrado en línea). La
	// factura los muestra en vez de un saldo falso.
	CobrosDelPedido []CobroDelPedido `json:"cobrosDelPedido"`
	// QrURL es el enlace de verificación de ARCA (solo con CAE): el QR que
	// dibujan la hoja impresa y el PDF.
	QrURL *string `json:"qrUrl"`
}

// CobroDelPedido es un cobro del pedido de la factura que no pasó por
// invoice_payments.
type CobroDelPedido struct {
	Medio    string    `json:"medio"`
	Monto    float64   `json:"monto"`
	Fecha    time.Time `json:"fecha"`
	Recibo   *string   `json:"recibo"`
	ReciboID *string   `json:"reciboId"`
}

// cobrosDelPedido llena CobrosDelPedido: lo de la caja (order_payments), los
// recibos vivos del pedido que no están ya en los cobros de la factura y lo
// aprobado en línea. La venta del mostrador escribe cada pago en las dos
// tablas (order_payments y payments «mostrador»): se lee una sola, o el
// efectivo salía dos veces. Lo cargado a la cuenta corriente no es un cobro:
// lo paga el recibo que venga después.
func (s *Servicio) cobrosDelPedido(ctx context.Context, c *Completo) error {
	c.CobrosDelPedido = []CobroDelPedido{}
	// Una nota no se cobra: los cobros del pedido son de la factura que
	// corrige, y en la ficha de la nota de crédito parecían un cobro de la
	// nota (simulación del mes, tercera prueba).
	if c.OrderID == nil || strings.HasPrefix(c.Tipo, "nota_") {
		return nil
	}
	// La venta anulada devolvió lo cobrado: la ficha muestra la devolución
	// junto al cobro, en negativo, y no solo el «Efectivo $ 33.300» que
	// parecía plata que seguía adentro. Es lo que anularVenta pasó a
	// reintegrado, menos lo que ya habían devuelto las devoluciones por
	// afuera (que tienen su nota). El efectivo sale de la caja
	// (cash_movements «devolucion» de la anulación); el resto, por el medio.
	devueltos := ""
	if c.VentaAnulada {
		devueltos = `
		  UNION ALL
		  SELECT pg.medio, -(pg.monto - coalesce((SELECT sum(t.importe) FROM payment_refunds t WHERE t.payment_id = pg.id AND t.devolucion_id IS NOT NULL), 0))::float8,
		    pg.updated_at, NULL, NULL
		    FROM payments pg WHERE pg.order_id = $1 AND pg.estado = 'reintegrado' AND coalesce(pg.medio, '') NOT IN ('', 'cuenta_corriente')`
	}
	filas, err := s.pool.Query(ctx, `SELECT medio, monto, fecha, recibo, recibo_id FROM (
		  SELECT op.medio::text AS medio, op.importe::float8 AS monto, op.created_at AS fecha, NULL::text AS recibo, NULL::text AS recibo_id
		    FROM order_payments op WHERE op.order_id = $1 AND op.medio <> 'cuenta_corriente'
		  UNION ALL
		  SELECT coalesce((SELECT rp.medio::text FROM receipt_parts rp WHERE rp.receipt_id = r.id ORDER BY rp.orden LIMIT 1), 'recibo'),
		    r.total::float8, r.created_at, r.numero, r.id::text
		    FROM receipts r WHERE r.estado = 'emitido' AND r.id IN `+fragmentos.RecibosDelPedido("$1::uuid")+`
		      AND NOT EXISTS (SELECT 1 FROM invoice_payments ip WHERE ip.receipt_id = r.id AND ip.invoice_id = $2)
		  UNION ALL
		  SELECT coalesce(pg.medio, 'mercado_pago'), pg.monto::float8, pg.created_at, NULL, NULL FROM payments pg WHERE pg.order_id = $1 AND pg.estado = 'aprobado'
		    AND NOT (pg.proveedor = 'mostrador' AND EXISTS (SELECT 1 FROM order_payments opm WHERE opm.order_id = $1))`+devueltos+`
		) x WHERE monto <> 0 ORDER BY fecha`, *c.OrderID, c.ID)
	if err != nil {
		return err
	}
	defer filas.Close()
	for filas.Next() {
		var p CobroDelPedido
		if err := filas.Scan(&p.Medio, &p.Monto, &p.Fecha, &p.Recibo, &p.ReciboID); err != nil {
			return err
		}
		c.CobrosDelPedido = append(c.CobrosDelPedido, p)
	}
	return filas.Err()
}

// Obtener es leerComprobante, sin control de quién pregunta (lo hace la API).
func (s *Servicio) Obtener(ctx context.Context, id string) (*Completo, error) {
	var c Completo
	err := s.pool.QueryRow(ctx, `SELECT i.id, i.tipo::text, i.punto_venta, i.numero, i.estado::text, i.customer_id, i.order_id,
		i.receptor_nombre, i.receptor_cuit, i.receptor_condicion_iva::text, i.receptor_domicilio, i.neto::text, i.iva21::text,
		i.iva105::text, i.iva27::text, i.exento::text, i.tributos::text, i.total::text, i.cae, i.cae_vencimiento, i.cae_ambiente, i.observaciones_arca,
		i.comprobante_origen_id, i.acreditado::text, i.debitado::text, i.fecha_emision, i.fecha_vencimiento, i.observaciones, p.nombre,
		coalesce(ob.name, b.name), i.fecha_emision_original
		FROM invoices i LEFT JOIN puntos_venta p ON p.id = i.punto_venta_id LEFT JOIN branches b ON b.id = p.branch_id
		LEFT JOIN orders oo ON oo.id = i.order_id LEFT JOIN branches ob ON ob.id = oo.branch_id
		WHERE i.id = $1`, id).Scan(&c.ID, &c.Tipo, &c.PuntoVenta, &c.Numero, &c.Estado, &c.CustomerID, &c.OrderID, &c.ReceptorNombre,
		&c.ReceptorCuit, &c.ReceptorCondicionIva, &c.ReceptorDomicilio, &c.Neto, &c.Iva21, &c.Iva105, &c.Iva27, &c.Exento,
		&c.TributosTotal, &c.Total, &c.Cae, &c.CaeVencimiento, &c.CaeAmbiente, &c.ObservacionesArca, &c.ComprobanteOrigenID, &c.Acreditado,
		&c.Debitado, &c.FechaEmision, &c.FechaVencimiento, &c.Observaciones, &c.PuntoVentaNombre, &c.Sucursal, &c.FechaEmisionOriginal)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNoEsta
	}
	if err != nil {
		return nil, err
	}
	c.Items, c.Cobros, c.Tributos = []Item{}, []CobroDeFactura{}, []TributoDeFactura{}
	filas, err := s.pool.Query(ctx, `SELECT id, invoice_id, descripcion, unidad, cantidad::text, precio_unitario::text, alicuota_iva::text,
		neto::text, iva::text, subtotal::text, invoice_item_origen_id, orden FROM invoice_items WHERE invoice_id = $1 ORDER BY orden`, id)
	if err != nil {
		return nil, err
	}
	for filas.Next() {
		var i Item
		if err := filas.Scan(&i.ID, &i.InvoiceID, &i.Descripcion, &i.Unidad, &i.Cantidad, &i.PrecioUnitario, &i.AlicuotaIva, &i.Neto,
			&i.Iva, &i.Subtotal, &i.InvoiceItemOrigenID, &i.Orden); err != nil {
			filas.Close()
			return nil, err
		}
		c.Items = append(c.Items, i)
	}
	filas.Close()
	filas, err = s.pool.Query(ctx, `SELECT p.id, p.invoice_id, p.medio::text, p.monto::text, p.referencia, p.receipt_id, r.numero, p.fecha,
		p.created_by_user_id, p.created_at FROM invoice_payments p LEFT JOIN receipts r ON r.id = p.receipt_id
		WHERE p.invoice_id = $1 ORDER BY p.fecha DESC`, id)
	if err != nil {
		return nil, err
	}
	for filas.Next() {
		var p CobroDeFactura
		if err := filas.Scan(&p.ID, &p.InvoiceID, &p.Medio, &p.Monto, &p.Referencia, &p.ReceiptID, &p.Recibo, &p.Fecha, &p.CreatedByUserID,
			&p.CreatedAt); err != nil {
			filas.Close()
			return nil, err
		}
		c.Cobros = append(c.Cobros, p)
		c.Cobrado += jsmath.Numero(p.Monto)
	}
	filas.Close()
	filas, err = s.pool.Query(ctx, `SELECT id, invoice_id, codigo, descripcion, base_imponible::text, alicuota::text, importe::text
		FROM invoice_tributos WHERE invoice_id = $1`, id)
	if err != nil {
		return nil, err
	}
	for filas.Next() {
		var t TributoDeFactura
		if err := filas.Scan(&t.ID, &t.InvoiceID, &t.Codigo, &t.Descripcion, &t.BaseImponible, &t.Alicuota, &t.Importe); err != nil {
			filas.Close()
			return nil, err
		}
		c.Tributos = append(c.Tributos, t)
	}
	filas.Close()
	// El saldo con la misma regla que el listado (SaldoDeFactura): la venta
	// cobrada en el mostrador o con un recibo del pedido no se ofrece cobrar
	// otra vez.
	var saldo jsmath.Num
	if err := s.pool.QueryRow(ctx, `SELECT `+SaldoDeFactura+`, `+EnCuentaDeFactura+`, o.numero, coalesce(o.estado = 'cancelado', false)
		FROM invoices i LEFT JOIN (SELECT invoice_id, sum(monto) AS cobrado, sum(monto) FILTER (WHERE medio <> 'cuenta_corriente') AS cobrado_contado FROM invoice_payments WHERE invoice_id = $1 GROUP BY invoice_id) c
		  ON c.invoice_id = i.id
		LEFT JOIN orders o ON o.id = i.order_id WHERE i.id = $1`, id).Scan(&saldo, &c.EnCuenta, &c.Pedido, &c.VentaAnulada); err != nil {
		return nil, err
	}
	c.Saldo = saldo.F()
	if err := s.cobrosDelPedido(ctx, &c); err != nil {
		return nil, err
	}
	if c.Cae != nil && *c.Cae != "" {
		emisor, err := s.ObtenerEmisor(ctx)
		if err != nil {
			return nil, err
		}
		cuit := ""
		if emisor.Cuit != nil {
			cuit = *emisor.Cuit
		}
		u := pdf.UrlQr(pdf.DatosQr{Fecha: DiaArgentino(c.FechaEmision), CuitEmisor: cuit, PuntoVenta: float64(c.PuntoVenta), Tipo: c.Tipo,
			Numero: float64(c.Numero), Total: jsmath.Numero(c.Total), ReceptorCuit: de(c.ReceptorCuit), Cae: *c.Cae})
		c.QrURL = &u
	}
	return &c, nil
}

// DiaArgentino es el día de t en Argentina, como medianoche UTC: así lo leen
// el PDF y el QR (que tratan la fecha del comprobante como un día y la
// escriben en UTC). Es la misma fecha que va a ARCA (CbteFch): el TS usaba el
// día UTC y desde las 21 h el QR y el papel decían mañana.
func DiaArgentino(t time.Time) time.Time {
	a := t.In(fiscal.Argentina)
	return time.Date(a.Year(), a.Month(), a.Day(), 0, 0, 0, 0, time.UTC)
}

func de(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// Resumen son los números del período (resumenFacturacion).
type Resumen struct {
	CantidadMes           int64   `json:"cantidadMes"`
	TotalMes              float64 `json:"totalMes"`
	IvaMes                float64 `json:"ivaMes"`
	PendientesDeAutorizar int64   `json:"pendientesDeAutorizar"`
}

// ResumenDe cuenta lo facturado entre desde (inclusive) y hasta
// (exclusive) con la misma regla que el encabezado del listado
// (cuentaComoFacturado, la nota de crédito resta), y lo que falta
// autorizar. Antes contaba los rechazados y no restaba las notas: la misma
// pantalla daba dos totales para los mismos comprobantes (H153).
//
// El IVA es el débito fiscal: solo lo autorizado por ARCA (sin los CAE de
// homologación), el mismo número que el libro IVA ventas y el cierre. Antes
// sumaba el IVA de lo que no tenía CAE y Facturación decía $ 8,8 M de débito
// con el libro en $ 0 (H421).
func (s *Servicio) ResumenDe(ctx context.Context, desde, hasta *time.Time) (Resumen, error) {
	var r Resumen
	err := s.pool.QueryRow(ctx, `SELECT count(*),
		coalesce(sum(CASE WHEN i.tipo::text LIKE 'nota_credito%' THEN -i.total ELSE i.total END), 0)::float8,
		coalesce(sum(CASE WHEN i.tipo::text LIKE 'nota_credito%' THEN -1 ELSE 1 END * (i.iva21 + i.iva105 + i.iva27))
		  FILTER (WHERE i.cae IS NOT NULL AND i.cae_ambiente IS DISTINCT FROM 'homologacion'), 0)::float8
		FROM invoices i WHERE ($1::timestamptz IS NULL OR i.fecha_emision >= $1) AND ($2::timestamptz IS NULL OR i.fecha_emision < $2)
		AND `+cuentaComoFacturado, desde, hasta).Scan(&r.CantidadMes, &r.TotalMes, &r.IvaMes)
	if err != nil {
		return r, err
	}
	err = s.pool.QueryRow(ctx, `SELECT count(*) FROM invoices WHERE estado IN ('emitida', 'rechazada')`).Scan(&r.PendientesDeAutorizar)
	return r, err
}

// RenglonLibro es un comprobante del libro IVA ventas, con signo.
type RenglonLibro struct {
	ID                   string    `json:"id"`
	FechaEmision         time.Time `json:"fechaEmision"`
	Tipo                 string    `json:"tipo"`
	PuntoVenta           int64     `json:"puntoVenta"`
	Numero               int64     `json:"numero"`
	ReceptorNombre       string    `json:"receptorNombre"`
	ReceptorCuit         *string   `json:"receptorCuit"`
	ReceptorCondicionIva string    `json:"receptorCondicionIva"`
	Neto                 float64   `json:"neto"`
	Iva21                float64   `json:"iva21"`
	Iva105               float64   `json:"iva105"`
	Iva27                float64   `json:"iva27"`
	Exento               float64   `json:"exento"`
	Tributos             float64   `json:"tributos"`
	Total                float64   `json:"total"`
	Cae                  *string   `json:"cae"`
	Estado               string    `json:"estado"`
}

// TotalesLibro son las columnas sumadas.
type TotalesLibro struct {
	Neto     float64 `json:"neto"`
	Iva21    float64 `json:"iva21"`
	Iva105   float64 `json:"iva105"`
	Iva27    float64 `json:"iva27"`
	Exento   float64 `json:"exento"`
	Tributos float64 `json:"tributos"`
	Total    float64 `json:"total"`
}

// Libro es el libro IVA ventas.
type Libro struct {
	Filas   []RenglonLibro `json:"filas"`
	Totales TotalesLibro   `json:"totales"`
}

// ConSigno: una nota de crédito resta, así la columna sumada es lo que se
// declara.
func ConSigno(r RenglonLibro) RenglonLibro {
	if strings.HasPrefix(r.Tipo, "nota_credito") {
		r.Neto, r.Iva21, r.Iva105, r.Iva27 = -r.Neto, -r.Iva21, -r.Iva105, -r.Iva27
		r.Exento, r.Tributos, r.Total = -r.Exento, -r.Tributos, -r.Total
	}
	return r
}

// Sumar es el reduce del TS, en el orden del libro.
func Sumar(filas []RenglonLibro) TotalesLibro {
	var t TotalesLibro
	for _, f := range filas {
		t.Neto += f.Neto
		t.Iva21 += f.Iva21
		t.Iva105 += f.Iva105
		t.Iva27 += f.Iva27
		t.Exento += f.Exento
		t.Tributos += f.Tributos
		t.Total += f.Total
	}
	return t
}

// LibroIva es libroIvaVentas entre desde y hasta (inclusive): solo lo que
// tiene CAE. Un comprobante sin CAE (emitido y sin autorizar, rechazado o
// del proveedor interno) no existe para ARCA y no se declara; el TS solo
// sacaba los borradores. Una anulada con CAE sí va: su nota de crédito la
// resta en su propio renglón.
func (s *Servicio) LibroIva(ctx context.Context, desde, hasta time.Time) (Libro, error) {
	filas, err := s.pool.Query(ctx, `SELECT id, fecha_emision, tipo::text, punto_venta, numero, receptor_nombre, receptor_cuit,
		receptor_condicion_iva::text, neto::float8, iva21::float8, iva105::float8, iva27::float8, exento::float8, tributos::float8,
		total::float8, cae, estado::text FROM invoices WHERE fecha_emision >= $1 AND fecha_emision <= $2 AND cae IS NOT NULL
		AND cae_ambiente IS DISTINCT FROM 'homologacion'
		ORDER BY fecha_emision, numero`, desde, hasta)
	if err != nil {
		return Libro{}, err
	}
	defer filas.Close()
	l := Libro{Filas: []RenglonLibro{}}
	for filas.Next() {
		var r RenglonLibro
		if err := filas.Scan(&r.ID, &r.FechaEmision, &r.Tipo, &r.PuntoVenta, &r.Numero, &r.ReceptorNombre, &r.ReceptorCuit,
			&r.ReceptorCondicionIva, &r.Neto, &r.Iva21, &r.Iva105, &r.Iva27, &r.Exento, &r.Tributos, &r.Total, &r.Cae, &r.Estado); err != nil {
			return Libro{}, err
		}
		l.Filas = append(l.Filas, ConSigno(r))
	}
	l.Totales = Sumar(l.Filas)
	return l, filas.Err()
}

// PeriodoMensual es «aaaa-mm» en hora argentina: el mes fiscal es el del día
// en que se emitió en Argentina (el TS lo cortaba en UTC, y una factura de las
// 22 del último día caía en el libro del mes siguiente).
type PeriodoMensual struct {
	Desde, Hasta time.Time
	Clave        string
}

// LeerPeriodo lee el período (o el mes de ahora).
func LeerPeriodo(valor string, ahora time.Time) PeriodoMensual {
	ahora = ahora.In(fiscal.Argentina)
	a, m, _ := strings.Cut(valor, "-")
	if i := strings.Index(m, "-"); i >= 0 {
		m = m[:i]
	}
	anio := int(entero0(a))
	if anio == 0 {
		anio = ahora.Year()
	}
	mes := int(entero0(m))
	if mes == 0 {
		mes = int(ahora.Month())
	}
	mes = min(max(mes, 1), 12)
	desde := time.Date(anio, time.Month(mes), 1, 0, 0, 0, 0, fiscal.Argentina)
	return PeriodoMensual{Desde: desde, Hasta: desde.AddDate(0, 1, 0).Add(-time.Millisecond), Clave: desde.Format("2006-01")}
}

func entero0(t string) float64 {
	n := jsmath.Numero(t)
	if n != n {
		return 0
	}
	return float64(int64(n))
}

// Pedido es pedidoParaFacturar.
type Pedido struct {
	Pedido struct {
		ID                  string  `json:"id"`
		Numero              string  `json:"numero"`
		CustomerID          *string `json:"customerId"`
		ContactoNombre      string  `json:"contactoNombre"`
		CostoEnvio          string  `json:"costoEnvio"`
		ZonaEnvio           *string `json:"zonaEnvio"`
		Total               string  `json:"total"`
		ClienteNombre       *string `json:"clienteNombre"`
		ClienteRazonSocial  *string `json:"clienteRazonSocial"`
		ClienteCuit         *string `json:"clienteCuit"`
		ClienteCondicionIva *string `json:"clienteCondicionIva"`
		ClienteDireccion    *string `json:"clienteDireccion"`
	} `json:"pedido"`
	Items       []ItemDePedido `json:"items"`
	YaFacturado *struct {
		ID     string `json:"id"`
		Numero int64  `json:"numero"`
		Tipo   string `json:"tipo"`
	} `json:"yaFacturado"`
}

// ItemDePedido es un renglón del pedido, con su alícuota.
type ItemDePedido struct {
	// ID es el renglón del pedido: va a la factura, no a la respuesta.
	ID             string  `json:"-"`
	Descripcion    string  `json:"descripcion"`
	Unidad         string  `json:"unidad"`
	Cantidad       string  `json:"cantidad"`
	PrecioUnitario string  `json:"precioUnitario"`
	Alicuota       *string `json:"alicuota"`
}

// PedidoParaFacturar: el pedido, sus renglones con su alícuota y
// si ya tiene un comprobante vivo.
func (s *Servicio) PedidoParaFacturar(ctx context.Context, id string) (*Pedido, error) {
	var p Pedido
	x := &p.Pedido
	err := s.pool.QueryRow(ctx, `SELECT o.id, o.numero, o.customer_id, o.contacto_nombre, o.costo_envio::text, o.zona_envio, o.total::text,
		c.nombre, c.razon_social, c.cuit, c.condicion_iva::text, c.direccion
		FROM orders o LEFT JOIN customers c ON c.id = o.customer_id WHERE o.id = $1`, id).Scan(&x.ID, &x.Numero, &x.CustomerID,
		&x.ContactoNombre, &x.CostoEnvio, &x.ZonaEnvio, &x.Total, &x.ClienteNombre, &x.ClienteRazonSocial, &x.ClienteCuit,
		&x.ClienteCondicionIva, &x.ClienteDireccion)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNoEsta
	}
	if err != nil {
		return nil, err
	}
	// La alícuota es la que quedó guardada en el renglón al vender; la del
	// producto solo para renglones viejos que no la tienen. El TS leía la
	// del producto de hoy: si cambió después de la venta, la factura salía
	// con otra alícuota que la que se cobró.
	filas, err := s.pool.Query(ctx, `SELECT oi.id, oi.descripcion, oi.unidad, oi.cantidad::text, oi.precio_unitario::text,
		coalesce(oi.alicuota_iva, pr.alicuota_iva)::text
		FROM order_items oi LEFT JOIN product_variants v ON v.id = oi.variant_id LEFT JOIN products pr ON pr.id = v.product_id
		WHERE oi.order_id = $1 ORDER BY oi.orden`, id)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	p.Items = []ItemDePedido{}
	for filas.Next() {
		var i ItemDePedido
		if err := filas.Scan(&i.ID, &i.Descripcion, &i.Unidad, &i.Cantidad, &i.PrecioUnitario, &i.Alicuota); err != nil {
			return nil, err
		}
		p.Items = append(p.Items, i)
	}
	if err := filas.Err(); err != nil {
		return nil, err
	}
	var y struct {
		ID     string `json:"id"`
		Numero int64  `json:"numero"`
		Tipo   string `json:"tipo"`
	}
	err = s.pool.QueryRow(ctx, `SELECT id, numero, tipo::text FROM invoices WHERE order_id = $1 AND estado <> 'anulada' LIMIT 1`, id).
		Scan(&y.ID, &y.Numero, &y.Tipo)
	if err == nil {
		p.YaFacturado = &y
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	return &p, nil
}

// Propio es ComprobantePropio del portal.
type Propio struct {
	ID           string    `json:"id"`
	Tipo         string    `json:"tipo"`
	PuntoVenta   int64     `json:"puntoVenta"`
	Numero       int64     `json:"numero"`
	Estado       string    `json:"estado"`
	Total        float64   `json:"total"`
	Cae          *string   `json:"cae"`
	FechaEmision time.Time `json:"fechaEmision"`
	// Pedido es el número del pedido que factura: con dos facturas iguales,
	// el cliente no sabía cuál era de la venta anulada (H311).
	Pedido *string `json:"pedido"`
	// VentaAnulada: el pedido se canceló. Sin CAE, esa factura no vale ni se
	// va a autorizar (se da de baja): el portal la muestra anulada y no la
	// suma (H301).
	VentaAnulada bool `json:"ventaAnulada"`
}

// DelCliente son los comprobantes de una ficha, sin borradores.
func (s *Servicio) DelCliente(ctx context.Context, cliente string) ([]Propio, error) {
	filas, err := s.pool.Query(ctx, `SELECT i.id, i.tipo::text, i.punto_venta, i.numero, i.estado::text, i.total::float8, i.cae, i.fecha_emision,
		o.numero, coalesce(o.estado = 'cancelado', false)
		FROM invoices i LEFT JOIN orders o ON o.id = i.order_id
		WHERE i.customer_id = $1 AND i.estado <> 'borrador' ORDER BY i.fecha_emision DESC, i.numero DESC`, cliente)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	out := []Propio{}
	for filas.Next() {
		var p Propio
		if err := filas.Scan(&p.ID, &p.Tipo, &p.PuntoVenta, &p.Numero, &p.Estado, &p.Total, &p.Cae, &p.FechaEmision, &p.Pedido,
			&p.VentaAnulada); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, filas.Err()
}

// ClienteDeLaSesion es la ficha activa del usuario ("" si no tiene).
func (s *Servicio) ClienteDeLaSesion(ctx context.Context, userID string) (string, error) {
	var id string
	err := s.pool.QueryRow(ctx, `SELECT id FROM customers WHERE user_id = $1 AND active LIMIT 1`, userID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return id, err
}
