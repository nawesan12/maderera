package facturacion

import (
	"context"
	"errors"
	"math"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/clientes"
	"mjbj/internal/cobros"
	"mjbj/internal/cola"
	"mjbj/internal/fiscal"
	"mjbj/internal/formato"
	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
	"mjbj/internal/precios"
	"mjbj/internal/reglas"
	"mjbj/internal/sqlc"
)

// TrabajoAvisoDeFactura es el aviso al cliente con el comprobante en PDF
// (lib/notificaciones/fiscal.ts). Lo encola Go en la misma transacción que
// emite (sale solo si se confirmó) y lo atiende el worker
// (internal/notificaciones).
const TrabajoAvisoDeFactura = "factura.aviso"

// TrabajoAvisoDeRenumerada es el reenvío al cliente de un comprobante sin
// CAE que cambió de número por una baja: {invoiceId, anterior}. Tenía el PDF
// con el número viejo (M2S1-010).
const TrabajoAvisoDeRenumerada = "factura.renumerada"

// TrabajoAvisoDeBaja avisa al cliente que el comprobante que recibió se dio
// de baja: {bajaId} (M3S4-009).
const TrabajoAvisoDeBaja = "factura.baja"

func (s *Servicio) encolarAviso(ctx context.Context, tx pgx.Tx, id string) error {
	_, err := cola.Encolar(ctx, s.q.WithTx(tx), TrabajoAvisoDeFactura, map[string]string{"invoiceId": id}, time.Time{})
	return err
}

// AvisarFactura encola el aviso fuera de una emisión (después de autorizar).
func (s *Servicio) AvisarFactura(ctx context.Context, id string) error {
	_, err := cola.Encolar(ctx, s.q, TrabajoAvisoDeFactura, map[string]string{"invoiceId": id}, time.Time{})
	return err
}

func ptr[T any](v T) *T { return &v }

// devueltoSinFactura es lo que las devoluciones sin factura del pedido se
// llevaron de cada renglón, y su importe.
func (s *Servicio) devueltoSinFactura(ctx context.Context, pedido string) (map[string]float64, float64, error) {
	filas, err := s.pool.Query(ctx, `
		SELECT di.order_item_id::text, sum(di.cantidad)::float8, sum(di.importe)::float8
		FROM devolucion_items di JOIN devoluciones d ON d.id = di.devolucion_id
		WHERE d.order_id = $1 AND d.invoice_id IS NULL AND di.order_item_id IS NOT NULL
		GROUP BY di.order_item_id`, pedido)
	if err != nil {
		return nil, 0, err
	}
	defer filas.Close()
	out := map[string]float64{}
	total := 0.0
	for filas.Next() {
		var id string
		var cantidad, importe float64
		if err := filas.Scan(&id, &cantidad, &importe); err != nil {
			return nil, 0, err
		}
		out[id] = cantidad
		total = jsmath.Redondear2(total + importe)
	}
	return out, total, filas.Err()
}

// FacturarPedido es facturarPedido: los renglones y la condición frente al
// IVA salen del pedido y de la ficha, no de lo que se tipee; el envío entra
// como un renglón más.
//
// El TS miraba si el pedido ya tenía comprobante fuera de la transacción: dos
// clics a la vez lo facturaban dos veces. Acá el pedido se bloquea y se
// vuelve a mirar adentro.
func (s *Servicio) FacturarPedido(ctx context.Context, ses *auth.Sesion, orderID string) (string, error) {
	datos, err := s.PedidoParaFacturar(ctx, orderID)
	if errors.Is(err, ErrNoEsta) {
		return "", errEmision("No encontramos ese pedido.")
	}
	if err != nil {
		return "", err
	}
	yaFacturado := func(n int64) error {
		return errEmision("Ese pedido ya tiene el comprobante " + jsmath.Texto(float64(n)) + " emitido.")
	}
	if datos.YaFacturado != nil {
		return "", yaFacturado(datos.YaFacturado.Numero)
	}
	p := datos.Pedido
	// Lo que se devolvió antes de facturar (la devolución de un pedido sin
	// factura, pedidos.DevolverSinFactura) no se factura: ni la cantidad ni
	// su plata, que ya bajó lo que había que cobrar.
	devueltos, importeDevuelto, err := s.devueltoSinFactura(ctx, orderID)
	if err != nil {
		return "", err
	}
	lineas := make([]Linea, 0, len(datos.Items)+1)
	for _, i := range datos.Items {
		alic := 21.0
		if i.Alicuota != nil && *i.Alicuota != "" {
			alic = jsmath.Numero(*i.Alicuota)
		}
		cantidad := jsmath.Numero(i.Cantidad)
		if d := devueltos[i.ID]; d > 0 {
			if cantidad = jsmath.Round(float64((cantidad-d)*1000)) / 1000; cantidad <= 0 {
				continue
			}
		}
		unidad, renglon := i.Unidad, i.ID
		lineas = append(lineas, Linea{LineaEntrada: fiscal.LineaEntrada{Descripcion: i.Descripcion, Unidad: &unidad,
			Cantidad: cantidad, PrecioFinalUnitario: jsmath.Numero(i.PrecioUnitario), Alicuota: &alic}, OrderItemID: &renglon})
	}
	if len(lineas) == 0 {
		return "", errEmision("Se devolvió todo: no queda nada para facturar.")
	}
	// Lo que se cobró manda. La tienda guarda los renglones a precio lleno y
	// el descuento (el de la forma de pago) aparte, en el pedido: sin esto la
	// factura salía por más de lo cobrado y se le informaba a ARCA más IVA.
	// Va sobre la mercadería y no sobre el envío, como en la compra. Con los
	// renglones ya rebajados (el mostrador) el factor es 1 y no se toca nada.
	mercaderia := 0.0
	for _, l := range lineas {
		mercaderia = float64(l.Cantidad*l.PrecioFinalUnitario) + mercaderia
	}
	if cobrado := jsmath.Numero(p.Total) - jsmath.Numero(p.CostoEnvio) - importeDevuelto; mercaderia > 0 && cobrado > 0 && math.Abs(cobrado-mercaderia) > 0.005 {
		factor := cobrado / mercaderia
		for i := range lineas {
			lineas[i].PrecioFinalUnitario = jsmath.Round(float64(lineas[i].PrecioFinalUnitario*factor*100)) / 100
		}
	}
	if envio := jsmath.Numero(p.CostoEnvio); envio > 0 {
		d := "Envío"
		if p.ZonaEnvio != nil && *p.ZonaEnvio != "" {
			d += " — " + *p.ZonaEnvio
		}
		lineas = append(lineas, Linea{LineaEntrada: fiscal.LineaEntrada{Descripcion: d, Unidad: ptr("unidad"), Cantidad: 1,
			PrecioFinalUnitario: envio, Alicuota: ptr(21.0)}})
	}
	nombre := p.ContactoNombre
	switch {
	case p.ClienteRazonSocial != nil:
		nombre = *p.ClienteRazonSocial
	case p.ClienteNombre != nil:
		nombre = *p.ClienteNombre
	}
	condicion := fiscal.ConsumidorFinal
	if p.ClienteCondicionIva != nil {
		condicion = *p.ClienteCondicionIva
	}
	var id string
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		// Una venta anulada no se factura: el pedido cancelado que perdió su
		// comprobante en una baja no vuelve a la cola de facturar.
		var estadoPedido string
		if err := tx.QueryRow(ctx, `SELECT estado::text FROM orders WHERE id = $1 FOR UPDATE`, orderID).Scan(&estadoPedido); err != nil {
			return err
		}
		if estadoPedido == "cancelado" {
			return errEmision("El pedido está cancelado: no se factura.")
		}
		var n int64
		err := tx.QueryRow(ctx, `SELECT numero FROM invoices WHERE order_id = $1 AND estado <> 'anulada' LIMIT 1`, orderID).Scan(&n)
		if err == nil {
			return yaFacturado(n)
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		id, err = s.EmitirEnTransaccion(ctx, tx, DatosEmision{CustomerID: p.CustomerID, OrderID: &p.ID, ReceptorNombre: nombre,
			ReceptorCuit: p.ClienteCuit, ReceptorCondicionIva: condicion, ReceptorDomicilio: p.ClienteDireccion,
			Observaciones: ptr("Pedido " + p.Numero), CreatedByUserID: &ses.UserID, Lineas: lineas}, "")
		if err != nil {
			return err
		}
		return s.encolarAviso(ctx, tx, id)
	})
	if err != nil {
		return "", s.comoEmision(err, "fiscal.emitir", "No se pudo emitir el comprobante. Intentá de nuevo.")
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCrear, "factura", id, "Facturó el pedido "+p.Numero, nil)
	return id, nil
}

// LineasManuales son los renglones del formulario, como los mandaba el
// FormData (getAll de cada campo, en paralelo).
type LineasManuales struct {
	Descripcion []string `json:"descripcion"`
	Cantidad    []string `json:"cantidad"`
	Precio      []string `json:"precio"`
	Alicuota    []string `json:"alicuota"`
}

func en(xs []string, i int) valor {
	if i < len(xs) {
		return texto(xs[i])
	}
	return valor{nada: true}
}

// EmitirManual es emitirManual: la venta que no pasó por un pedido. Con
// «guardar como cliente» crea la ficha antes de emitir (o usa la que ya tiene
// ese CUIT), y a un cliente con ficha la factura le genera la deuda.
//
// Devuelve, además del id, el aviso del cobro de contado cuando el efectivo no
// pudo entrar a ningún arqueo (como Cobrar): sin él, con dos cajas abiertas
// la plata quedaba fuera de las dos y nadie se enteraba.
func (s *Servicio) EmitirManual(ctx context.Context, ses *auth.Sesion, c map[string]string, ls LineasManuales) (string, *string, error) {
	cab, err := validarCabecera(c)
	if err != nil {
		return "", nil, err
	}
	nombre, cuit, condicion, cliente := cab.nombre, cab.cuit, cab.condicion, cab.cliente
	domicilio, obs := cab.domicilio, cab.obs
	guardar := c["guardarComoCliente"] == "on"
	// Cómo paga: de contado con un medio (sale con su recibo, como cualquier
	// cobro) o a cuenta corriente. Sin el campo es cuenta corriente, que es
	// lo que hacía siempre la factura manual.
	comoPaga, medio, err := leerComoPaga(c)
	if err != nil {
		return "", nil, err
	}
	if comoPaga == "cuenta_corriente" && c["comoPaga"] != "" && strings.TrimSpace(cliente) == "" && !guardar {
		return "", nil, errEmision("Para dejarlo en cuenta corriente elegí el cliente o guardalo como cliente nuevo.")
	}
	// La caja a la que entra el efectivo de contado. La factura manual no
	// tiene pedido del que sacar la sucursal (como Cobrar): con una sola caja
	// abierta va a esa, y con varias la elige el formulario.
	var sucursal *string
	if suc := strings.TrimSpace(c["sucursal"]); suc != "" && comoPaga == "contado" {
		if !plataforma.UUIDValido(suc) {
			return "", nil, errEmision("Elegí la caja a la que entra el efectivo.")
		}
		sucursal = &suc
	}
	// El documento, con su dígito verificador: un CUIT mal tipeado no va a
	// ARCA. Y una A sin CUIT salía con DocTipo 99 (consumidor final), que
	// ARCA rechaza.
	if strings.TrimSpace(cuit) != "" {
		if _, msj := clientes.LeerDocumento(cuit); msj != "" {
			return "", nil, errEmision(msj)
		}
	}
	// Con la regla en «b», al monotributista le sale B: no hace falta su CUIT.
	if condicion != fiscal.Monotributista || !reglas.Es(ctx, s.pool, reglas.FacturaAlMonotributista, "b") {
		if m := faltaCuitParaLaA(condicion, &cuit); m != "" {
			return "", nil, errEmision(m)
		}
	}

	var lineas []Linea
	for i, d := range ls.Descripcion {
		if strings.TrimSpace(d) == "" {
			continue
		}
		desc, cant, precio, alic, ok := validarLinea(texto(d), en(ls.Cantidad, i), en(ls.Precio, i), en(ls.Alicuota, i))
		if !ok {
			return "", nil, errEmision("Revisá la línea " + jsmath.Texto(float64(i+1)) + ": cantidad y precio deben ser mayores a cero.")
		}
		if !fiscal.AlicuotaValida(alic) {
			return "", nil, errEmision("Revisá la línea " + jsmath.Texto(float64(i+1)) + ": " + fiscal.MensajeAlicuota)
		}
		lineas = append(lineas, Linea{LineaEntrada: fiscal.LineaEntrada{Descripcion: desc, Cantidad: cant, PrecioFinalUnitario: precio, Alicuota: ptr(alic)}})
	}
	if len(lineas) == 0 {
		return "", nil, errEmision("Agregá al menos un renglón a la factura.")
	}

	var customerID *string
	if cliente != "" {
		customerID = &cliente
	}
	if customerID == nil && guardar {
		doc, msj := clientes.LeerDocumento(cuit)
		if msj != "" {
			return "", nil, errEmision(msj)
		}
		id, _, existe, err := clientes.PorDocumento(ctx, s.pool, doc)
		if err != nil {
			return "", nil, err
		}
		if !existe {
			// Una ficha nueva nace sin límite de crédito: a cuenta corriente
			// Credito la rechazaría igual, pero después de crearla. Se frena
			// antes, con el mismo mensaje, para no dejar una ficha huérfana.
			if comoPaga == "cuenta_corriente" {
				return "", nil, errEmision("Este cliente no tiene cuenta corriente habilitada. Cobralo de otra forma o revisá la ficha del cliente.")
			}
			if id, err = clientes.CrearRapido(ctx, s.pool, clientes.ClienteNuevo{Nombre: nombre, Documento: doc, CondicionIva: condicion,
				Direccion: domicilio, Notas: ptr("Ficha creada al emitir una factura.")}); err != nil {
				return "", nil, err
			}
			bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCrear, "cliente", id, "Dio de alta a "+nombre+" al facturar", nil)
		}
		customerID = &id
	}
	var receptorCuit *string
	if d := fiscal.SoloDigitos(cuit); d != "" {
		receptorCuit = &d
	}
	var id string
	var recibo *cobros.ReciboEmitido
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var err error
		id, err = s.EmitirEnTransaccion(ctx, tx, DatosEmision{CustomerID: customerID, ReceptorNombre: nombre, ReceptorCuit: receptorCuit,
			ReceptorCondicionIva: condicion, ReceptorDomicilio: domicilio, Observaciones: obs,
			CreatedByUserID: &ses.UserID, Lineas: lineas}, "")
		if err != nil {
			return err
		}
		// La factura suelta a un cliente con ficha le genera la deuda (la de
		// un pedido la maneja el pedido). En la misma transacción: el TS la
		// anotaba después, y si fallaba quedaba la factura sin la deuda.
		var tipo string
		var pv, n int64
		var total string
		if err := tx.QueryRow(ctx, `SELECT tipo::text, punto_venta, numero, total::text FROM invoices WHERE id = $1`, id).
			Scan(&tipo, &pv, &n, &total); err != nil {
			return err
		}
		et := etiqueta(tipo, pv, n)
		// A cuenta corriente, el mismo control que Cobrar: límite, mora y
		// cuenta bloqueada. Sin él, la factura manual era la puerta para
		// venderle fiado a quien el resto del sistema ya no le fía.
		if customerID != nil && comoPaga == "cuenta_corriente" {
			if err := s.puedeACuenta(ctx, tx, *customerID, jsmath.Numero(total)); err != nil {
				return err
			}
		}
		if customerID != nil {
			if _, err := tx.Exec(ctx, `INSERT INTO account_movements (customer_id, tipo, monto, detalle, referencia, created_by_user_id)
				VALUES ($1, 'compra', $2::numeric, $3, $3, $4)`, *customerID, jsmath.Fijo2(jsmath.Numero(total)), et, ses.UserID); err != nil {
				return err
			}
		}
		// De contado: el cobro por el total, con su recibo, en la misma
		// transacción que la factura. Con ficha, el recibo deja el pago que
		// cancela la compra de arriba; el efectivo entra a la caja abierta.
		if comoPaga == "contado" {
			r, err := cobrarConRecibo(ctx, tx, ses, id, customerID, nombre, sucursal, et,
				[]cobros.Parte{{Medio: medio, Importe: jsmath.Numero(total)}}, false)
			if err != nil {
				return err
			}
			recibo = &r
		}
		return s.encolarAviso(ctx, tx, id)
	})
	if err != nil {
		var ec *cobros.ErrorDeCobro
		if errors.As(err, &ec) {
			return "", nil, errEmision(ec.Mensaje)
		}
		return "", nil, s.comoEmision(err, "fiscal.emitir", "No se pudo emitir el comprobante. Intentá de nuevo.")
	}
	var aviso *string
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCrear, "factura", id, "Emitió un comprobante manual a "+nombre, nil)
	if recibo != nil {
		bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCobrar, "factura", id,
			"Cobró de contado con el recibo "+recibo.Numero+" por "+formato.Importe(recibo.Total), map[string]any{"receiptId": recibo.ReceiptID})
		if recibo.Aviso != nil && *recibo.Aviso != "" {
			aviso = recibo.Aviso
		}
	}
	return id, aviso, nil
}

// puedeACuenta es el control de crédito de Cobrar, con el mismo mensaje.
func (s *Servicio) puedeACuenta(ctx context.Context, tx pgx.Tx, cliente string, monto float64) error {
	credito, err := cobros.Credito(ctx, s.q.WithTx(tx), cliente, monto, s.ahora())
	if err != nil {
		return err
	}
	if !credito.Puede {
		motivo := "No se puede cargar a cuenta corriente."
		if credito.Motivo != nil {
			motivo = *credito.Motivo
		}
		return errEmision(motivo + " Cobralo de otra forma o revisá la ficha del cliente.")
	}
	return nil
}

// mediosDeLaManual son los medios de la factura manual de contado, con los
// nombres de cobros.Medio.
var mediosDeLaManual = []cobros.Medio{"efectivo", "transferencia", "tarjeta_debito", "tarjeta_credito", "mercado_pago"}

func leerComoPaga(c map[string]string) (string, cobros.Medio, error) {
	switch c["comoPaga"] {
	case "", "cuenta_corriente":
		return "cuenta_corriente", "", nil
	case "contado":
		m := cobros.Medio(c["medio"])
		if !slices.Contains(mediosDeLaManual, m) {
			return "", "", errEmision("Elegí con qué paga.")
		}
		return "contado", m, nil
	}
	return "", "", errEmision("Elegí cómo paga.")
}

// cabecera es lo que dejaba el esquema de la factura manual.
type cabecera struct {
	nombre, cuit, condicion, cliente string
	domicilio, obs                   *string
}

// validarCabecera es el esquema de la cabecera de emitirManual.
func validarCabecera(c map[string]string) (cabecera, error) {
	var e esquema
	var d cabecera
	d.nombre, _ = e.cadena("receptorNombre", get(c, "receptorNombre"), false, 2, "Falta el nombre.", 160)
	cuit, hayCuit := e.cadena("receptorCuit", vacioAUndef(c, "receptorCuit"), true, 0, "", 20)
	if e.ok() && hayCuit && cuit != "" && !cuitZod.MatchString(cuit) {
		e.mal("receptorCuit", "El CUIT tiene que tener 11 dígitos.")
	}
	d.cuit = cuit
	d.condicion = e.opcion("receptorCondicionIva", get(c, "receptorCondicionIva"), fiscal.Condiciones)
	d.domicilio = opcional(e.cadena("receptorDomicilio", vacioAUndef(c, "receptorDomicilio"), true, 0, "", 200))
	d.obs = opcional(e.cadena("observaciones", vacioAUndef(c, "observaciones"), true, 0, "", 600))
	d.cliente = e.uuid("customerId", vacioAUndef(c, "customerId"), true)
	return d, e.Problema()
}

// validarLinea es lineaManualSchema: la descripción, cantidad y precio
// positivos con tope, y la alícuota (vacía es 21) un número.
func validarLinea(desc, cantidad, precio, alicuota valor) (string, float64, float64, float64, bool) {
	var e esquema
	d, _ := e.cadena("descripcion", desc, false, 1, "", 240)
	c, ok1 := positivo(cantidad, 100000)
	// El precio se escribe como en la calle: «12.000» son doce mil, no doce
	// (recorrido: la factura manual salía por $ 12). Igual que el resto de
	// los campos de plata, con ParsearImporte.
	if !precio.nada && !precio.nulo {
		if x := precios.ParsearImporte(precio.s); !math.IsNaN(x) {
			precio = texto(strconv.FormatFloat(x, 'f', -1, 64))
		}
	}
	p, ok2 := positivo(precio, 100_000_000)
	if alicuota.nada || alicuota.nulo || alicuota.s == "" {
		alicuota = texto("21")
	}
	a := numeroJS(alicuota)
	return d, c, p, a, e.ok() && ok1 && ok2 && a == a && !math.IsInf(a, 0)
}

// --- el mostrador ---

// LineaDeVenta es un renglón de la venta del mostrador (LineaDeVenta de
// lib/mostrador/importes.ts, lo que usa el comprobante).
type LineaDeVenta struct {
	Descripcion    string  `json:"descripcion"`
	Unidad         string  `json:"unidad"`
	Cantidad       float64 `json:"cantidad"`
	PrecioUnitario float64 `json:"precioUnitario"`
}

// PedidoDeComprobante es el de lib/mostrador/comprobante.ts.
type PedidoDeComprobante struct {
	OrderID        string         `json:"orderId"`
	CustomerID     *string        `json:"customerId"`
	ReceptorNombre string         `json:"receptorNombre"`
	Cuit           *string        `json:"cuit"`
	Lineas         []LineaDeVenta `json:"lineas"`
	UsuarioID      string         `json:"usuarioId"`
}

// ResultadoComprobante es lo que se cuenta en el mostrador.
type ResultadoComprobante struct {
	InvoiceID  *string `json:"invoiceId,omitempty"`
	Aviso      string  `json:"aviso"`
	Autorizado bool    `json:"autorizado"`
}

// LetraQueSaldria es letraQueSaldria: la letra según quién emite y quién
// recibe, para decirla en pantalla antes de cobrar. Alguien sin ficha que da
// un CUIT es inscripto solo si el CUIT es de empresa (30, 33, 34), como en el
// alta de clientes: el TS suponía inscripto a cualquier CUIT, y un
// monotributista o un particular con CUIT 20 se llevaba una A que no le
// corresponde.
func (s *Servicio) LetraQueSaldria(ctx context.Context, customerID, cuitTipeado *string) (letra, receptor string, err error) {
	config, err := s.ObtenerEmisor(ctx)
	if err != nil {
		return "", "", err
	}
	receptor = fiscal.ConsumidorFinal
	if customerID != nil && *customerID != "" {
		var c string
		err := s.pool.QueryRow(ctx, `SELECT condicion_iva::text FROM customers WHERE id = $1`, *customerID).Scan(&c)
		if err == nil {
			receptor = c
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return "", "", err
		}
	} else if cuitTipeado != nil {
		if doc, msj := clientes.LeerDocumento(*cuitTipeado); msj == "" {
			receptor = clientes.SugerirCondicionIva(doc)
		}
	}
	letra, err = letraPara(ctx, s.pool, config.CondicionIva, receptor)
	return letra, receptor, err
}

// EmitirParaLaVenta es emitirParaLaVenta: el comprobante de una venta de
// mostrador, **después** de la venta y nunca adentro. No tira: devuelve qué
// pasó, y la venta queda hecha igual.
func (s *Servicio) EmitirParaLaVenta(ctx context.Context, p PedidoDeComprobante) (ResultadoComprobante, error) {
	// Una venta, un comprobante: un reintento de la cola o un doble envío no
	// emite otro (FacturarPedido ya lo miraba; esta no).
	if p.OrderID != "" {
		var n int64
		err := s.pool.QueryRow(ctx, `SELECT numero FROM invoices WHERE order_id = $1 AND estado <> 'anulada' LIMIT 1`, p.OrderID).Scan(&n)
		if err == nil {
			return ResultadoComprobante{Aviso: "Esa venta ya tiene el comprobante " + jsmath.Texto(float64(n)) + "."}, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return ResultadoComprobante{}, err
		}
	}
	_, receptor, err := s.LetraQueSaldria(ctx, p.CustomerID, p.Cuit)
	if err != nil {
		return ResultadoComprobante{}, err
	}
	var cuit, domicilio *string
	if p.Cuit != nil && (p.CustomerID == nil || *p.CustomerID == "") {
		// Un documento mal tipeado no va a ARCA (lo rechaza, o sale a nombre
		// de otro): la venta queda y el comprobante se emite desde el pedido
		// con el documento corregido.
		doc, msj := clientes.LeerDocumento(*p.Cuit)
		if msj != "" {
			return ResultadoComprobante{Aviso: "La venta quedó registrada, pero el comprobante no se pudo crear: " + msj}, nil
		}
		if doc.Digitos != "" {
			cuit = &doc.Digitos
		}
	} else if p.Cuit != nil {
		if d := fiscal.SoloDigitos(*p.Cuit); d != "" {
			cuit = &d
		}
	}
	nombre := p.ReceptorNombre
	if p.CustomerID != nil && *p.CustomerID != "" {
		var n string
		var razon, c, dir *string
		err := s.pool.QueryRow(ctx, `SELECT nombre, razon_social, cuit, direccion FROM customers WHERE id = $1`, *p.CustomerID).Scan(&n, &razon, &c, &dir)
		if err == nil {
			nombre = n
			if razon != nil && *razon != "" {
				nombre = *razon
			}
			if c != nil {
				if d := fiscal.SoloDigitos(*c); d != "" {
					cuit = &d
				}
			}
			domicilio = dir
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return ResultadoComprobante{}, err
		}
	}
	var pedido *string
	if p.OrderID != "" {
		pedido = &p.OrderID
	}
	// La alícuota de cada renglón sale del pedido (la guardada al vender o
	// la del producto): la venta no la trae, y el TS facturaba todo al 21 %,
	// también lo que es al 10,5 o exento.
	alicuotas, renglones, err := s.alicuotasDeLaVenta(ctx, p.OrderID, p.Lineas)
	if err != nil {
		return ResultadoComprobante{}, err
	}
	lineas := make([]Linea, len(p.Lineas))
	for i, l := range p.Lineas {
		unidad := l.Unidad
		lineas[i] = Linea{LineaEntrada: fiscal.LineaEntrada{Descripcion: l.Descripcion, Unidad: &unidad, Cantidad: l.Cantidad,
			PrecioFinalUnitario: l.PrecioUnitario, Alicuota: alicuotas[i]}, OrderItemID: renglones[i]}
	}
	id, err := s.EmitirComprobante(ctx, DatosEmision{CustomerID: p.CustomerID, OrderID: pedido, ReceptorNombre: nombre, ReceptorCuit: cuit,
		ReceptorCondicionIva: receptor, ReceptorDomicilio: domicilio, CreatedByUserID: &p.UsuarioID, Lineas: lineas})
	if err != nil {
		m := Mensaje(err)
		if m == "" {
			return ResultadoComprobante{}, err
		}
		return ResultadoComprobante{Aviso: "La venta quedó registrada, pero el comprobante no se pudo crear: " + m}, nil
	}
	if _, err := s.AutorizarAlEmitir(ctx, id); err != nil {
		m := Mensaje(err)
		if m == "" {
			m = "error desconocido"
			s.log.Error("autorizando la venta", "invoiceId", id, "error", err)
		}
		// Sin certificado no hubo envío: el mostrador lo dice en una línea y
		// sin la jerga del certificado, que el vendedor no maneja y que antes
		// repetía la misma idea dos veces (mes simulado, H020).
		if m == sinValorFiscal {
			return ResultadoComprobante{InvoiceID: &id, Aviso: AvisoSinARCA}, nil
		}
		return ResultadoComprobante{InvoiceID: &id, Aviso: "Comprobante creado, pero sin autorizar en ARCA: " + m}, nil
	}
	return ResultadoComprobante{InvoiceID: &id, Aviso: "Comprobante autorizado.", Autorizado: true}, nil
}

// alicuotasDeLaVenta busca, para cada renglón de la venta, el del pedido con
// la misma descripción y cantidad (en orden, sin usar uno dos veces) y toma
// su alícuota y su id. nil, el 21 % de siempre, si no hay pedido o no
// aparece. Acá el emparejamiento es seguro: los renglones son los de esa
// misma venta y en su orden; lo que no se hace es buscarlo después, sobre
// una factura vieja (ver DevolucionParcial).
func (s *Servicio) alicuotasDeLaVenta(ctx context.Context, orderID string, lineas []LineaDeVenta) ([]*float64, []*string, error) {
	out := make([]*float64, len(lineas))
	ids := make([]*string, len(lineas))
	if !plataforma.UUIDValido(orderID) {
		return out, ids, nil
	}
	filas, err := s.pool.Query(ctx, `SELECT oi.id, oi.descripcion, oi.cantidad::float8, coalesce(oi.alicuota_iva, pr.alicuota_iva)::float8
		FROM order_items oi LEFT JOIN product_variants v ON v.id = oi.variant_id LEFT JOIN products pr ON pr.id = v.product_id
		WHERE oi.order_id = $1 ORDER BY oi.orden`, orderID)
	if err != nil {
		return nil, nil, err
	}
	defer filas.Close()
	type renglon struct {
		id          string
		descripcion string
		cantidad    float64
		alicuota    *float64
		usado       bool
	}
	var delPedido []renglon
	for filas.Next() {
		var r renglon
		if err := filas.Scan(&r.id, &r.descripcion, &r.cantidad, &r.alicuota); err != nil {
			return nil, nil, err
		}
		delPedido = append(delPedido, r)
	}
	if err := filas.Err(); err != nil {
		return nil, nil, err
	}
	for i, l := range lineas {
		for k := range delPedido {
			r := &delPedido[k]
			if !r.usado && r.descripcion == l.Descripcion && math.Abs(r.cantidad-l.Cantidad) < 1e-9 {
				r.usado = true
				out[i], ids[i] = r.alicuota, &r.id
				break
			}
		}
	}
	return out, ids, nil
}

// faltaCuitParaLaA es el motivo por el que no se puede facturar a un
// responsable inscripto, o "": la factura A informa el CUIT del receptor
// (DocTipo 80), y sin uno válido ARCA la rechaza.
func faltaCuitParaLaA(condicion string, cuit *string) string {
	if condicion != fiscal.ResponsableInscripto && condicion != fiscal.Monotributista {
		return ""
	}
	if cuit == nil || strings.TrimSpace(*cuit) == "" {
		return "Para hacer una factura A hace falta el CUIT del cliente."
	}
	doc, msj := clientes.LeerDocumento(*cuit)
	if msj != "" {
		return msj
	}
	if doc.Tipo != "cuit" {
		return "Para hacer una factura A hace falta el CUIT del cliente, no el DNI."
	}
	return ""
}
