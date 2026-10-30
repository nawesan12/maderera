package facturacion

import (
	"context"
	"errors"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/fiscal"
	"mjbj/internal/jsmath"
	"mjbj/internal/pdf"
)

// Las lecturas de lib/dal/admin/facturacion.ts y de misComprobantes.

// MediosDeContado son los que cuentan como contado para el filtro.
var MediosDeContado = []string{"efectivo", "transferencia", "debito", "credito", "mercado_pago", "cheque"}

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
}

// Filtros son los de listarComprobantes.
type Filtros struct {
	Estado   string
	Desde    *time.Time
	Hasta    *time.Time
	Cobro    string // contado | cuenta | todos
	Busqueda string
	Tope     int
}

// Listar es listarComprobantes: lo cobrado se suma de los cobros (no se
// guarda en la factura) y «contado» es tener algún cobro de contado.
func (s *Servicio) Listar(ctx context.Context, f Filtros) ([]Listado, error) {
	var cond []string
	var args []any
	arg := func(v any) string {
		args = append(args, v)
		return "$" + strconv.Itoa(len(args))
	}
	if f.Estado != "" && f.Estado != "todos" {
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
	where := ""
	if len(cond) > 0 {
		where = "WHERE " + strings.Join(cond, " AND ")
	}
	tope := f.Tope
	if tope <= 0 {
		tope = 200
	}
	filas, err := s.pool.Query(ctx, `SELECT i.id, i.tipo::text, i.punto_venta, i.numero, i.estado::text, i.receptor_nombre, i.receptor_cuit,
		i.total::float8, coalesce(c.cobrado, 0)::float8, i.cae, i.fecha_emision, i.fecha_vencimiento, coalesce(c.medios, '{}')
		FROM invoices i LEFT JOIN (SELECT invoice_id, sum(monto) AS cobrado, array_agg(DISTINCT medio::text) AS medios
			FROM invoice_payments GROUP BY invoice_id) c ON c.invoice_id = i.id
		`+where+` ORDER BY i.fecha_emision DESC, i.numero DESC LIMIT `+strconv.Itoa(tope), args...)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	out := []Listado{}
	for filas.Next() {
		var l Listado
		var medios []*string
		if err := filas.Scan(&l.ID, &l.Tipo, &l.PuntoVenta, &l.Numero, &l.Estado, &l.ReceptorNombre, &l.ReceptorCuit, &l.Total, &l.Cobrado,
			&l.Cae, &l.FechaEmision, &l.FechaVencimiento, &medios); err != nil {
			return nil, err
		}
		l.Medios = []string{}
		for _, m := range medios {
			if m != nil && *m != "" {
				l.Medios = append(l.Medios, *m)
			}
		}
		de := slices.ContainsFunc(l.Medios, func(m string) bool { return slices.Contains(MediosDeContado, m) })
		if f.Cobro == "contado" && !de || f.Cobro == "cuenta" && de {
			continue
		}
		out = append(out, l)
	}
	return out, filas.Err()
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
	ID                   string             `json:"id"`
	Tipo                 string             `json:"tipo"`
	PuntoVenta           int64              `json:"puntoVenta"`
	Numero               int64              `json:"numero"`
	Estado               string             `json:"estado"`
	CustomerID           *string            `json:"customerId"`
	OrderID              *string            `json:"orderId"`
	ReceptorNombre       string             `json:"receptorNombre"`
	ReceptorCuit         *string            `json:"receptorCuit"`
	ReceptorCondicionIva string             `json:"receptorCondicionIva"`
	ReceptorDomicilio    *string            `json:"receptorDomicilio"`
	Neto                 string             `json:"neto"`
	Iva21                string             `json:"iva21"`
	Iva105               string             `json:"iva105"`
	Iva27                string             `json:"iva27"`
	Exento               string             `json:"exento"`
	TributosTotal        string             `json:"tributosTotal"`
	Total                string             `json:"total"`
	Cae                  *string            `json:"cae"`
	CaeVencimiento       *time.Time         `json:"caeVencimiento"`
	ObservacionesArca    *string            `json:"observacionesArca"`
	ComprobanteOrigenID  *string            `json:"comprobanteOrigenId"`
	Acreditado           string             `json:"acreditado"`
	Debitado             string             `json:"debitado"`
	FechaEmision         time.Time          `json:"fechaEmision"`
	FechaVencimiento     *time.Time         `json:"fechaVencimiento"`
	Observaciones        *string            `json:"observaciones"`
	PuntoVentaNombre     *string            `json:"puntoVentaNombre"`
	Sucursal             *string            `json:"sucursal"`
	Items                []Item             `json:"items"`
	Cobros               []CobroDeFactura   `json:"cobros"`
	Tributos             []TributoDeFactura `json:"tributos"`
	Cobrado              float64            `json:"cobrado"`
	Saldo                float64            `json:"saldo"`
	// QrURL es el enlace de verificación de ARCA (solo con CAE): el QR que
	// dibujan la hoja impresa y el PDF.
	QrURL *string `json:"qrUrl"`
}

// Obtener es leerComprobante, sin control de quién pregunta (lo hace la API).
func (s *Servicio) Obtener(ctx context.Context, id string) (*Completo, error) {
	var c Completo
	err := s.pool.QueryRow(ctx, `SELECT i.id, i.tipo::text, i.punto_venta, i.numero, i.estado::text, i.customer_id, i.order_id,
		i.receptor_nombre, i.receptor_cuit, i.receptor_condicion_iva::text, i.receptor_domicilio, i.neto::text, i.iva21::text,
		i.iva105::text, i.iva27::text, i.exento::text, i.tributos::text, i.total::text, i.cae, i.cae_vencimiento, i.observaciones_arca,
		i.comprobante_origen_id, i.acreditado::text, i.debitado::text, i.fecha_emision, i.fecha_vencimiento, i.observaciones, p.nombre, b.name
		FROM invoices i LEFT JOIN puntos_venta p ON p.id = i.punto_venta_id LEFT JOIN branches b ON b.id = p.branch_id
		WHERE i.id = $1`, id).Scan(&c.ID, &c.Tipo, &c.PuntoVenta, &c.Numero, &c.Estado, &c.CustomerID, &c.OrderID, &c.ReceptorNombre,
		&c.ReceptorCuit, &c.ReceptorCondicionIva, &c.ReceptorDomicilio, &c.Neto, &c.Iva21, &c.Iva105, &c.Iva27, &c.Exento,
		&c.TributosTotal, &c.Total, &c.Cae, &c.CaeVencimiento, &c.ObservacionesArca, &c.ComprobanteOrigenID, &c.Acreditado,
		&c.Debitado, &c.FechaEmision, &c.FechaVencimiento, &c.Observaciones, &c.PuntoVentaNombre, &c.Sucursal)
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
	filas, err = s.pool.Query(ctx, `SELECT id, invoice_id, medio::text, monto::text, referencia, receipt_id, fecha, created_by_user_id,
		created_at FROM invoice_payments WHERE invoice_id = $1 ORDER BY fecha DESC`, id)
	if err != nil {
		return nil, err
	}
	for filas.Next() {
		var p CobroDeFactura
		if err := filas.Scan(&p.ID, &p.InvoiceID, &p.Medio, &p.Monto, &p.Referencia, &p.ReceiptID, &p.Fecha, &p.CreatedByUserID,
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
	c.Saldo = jsmath.Numero(c.Total) - c.Cobrado
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

// ResumenDe cuenta lo facturado (sin anuladas ni notas de crédito) entre
// desde (inclusive) y hasta (exclusive), y lo que falta autorizar.
func (s *Servicio) ResumenDe(ctx context.Context, desde, hasta *time.Time) (Resumen, error) {
	var r Resumen
	err := s.pool.QueryRow(ctx, `SELECT count(*), coalesce(sum(total), 0)::float8, coalesce(sum(iva21 + iva105 + iva27), 0)::float8
		FROM invoices WHERE ($1::timestamptz IS NULL OR fecha_emision >= $1) AND ($2::timestamptz IS NULL OR fecha_emision < $2)
		AND estado <> 'anulada' AND tipo::text NOT LIKE 'nota_credito%'`, desde, hasta).Scan(&r.CantidadMes, &r.TotalMes, &r.IvaMes)
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
	filas, err := s.pool.Query(ctx, `SELECT oi.descripcion, oi.unidad, oi.cantidad::text, oi.precio_unitario::text,
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
		if err := filas.Scan(&i.Descripcion, &i.Unidad, &i.Cantidad, &i.PrecioUnitario, &i.Alicuota); err != nil {
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
}

// DelCliente son los comprobantes de una ficha, sin borradores.
func (s *Servicio) DelCliente(ctx context.Context, cliente string) ([]Propio, error) {
	filas, err := s.pool.Query(ctx, `SELECT id, tipo::text, punto_venta, numero, estado::text, total::float8, cae, fecha_emision
		FROM invoices WHERE customer_id = $1 AND estado <> 'borrador' ORDER BY fecha_emision DESC`, cliente)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	out := []Propio{}
	for filas.Next() {
		var p Propio
		if err := filas.Scan(&p.ID, &p.Tipo, &p.PuntoVenta, &p.Numero, &p.Estado, &p.Total, &p.Cae, &p.FechaEmision); err != nil {
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
