package facturacion

import (
	"context"
	"errors"
	"math"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/clientes"
	"mjbj/internal/cola"
	"mjbj/internal/fiscal"
	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
	"mjbj/internal/sqlc"
)

// TrabajoAvisoDeFactura es el aviso al cliente con el comprobante en PDF
// (lib/notificaciones/fiscal.ts). Lo encola Go en la misma transacción que
// emite (sale solo si se confirmó) y lo atiende el worker
// (internal/notificaciones).
const TrabajoAvisoDeFactura = "factura.aviso"

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
	lineas := make([]Linea, 0, len(datos.Items)+1)
	for _, i := range datos.Items {
		alic := 21.0
		if i.Alicuota != nil && *i.Alicuota != "" {
			alic = jsmath.Numero(*i.Alicuota)
		}
		unidad := i.Unidad
		lineas = append(lineas, Linea{LineaEntrada: fiscal.LineaEntrada{Descripcion: i.Descripcion, Unidad: &unidad,
			Cantidad: jsmath.Numero(i.Cantidad), PrecioFinalUnitario: jsmath.Numero(i.PrecioUnitario), Alicuota: &alic}})
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
		if _, err := tx.Exec(ctx, `SELECT 1 FROM orders WHERE id = $1 FOR UPDATE`, orderID); err != nil {
			return err
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
func (s *Servicio) EmitirManual(ctx context.Context, ses *auth.Sesion, c map[string]string, ls LineasManuales) (string, error) {
	cab, err := validarCabecera(c)
	if err != nil {
		return "", err
	}
	nombre, cuit, condicion, cliente := cab.nombre, cab.cuit, cab.condicion, cab.cliente
	domicilio, obs := cab.domicilio, cab.obs
	guardar := c["guardarComoCliente"] == "on"
	// El documento, con su dígito verificador: un CUIT mal tipeado no va a
	// ARCA. Y una A sin CUIT salía con DocTipo 99 (consumidor final), que
	// ARCA rechaza.
	if strings.TrimSpace(cuit) != "" {
		if _, msj := clientes.LeerDocumento(cuit); msj != "" {
			return "", errEmision(msj)
		}
	}
	if m := faltaCuitParaLaA(condicion, &cuit); m != "" {
		return "", errEmision(m)
	}

	var lineas []Linea
	for i, d := range ls.Descripcion {
		if strings.TrimSpace(d) == "" {
			continue
		}
		desc, cant, precio, alic, ok := validarLinea(texto(d), en(ls.Cantidad, i), en(ls.Precio, i), en(ls.Alicuota, i))
		if !ok {
			return "", errEmision("Revisá la línea " + jsmath.Texto(float64(i+1)) + ": cantidad y precio deben ser mayores a cero.")
		}
		if !fiscal.AlicuotaValida(alic) {
			return "", errEmision("Revisá la línea " + jsmath.Texto(float64(i+1)) + ": " + fiscal.MensajeAlicuota)
		}
		lineas = append(lineas, Linea{LineaEntrada: fiscal.LineaEntrada{Descripcion: desc, Cantidad: cant, PrecioFinalUnitario: precio, Alicuota: ptr(alic)}})
	}
	if len(lineas) == 0 {
		return "", errEmision("Agregá al menos un renglón a la factura.")
	}

	var customerID *string
	if cliente != "" {
		customerID = &cliente
	}
	if customerID == nil && guardar {
		doc, msj := clientes.LeerDocumento(cuit)
		if msj != "" {
			return "", errEmision(msj)
		}
		id, _, existe, err := clientes.PorDocumento(ctx, s.pool, doc)
		if err != nil {
			return "", err
		}
		if !existe {
			if id, err = clientes.CrearRapido(ctx, s.pool, clientes.ClienteNuevo{Nombre: nombre, Documento: doc, CondicionIva: condicion,
				Direccion: domicilio, Notas: ptr("Ficha creada al emitir una factura.")}); err != nil {
				return "", err
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
		if customerID != nil {
			var tipo string
			var pv, n int64
			var total string
			if err := tx.QueryRow(ctx, `SELECT tipo::text, punto_venta, numero, total::text FROM invoices WHERE id = $1`, id).
				Scan(&tipo, &pv, &n, &total); err != nil {
				return err
			}
			et := etiqueta(tipo, pv, n)
			if _, err := tx.Exec(ctx, `INSERT INTO account_movements (customer_id, tipo, monto, detalle, referencia, created_by_user_id)
				VALUES ($1, 'compra', $2::numeric, $3, $3, $4)`, *customerID, jsmath.Fijo2(jsmath.Numero(total)), et, ses.UserID); err != nil {
				return err
			}
		}
		return s.encolarAviso(ctx, tx, id)
	})
	if err != nil {
		return "", s.comoEmision(err, "fiscal.emitir", "No se pudo emitir el comprobante. Intentá de nuevo.")
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCrear, "factura", id, "Emitió un comprobante manual a "+nombre, nil)
	return id, nil
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
	return fiscal.LetraQueCorresponde(config.CondicionIva, receptor), receptor, nil
}

// EmitirParaLaVenta es emitirParaLaVenta: el comprobante de una venta de
// mostrador, **después** de la venta y nunca adentro. No tira: devuelve qué
// pasó, y la venta queda hecha igual.
func (s *Servicio) EmitirParaLaVenta(ctx context.Context, p PedidoDeComprobante) (ResultadoComprobante, error) {
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
	alicuotas, err := s.alicuotasDeLaVenta(ctx, p.OrderID, p.Lineas)
	if err != nil {
		return ResultadoComprobante{}, err
	}
	lineas := make([]Linea, len(p.Lineas))
	for i, l := range p.Lineas {
		unidad := l.Unidad
		lineas[i] = Linea{LineaEntrada: fiscal.LineaEntrada{Descripcion: l.Descripcion, Unidad: &unidad, Cantidad: l.Cantidad,
			PrecioFinalUnitario: l.PrecioUnitario, Alicuota: alicuotas[i]}}
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
	if _, err := s.Autorizar(ctx, id); err != nil {
		m := Mensaje(err)
		if m == "" {
			m = "error desconocido"
			s.log.Error("autorizando la venta", "invoiceId", id, "error", err)
		}
		return ResultadoComprobante{InvoiceID: &id, Aviso: "Comprobante creado, pero sin autorizar en ARCA: " + m}, nil
	}
	return ResultadoComprobante{InvoiceID: &id, Aviso: "Comprobante autorizado.", Autorizado: true}, nil
}

// alicuotasDeLaVenta busca, para cada renglón de la venta, el del pedido con
// la misma descripción y cantidad (en orden, sin usar uno dos veces) y toma
// su alícuota. nil, el 21 % de siempre, si no hay pedido o no aparece.
func (s *Servicio) alicuotasDeLaVenta(ctx context.Context, orderID string, lineas []LineaDeVenta) ([]*float64, error) {
	out := make([]*float64, len(lineas))
	if !plataforma.UUIDValido(orderID) {
		return out, nil
	}
	filas, err := s.pool.Query(ctx, `SELECT oi.descripcion, oi.cantidad::float8, coalesce(oi.alicuota_iva, pr.alicuota_iva)::float8
		FROM order_items oi LEFT JOIN product_variants v ON v.id = oi.variant_id LEFT JOIN products pr ON pr.id = v.product_id
		WHERE oi.order_id = $1 ORDER BY oi.orden`, orderID)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	type renglon struct {
		descripcion string
		cantidad    float64
		alicuota    *float64
		usado       bool
	}
	var delPedido []renglon
	for filas.Next() {
		var r renglon
		if err := filas.Scan(&r.descripcion, &r.cantidad, &r.alicuota); err != nil {
			return nil, err
		}
		delPedido = append(delPedido, r)
	}
	if err := filas.Err(); err != nil {
		return nil, err
	}
	for i, l := range lineas {
		for k := range delPedido {
			r := &delPedido[k]
			if !r.usado && r.descripcion == l.Descripcion && math.Abs(r.cantidad-l.Cantidad) < 1e-9 {
				r.usado = true
				out[i] = r.alicuota
				break
			}
		}
	}
	return out, nil
}

// faltaCuitParaLaA es el motivo por el que no se puede facturar a un
// responsable inscripto, o "": la factura A informa el CUIT del receptor
// (DocTipo 80), y sin uno válido ARCA la rechaza.
func faltaCuitParaLaA(condicion string, cuit *string) string {
	if condicion != fiscal.ResponsableInscripto {
		return ""
	}
	if cuit == nil || strings.TrimSpace(*cuit) == "" {
		return "Para facturarle a un responsable inscripto (factura A) hace falta su CUIT."
	}
	doc, msj := clientes.LeerDocumento(*cuit)
	if msj != "" {
		return msj
	}
	if doc.Tipo != "cuit" {
		return "Para facturarle a un responsable inscripto (factura A) hace falta su CUIT, no el DNI."
	}
	return ""
}
