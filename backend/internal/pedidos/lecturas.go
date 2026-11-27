package pedidos

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/entregas"
	"mjbj/internal/fiscal"
	"mjbj/internal/jsmath"
	"mjbj/internal/precios"
	"mjbj/internal/ventas"
	"mjbj/internal/ventas/fragmentos"
	"mjbj/internal/zodjs"
)

// Las lecturas de lib/dal/admin/ventas.ts, con los mismos nombres de campo.
// Los numeric de las fichas van como texto («1500.00»), como los leía
// drizzle; los totales de los listados, como número.

type argumentos []any

func (a *argumentos) poner(v any) string {
	*a = append(*a, v)
	return fmt.Sprintf("$%d", len(*a))
}

// coincide es coincideBusqueda (lib/busqueda.ts): cada palabra (hasta seis)
// en alguna de las columnas, sin tildes.
func (a *argumentos) coincide(texto string, columnas ...string) string {
	terminos := strings.FieldsFunc(zodjs.TrimJS(texto), zodjs.EspacioJS)
	if len(terminos) > 6 {
		terminos = terminos[:6]
	}
	if len(terminos) == 0 {
		return ""
	}
	var porTermino []string
	for _, t := range terminos {
		p := a.poner("%" + t + "%")
		var col []string
		for _, c := range columnas {
			col = append(col, "f_unaccent("+c+") ILIKE f_unaccent("+p+")")
		}
		porTermino = append(porTermino, "("+strings.Join(col, " OR ")+")")
	}
	return "(" + strings.Join(porTermino, " AND ") + ")"
}

func donde(condiciones []string) string {
	if len(condiciones) == 0 {
		return ""
	}
	return " WHERE " + strings.Join(condiciones, " AND ")
}

// Filtros son los de los dos listados.
type Filtros struct {
	Busqueda, Estado, Sucursal string
}

/* ------------------------------ presupuestos ------------------------------ */

// PresupuestoListado es una tarjeta del listado de presupuestos.
type PresupuestoListado struct {
	ID            string     `json:"id"`
	Numero        string     `json:"numero"`
	Cliente       string     `json:"cliente"`
	Empresa       *string    `json:"empresa"`
	CustomerID    *string    `json:"customerId"`
	Sucursal      *string    `json:"sucursal"`
	Estado        string     `json:"estado"`
	Origen        string     `json:"origen"`
	Total         float64    `json:"total"`
	Items         int        `json:"items"`
	Asesor        *string    `json:"asesor"`
	CreatedAt     time.Time  `json:"createdAt"`
	ValidoHasta   *time.Time `json:"validoHasta"`
	Vencido       bool       `json:"vencido"`
	RespondeHasta *time.Time `json:"respondeHasta"`
	NecesitaPara  *time.Time `json:"necesitaPara"`
	Plazo         *Plazo     `json:"plazo"`
	PedidoID      *string    `json:"pedidoId"`
	NumeroPedido  *string    `json:"numeroPedido"`
}

// PresupuestosPorPagina es el tope de una página de presupuestos.
const PresupuestosPorPagina = 30

// estadosAbiertos son los tres que todavía esperan algo.
var estadosAbiertos = []string{"pendiente", "revision", "enviado"}

// PaginaDePresupuestos es una página del listado con el total del filtro y
// la plata de todos los que pasan el filtro, no solo de los de la página.
type PaginaDePresupuestos struct {
	Filas []PresupuestoListado `json:"filas"`
	Total int                  `json:"total"`
	Monto float64              `json:"monto"`
}

// ListarPresupuestos es listarPresupuestos: primero lo que tiene compromiso
// de respuesta más cerca, después la obra más cerca, después lo más nuevo.
// «abiertos» son los tres estados que todavía esperan algo, y «cerrados»
// todos los demás; los cerrados van por fecha, del más nuevo al más viejo.
//
// De a páginas (tanda T8): los presupuestos se acumulan sin tope y la
// pantalla los traía todos. Sin límite, cualquier filtro trae una página,
// «abiertos» también: venía entero con el argumento de que son pocos por
// naturaleza, y no lo eran —un enviado que el cliente nunca contestó quedaba
// abierto para siempre (ver VencerPresupuestos)—. El monto del encabezado
// sale de la base, de todos. El id desempata, así dos páginas nunca se pisan.
// nombreEnLaLista es cómo se nombra al cliente en la lista: el panel cargaba
// la razón social como contacto al elegir el cliente y el portal el nombre,
// así que unos salían «RF Construcciones SRL» y otros «Roberto Fernández»
// (mes simulado). Si el contacto es la razón social de la ficha, va el
// nombre de la ficha; la razón social sale aparte, como empresa.
const nombreEnLaLista = `CASE WHEN c.id IS NOT NULL AND q.contacto_nombre = c.razon_social AND c.nombre <> ''
		THEN c.nombre ELSE q.contacto_nombre END`

func (s *Servicio) ListarPresupuestos(ctx context.Context, f Filtros, limite, desplazamiento int) (PaginaDePresupuestos, error) {
	out := PaginaDePresupuestos{Filas: []PresupuestoListado{}}
	var a argumentos
	var cond []string
	cerrados := false
	// «Abiertos» suma los aceptados que todavía no tienen pedido (mes
	// simulado: el que el cliente aceptó desde el portal quedaba escondido
	// entre los cerrados, con el único «Pasar a pedido» pendiente).
	sinPedido := "(q.estado = 'aceptado' AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.quote_id = q.id AND o.estado <> 'cancelado'))"
	switch f.Estado {
	case "abiertos":
		cond = append(cond, "(q.estado::text = ANY("+a.poner(estadosAbiertos)+") OR "+sinPedido+")")
	case "cerrados":
		cond = append(cond, "NOT (q.estado::text = ANY("+a.poner(estadosAbiertos)+") OR "+sinPedido+")")
		cerrados = true
	case "sin-pedido":
		// A donde lleva «presupuestos aceptados sin pedido» del inicio: con
		// «aceptado» salían los 27, encabezados por uno que ya tenía pedido
		// (mes simulado, M3S2-020).
		cond = append(cond, sinPedido)
	case "", "todos":
	default:
		cond = append(cond, "q.estado::text = "+a.poner(f.Estado))
		cerrados = !slices.Contains(estadosAbiertos, f.Estado)
	}
	if f.Sucursal != "" && f.Sucursal != "todos" {
		cond = append(cond, "b.slug = "+a.poner(f.Sucursal))
	}
	if f.Busqueda != "" {
		if c := a.coincide(f.Busqueda, "q.numero", "q.contacto_nombre", "c.razon_social"); c != "" {
			cond = append(cond, c)
		}
	}
	desde := `
		FROM quotes q
		LEFT JOIN customers c ON c.id = q.customer_id
		LEFT JOIN branches b ON b.id = q.branch_id` + donde(cond)
	if err := s.pool.QueryRow(ctx, `SELECT count(*)::int, coalesce(sum(q.total), 0)::float8`+desde, a...).Scan(&out.Total, &out.Monto); err != nil {
		return out, err
	}
	switch {
	case limite <= 0:
		limite = PresupuestosPorPagina
	case limite > 200:
		limite = 200
	}
	desplazamiento = max(desplazamiento, 0)
	if out.Total == 0 || desplazamiento >= out.Total {
		return out, nil
	}
	// Los aceptados sin pedido primero: es trabajo que ya está ganado.
	orden := `CASE WHEN q.estado = 'aceptado' THEN 0 ELSE 1 END,
		         CASE WHEN q.responde_hasta IS NULL THEN 1 ELSE 0 END, q.responde_hasta ASC NULLS LAST,
		         q.necesita_para ASC NULLS LAST, q.created_at DESC, q.id DESC`
	if cerrados {
		orden = `q.created_at DESC, q.id DESC`
	}
	// Los renglones y el pedido se cuentan con subconsultas en la lista: se
	// calculan solo para las filas de la página (antes se agrupaba
	// quote_items entero en cada carga).
	filas, err := s.pool.Query(ctx, `
		SELECT q.id, q.numero, `+nombreEnLaLista+`, c.razon_social, q.customer_id, b.name, q.estado::text, q.origen::text,
		       q.total::text, q.asesor, q.created_at, q.valido_hasta, q.responde_hasta, q.necesita_para,
		       (SELECT count(*)::int FROM quote_items qi WHERE qi.quote_id = q.id),
		       (SELECT o.id FROM orders o WHERE o.quote_id = q.id AND o.estado <> 'cancelado' ORDER BY o.created_at LIMIT 1),
		       (SELECT o.numero FROM orders o WHERE o.quote_id = q.id AND o.estado <> 'cancelado' ORDER BY o.created_at LIMIT 1)`+desde+`
		ORDER BY `+orden+`
		LIMIT `+a.poner(limite)+` OFFSET `+a.poner(desplazamiento), a...)
	if err != nil {
		return out, err
	}
	defer filas.Close()
	ahora := s.ahora()
	for filas.Next() {
		var p PresupuestoListado
		var total string
		if err := filas.Scan(&p.ID, &p.Numero, &p.Cliente, &p.Empresa, &p.CustomerID, &p.Sucursal, &p.Estado, &p.Origen, &total,
			&p.Asesor, &p.CreatedAt, &p.ValidoHasta, &p.RespondeHasta, &p.NecesitaPara, &p.Items, &p.PedidoID, &p.NumeroPedido); err != nil {
			return out, err
		}
		p.Total = jsmath.Numero(total)
		p.Vencido = p.ValidoHasta != nil && p.ValidoHasta.UnixMilli() < ahora.UnixMilli() &&
			p.Estado != "aceptado" && p.Estado != "rechazado"
		if p.RespondeHasta != nil && p.Estado == "pendiente" {
			pl := EstadoDelPlazo(*p.RespondeHasta, ahora)
			p.Plazo = &pl
		}
		out.Filas = append(out.Filas, p)
	}
	return out, filas.Err()
}

// ItemDePresupuesto es una línea de la ficha. AlicuotaIva sale del producto
// (para desagregar el IVA en el PDF); las líneas sueltas no tienen.
type ItemDePresupuesto struct {
	ID             string  `json:"id"`
	VariantID      *string `json:"variantId"`
	Descripcion    string  `json:"descripcion"`
	Unidad         string  `json:"unidad"`
	Cantidad       string  `json:"cantidad"`
	PrecioUnitario string  `json:"precioUnitario"`
	Subtotal       string  `json:"subtotal"`
	Orden          int     `json:"orden"`
	AlicuotaIva    *string `json:"alicuotaIva"`
	// BajoCosto: el precio no cubre el costo (precios.BajoCosto). Se marca
	// antes de mandarlo o pasarlo a pedido (mes simulado: el Fenólico a $100
	// con costo de $75.000 salió sin aviso).
	BajoCosto bool `json:"bajoCosto"`
	// Piso es el de precios.PisoDeCosto, para que corregir o duplicar el
	// presupuesto marque el renglón y pida «Guardar igual» como el alta
	// (mes simulado: por ahí se salteaba el aviso). Nil sin costo cargado.
	Piso *float64 `json:"piso"`
	// ConPresentacion: el renglón es una presentación (media placa): su
	// precio no se compara con el costo de la unidad de stock.
	ConPresentacion bool `json:"-"`
	// Disponible es lo que hay para vender (físico menos reservado) en cada
	// sucursal activa, para avisar al pasarlo a pedido (M2S1-089: reservaba
	// 20 sin stock en Casa Central y la dejaba en −20). Vacío en un renglón
	// sin variante, en una presentación o en otra unidad que la del stock.
	Disponible []DisponibleEnSucursal `json:"disponible"`
}

// DisponibleEnSucursal es lo que hay de un renglón en una sucursal.
type DisponibleEnSucursal struct {
	Sucursal   string  `json:"sucursal"`
	Nombre     string  `json:"nombre"`
	Disponible float64 `json:"disponible"`
}

// FichaDePresupuesto es consultarPresupuesto.
type FichaDePresupuesto struct {
	ID                  string              `json:"id"`
	Numero              string              `json:"numero"`
	Cliente             string              `json:"cliente"`
	Email               *string             `json:"email"`
	Telefono            *string             `json:"telefono"`
	Empresa             *string             `json:"empresa"`
	CustomerID          *string             `json:"customerId"`
	ClienteCodigo       *string             `json:"clienteCodigo"`
	ClienteCuit         *string             `json:"clienteCuit"`
	ClienteCondicionIva *string             `json:"clienteCondicionIva"`
	ClienteDireccion    *string             `json:"clienteDireccion"`
	Sucursal            *string             `json:"sucursal"`
	SucursalSlug        *string             `json:"sucursalSlug"`
	Vendedor            *string             `json:"vendedor"`
	Estado              string              `json:"estado"`
	Origen              string              `json:"origen"`
	Subtotal            string              `json:"subtotal"`
	Total               string              `json:"total"`
	Notas               *string             `json:"notas"`
	Asesor              *string             `json:"asesor"`
	ValidoHasta         *time.Time          `json:"validoHasta"`
	CreatedAt           time.Time           `json:"createdAt"`
	Items               []ItemDePresupuesto `json:"items"`
	PedidoID            *string             `json:"pedidoId"`
	NumeroPedido        *string             `json:"numeroPedido"`
	// MotivoRechazo: por qué se perdió (CambiarEstadoPresupuestoConMotivo).
	MotivoRechazo *string `json:"motivoRechazo"`
	// Vencido: pasó su validez y no se convirtió. Para pasarlo a pedido hay
	// que elegir entre los precios de hoy (TotalDeHoy) y los suyos.
	Vencido    bool    `json:"vencido"`
	TotalDeHoy *string `json:"totalDeHoy"`
	// FichaPorCorreo: como en FichaDePedido.
	FichaPorCorreo *FichaParaUnir `json:"fichaPorCorreo"`
	// EmailFicha es el correo de la ficha del cliente: al que sale el
	// presupuesto cuando el suyo no tiene (M2S1-183: decía «Correo —» y
	// que el correo había salido).
	EmailFicha *string `json:"emailFicha"`
	// PedidosCancelados son los pedidos que salieron de este presupuesto y
	// se cancelaron (M3S3-031): sin ellos no se sabía que ya se convirtió.
	PedidosCancelados []RefPedidoCancelado `json:"pedidosCancelados"`
}

// ArmadoEnElPanel: el presupuesto lo cargó alguien del local (mostrador o
// teléfono), no llegó del sitio ni del bot.
func ArmadoEnElPanel(origen string) bool { return origen == "mostrador" || origen == "telefono" }

// RefPedidoCancelado es un pedido cancelado que salió del presupuesto.
type RefPedidoCancelado struct {
	ID     string `json:"id"`
	Numero string `json:"numero"`
}

// Presupuesto es la ficha, o nil si no existe.
func (s *Servicio) Presupuesto(ctx context.Context, id string) (*FichaDePresupuesto, error) {
	var p FichaDePresupuesto
	err := s.pool.QueryRow(ctx, `
		SELECT q.id, q.numero, q.contacto_nombre, q.contacto_email, q.contacto_telefono, c.razon_social, q.customer_id,
		       c.codigo_legacy, c.cuit, c.condicion_iva::text, c.direccion, b.name, b.slug, v.nombre,
		       q.estado::text, q.origen::text, q.subtotal::text, q.total::text, q.notas, q.asesor, q.valido_hasta, q.created_at,
		       (SELECT o.id FROM orders o WHERE o.quote_id = q.id AND o.estado <> 'cancelado' ORDER BY o.created_at LIMIT 1),
		       (SELECT o.numero FROM orders o WHERE o.quote_id = q.id AND o.estado <> 'cancelado' ORDER BY o.created_at LIMIT 1),
		       q.motivo_rechazo, c.email
		FROM quotes q
		LEFT JOIN customers c ON c.id = q.customer_id
		LEFT JOIN branches b ON b.id = q.branch_id
		LEFT JOIN sellers v ON v.id = q.seller_id
		WHERE q.id = $1`, id).Scan(&p.ID, &p.Numero, &p.Cliente, &p.Email, &p.Telefono, &p.Empresa, &p.CustomerID,
		&p.ClienteCodigo, &p.ClienteCuit, &p.ClienteCondicionIva, &p.ClienteDireccion, &p.Sucursal, &p.SucursalSlug, &p.Vendedor,
		&p.Estado, &p.Origen, &p.Subtotal, &p.Total, &p.Notas, &p.Asesor, &p.ValidoHasta, &p.CreatedAt, &p.PedidoID, &p.NumeroPedido,
		&p.MotivoRechazo, &p.EmailFicha)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	filas, err := s.pool.Query(ctx, `
		SELECT i.id, i.variant_id, i.descripcion, i.unidad, i.cantidad::text, i.precio_unitario::text, i.subtotal::text, i.orden,
		       p.alicuota_iva::text, i.presentacion IS NOT NULL
		FROM quote_items i
		LEFT JOIN product_variants v ON v.id = i.variant_id
		LEFT JOIN products p ON p.id = v.product_id
		WHERE i.quote_id = $1
		ORDER BY i.orden, i.id`, id)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	p.Items = []ItemDePresupuesto{}
	for filas.Next() {
		var it ItemDePresupuesto
		if err := filas.Scan(&it.ID, &it.VariantID, &it.Descripcion, &it.Unidad, &it.Cantidad, &it.PrecioUnitario, &it.Subtotal,
			&it.Orden, &it.AlicuotaIva, &it.ConPresentacion); err != nil {
			return nil, err
		}
		p.Items = append(p.Items, it)
	}
	if err := filas.Err(); err != nil {
		return nil, err
	}
	filas.Close()
	var variantes []string
	for _, it := range p.Items {
		if it.VariantID != nil {
			variantes = append(variantes, *it.VariantID)
		}
	}
	pisos, err := precios.PisosDeCosto(ctx, s.pool, variantes)
	if err != nil {
		return nil, err
	}
	for i := range p.Items {
		p.Items[i].Disponible = []DisponibleEnSucursal{}
	}
	disp, err := s.pool.Query(ctx, `
		SELECT i.id, b.slug, b.name, greatest(coalesce(inv.qty, 0) - coalesce(inv.reservado, 0), 0)::float8
		FROM quote_items i
		JOIN product_variants v ON v.id = i.variant_id
		JOIN products pr ON pr.id = v.product_id
		CROSS JOIN branches b
		LEFT JOIN inventory inv ON inv.variant_id = v.id AND inv.branch_id = b.id
		WHERE i.quote_id = $1 AND b.active AND i.presentacion IS NULL AND i.unidad = pr.unit::text AND NOT pr.a_pedido
		ORDER BY b.sort_order, b.name`, id)
	if err != nil {
		return nil, err
	}
	porItem := map[string][]DisponibleEnSucursal{}
	for disp.Next() {
		var item string
		var d DisponibleEnSucursal
		if err := disp.Scan(&item, &d.Sucursal, &d.Nombre, &d.Disponible); err != nil {
			disp.Close()
			return nil, err
		}
		porItem[item] = append(porItem[item], d)
	}
	disp.Close()
	if err := disp.Err(); err != nil {
		return nil, err
	}
	for i := range p.Items {
		if d, ok := porItem[p.Items[i].ID]; ok {
			p.Items[i].Disponible = d
		}
	}
	for i, it := range p.Items {
		if it.VariantID != nil && !p.Items[i].ConPresentacion {
			p.Items[i].BajoCosto = precios.BajoCosto(jsmath.Numero(it.PrecioUnitario), pisos[*it.VariantID])
			if piso, ok := pisos[*it.VariantID]; ok && piso > 0 {
				p.Items[i].Piso = &piso
			}
		}
	}
	p.PedidosCancelados = []RefPedidoCancelado{}
	cancelados, err := s.pool.Query(ctx, `SELECT id, numero FROM orders WHERE quote_id = $1 AND estado = 'cancelado' ORDER BY created_at`, id)
	if err != nil {
		return nil, err
	}
	for cancelados.Next() {
		var r RefPedidoCancelado
		if err := cancelados.Scan(&r.ID, &r.Numero); err != nil {
			cancelados.Close()
			return nil, err
		}
		p.PedidosCancelados = append(p.PedidosCancelados, r)
	}
	cancelados.Close()
	if err := cancelados.Err(); err != nil {
		return nil, err
	}
	if p.CustomerID == nil {
		if p.FichaPorCorreo, err = s.fichaConElCorreo(ctx, p.Email, ArmadoEnElPanel(p.Origen)); err != nil {
			return nil, err
		}
		if p.FichaPorCorreo != nil {
			p.FichaPorCorreo.Unible = true
		}
	}
	p.Vencido = p.PedidoID == nil && PresupuestoVencido(p.Estado, p.ValidoHasta, s.ahora())
	if p.Vencido {
		total, err := s.totalDeHoy(ctx, id, p.CustomerID, jsmath.Numero(p.Total)-jsmath.Numero(p.Subtotal))
		if err != nil {
			return nil, err
		}
		p.TotalDeHoy = &total
	}
	return &p, nil
}

// totalDeHoy es el total del presupuesto con los precios de lista de hoy
// (la misma cuenta que «actualizar» al pasarlo a pedido).
func (s *Servicio) totalDeHoy(ctx context.Context, id string, cliente *string, extra float64) (string, error) {
	filas, err := s.pool.Query(ctx, `SELECT variant_id, presentacion, cantidad::float8, subtotal::float8 FROM quote_items WHERE quote_id = $1 ORDER BY orden, id`, id)
	if err != nil {
		return "", err
	}
	type renglon struct {
		r        precios.RenglonConVariante
		cantidad float64
		subtotal float64
	}
	var rs []renglon
	for filas.Next() {
		var r renglon
		if err := filas.Scan(&r.r.VariantID, &r.r.Presentacion, &r.cantidad, &r.subtotal); err != nil {
			filas.Close()
			return "", err
		}
		rs = append(rs, r)
	}
	filas.Close()
	if err := filas.Err(); err != nil {
		return "", err
	}
	lista, err := precios.ListaDelCliente(ctx, s.pool, cliente)
	if err != nil {
		return "", err
	}
	conVariante := make([]precios.RenglonConVariante, len(rs))
	for i, r := range rs {
		conVariante[i] = r.r
	}
	listas, err := precios.PreciosDeLista(ctx, s.pool, conVariante, lista)
	if err != nil {
		return "", err
	}
	total := 0.0
	for i, r := range rs {
		if listas[i] != nil {
			total += ventas.ACentavos(float64(r.cantidad * *listas[i]))
		} else {
			total += r.subtotal
		}
	}
	return jsmath.Fijo2(ventas.ACentavos(total + extra)), nil
}

/* -------------------------------- pedidos -------------------------------- */

// PedidoListado es una tarjeta del tablero de pedidos.
type PedidoListado struct {
	ID               string    `json:"id"`
	Numero           string    `json:"numero"`
	Cliente          string    `json:"cliente"`
	Empresa          *string   `json:"empresa"`
	Sucursal         *string   `json:"sucursal"`
	SucursalSlug     *string   `json:"sucursalSlug"`
	Estado           string    `json:"estado"`
	TipoEntrega      string    `json:"tipoEntrega"`
	DireccionEntrega *string   `json:"direccionEntrega"`
	ZonaEnvio        *string   `json:"zonaEnvio"`
	MedioPago        *string   `json:"medioPago"`
	EstadoPago       string    `json:"estadoPago"`
	Total            float64   `json:"total"`
	Items            int       `json:"items"`
	CustomerID       *string   `json:"customerId"`
	CreatedAt        time.Time `json:"createdAt"`
	// SinCobrar es lo que falta cobrar fuera de la cuenta corriente
	// (fragmentos.SinCobrarDelPedido): la confirmación al entregar y el
	// «Cobrar $X» del reparto lo leen de acá, con la misma regla que «Me
	// deben».
	SinCobrar *float64 `json:"sinCobrar"`
	// ACuenta: lo que un pedido partido cargó a la cuenta (H047).
	ACuenta *float64 `json:"aCuenta"`
	// PagoEnRevision: el cliente informó una transferencia que nadie
	// verificó (fragmentos.PagoEnRevision). No es «sin cobrar»: el reparto
	// no tiene que pedirle la plata otra vez.
	PagoEnRevision bool `json:"pagoEnRevision"`
	// EntregadoAt es el último paso a «entregado» del historial; nil si no
	// se entregó. «Sin cobrar» cuenta los días desde ahí.
	EntregadoAt *time.Time `json:"entregadoAt"`
	// EntregarEl es el día comprometido (AAAA-MM-DD): el reparto ordena por
	// él (mes simulado: el envío del 28 aparecía último).
	EntregarEl *string `json:"entregarEl"`
	// PorEntregar es lo que falta de un pedido que ya salió en parte (un
	// acopio, el envío en dos viajes); vacío si no salió nada todavía. El
	// reparto y el tablero lo muestran en vez del total.
	PorEntregar []PorEntregar `json:"porEntregar"`
	// CortesSinTerminar: los cortes del pedido en cola o en la máquina. Un
	// pedido así no se marca listo.
	CortesSinTerminar []string `json:"cortesSinTerminar"`
	// Comprobante es con qué salió la venta del mostrador: «interno» o
	// «fiscal» (nulo: anterior a la 00230, o de otro origen).
	Comprobante *string `json:"comprobante"`
	// Facturado: tiene una factura viva.
	Facturado bool `json:"facturado"`
	// Acopio: se retira de a partes (sqlAcopio).
	Acopio bool `json:"acopio"`
	// ALlevar es lo que falta llevar de un envío sin entregar: la tarjeta
	// del reparto decía solo el total, y para saber qué cargar había que
	// entrar al pedido (mes simulado 2). Vacío en un retiro.
	ALlevar []PorEntregar `json:"aLlevar,omitempty"`
	// EnElCamion son los remitos de envío sin firmar, con lo que lleva cada
	// uno: la tarjeta «En camino» mostraba lo que quedó en el galpón.
	EnElCamion []RemitoEnElCamion `json:"enElCamion,omitempty"`
	// FleteACotizar: un envío a una zona «a cotizar» sin flete cargado (se
	// despachaba y se entregaba sin que nadie lo cotizara).
	FleteACotizar bool `json:"fleteACotizar,omitempty"`
}

// RemitoEnElCamion es un remito de envío que salió y no se firmó.
type RemitoEnElCamion struct {
	Numero     string        `json:"numero"`
	FirmaToken string        `json:"firmaToken"`
	Lineas     []PorEntregar `json:"lineas"`
}

// sqlAcopio: el pedido `o` es un acopio en curso, de los que se retiran de
// a partes: ya salió algo con un remito, o es la venta del mostrador «en
// acopio» (que reservó en vez de descontar el stock). En cada visita lo que
// se hace es un remito con lo que se lleva, no «Marcar entregado», que se
// lleva todo lo que queda (mes simulado).
const sqlAcopio = `(o.estado NOT IN ('entregado', 'cancelado') AND o.tipo_entrega = 'retiro' AND (
	EXISTS (SELECT 1 FROM deliveries d WHERE d.order_id = o.id AND d.estado <> 'anulada')
	OR (o.origen = 'mostrador' AND NOT EXISTS (SELECT 1 FROM inventory_movements m WHERE m.note = 'Mostrador ' || o.numero AND m.type = 'venta'))))`

// PorEntregar es un renglón que falta entregar.
type PorEntregar struct {
	Descripcion string  `json:"descripcion"`
	Unidad      string  `json:"unidad"`
	Pendiente   float64 `json:"pendiente"`
}

// completarListado suma lo que falta entregar de los pedidos que salieron
// en parte: son pocos, y el saldo es la misma cuenta de la ficha
// (entregas.SaldoDeAcopio).
func (s *Servicio) completarListado(ctx context.Context, out []PedidoListado, enParte map[string]bool) error {
	if err := s.completarEnvios(ctx, out); err != nil {
		return err
	}
	for i := range out {
		out[i].PorEntregar = []PorEntregar{}
		if !enParte[out[i].ID] {
			continue
		}
		saldo, err := entregas.SaldoDeAcopio(ctx, s.pool, out[i].ID)
		if err != nil {
			return err
		}
		for _, r := range entregas.SoloPendientes(saldo) {
			out[i].PorEntregar = append(out[i].PorEntregar, PorEntregar{Descripcion: r.Descripcion, Unidad: r.Unidad, Pendiente: r.Pendiente})
		}
		// Sin mercadería por retirar no hay remito que preparar: la venta del
		// mostrador que es solo el corte (pasadas sin placa) quedaba como
		// acopio con «Preparar remito» y un formulario vacío.
		if len(out[i].PorEntregar) == 0 {
			out[i].Acopio = false
		}
	}
	return nil
}

// completarEnvios suma a cada envío sin entregar lo que falta llevar, lo
// que va en el camión y si el flete está por cotizar (el reparto).
func (s *Servicio) completarEnvios(ctx context.Context, out []PedidoListado) error {
	var ids []string
	donde := map[string]int{}
	for i, p := range out {
		if p.TipoEntrega == "envio" && p.Estado != "entregado" && p.Estado != "cancelado" {
			ids = append(ids, p.ID)
			donde[p.ID] = i
		}
	}
	if len(ids) == 0 {
		return nil
	}
	for _, id := range ids {
		saldo, err := entregas.SaldoDeAcopio(ctx, s.pool, id)
		if err != nil {
			return err
		}
		i := donde[id]
		out[i].ALlevar = []PorEntregar{}
		for _, r := range entregas.SoloPendientes(saldo) {
			out[i].ALlevar = append(out[i].ALlevar, PorEntregar{Descripcion: r.Descripcion, Unidad: r.Unidad, Pendiente: r.Pendiente})
		}
	}
	filas, err := s.pool.Query(ctx, `
		SELECT d.order_id::text, d.numero, coalesce(d.firma_token, ''), oi.descripcion, oi.unidad, di.cantidad::float8
		FROM deliveries d JOIN delivery_items di ON di.delivery_id = d.id JOIN order_items oi ON oi.id = di.order_item_id
		WHERE d.order_id = ANY($1::uuid[]) AND d.tipo = 'envio' AND d.estado = 'preparada'
		ORDER BY d.created_at, di.orden`, ids)
	if err != nil {
		return err
	}
	for filas.Next() {
		var pedido, numero, token string
		var l PorEntregar
		if err := filas.Scan(&pedido, &numero, &token, &l.Descripcion, &l.Unidad, &l.Pendiente); err != nil {
			filas.Close()
			return err
		}
		i := donde[pedido]
		n := len(out[i].EnElCamion)
		if n == 0 || out[i].EnElCamion[n-1].Numero != numero {
			out[i].EnElCamion = append(out[i].EnElCamion, RemitoEnElCamion{Numero: numero, FirmaToken: token})
			n++
		}
		out[i].EnElCamion[n-1].Lineas = append(out[i].EnElCamion[n-1].Lineas, l)
	}
	filas.Close()
	if err := filas.Err(); err != nil {
		return err
	}
	filas, err = s.pool.Query(ctx, `
		SELECT o.id::text FROM orders o
		WHERE o.id = ANY($1::uuid[]) AND o.costo_envio = 0 AND NOT o.flete_sin_cargo AND (o.zona_envio ~* 'a cotizar'
		  OR EXISTS (SELECT 1 FROM shipping_zones z WHERE z.a_cotizar AND lower(z.nombre) = lower(trim(o.zona_envio))))`, ids)
	if err != nil {
		return err
	}
	for filas.Next() {
		var id string
		if err := filas.Scan(&id); err != nil {
			filas.Close()
			return err
		}
		out[donde[id]].FleteACotizar = true
	}
	filas.Close()
	return filas.Err()
}

// EstadoSinCobrar es el filtro del historial que lleva el renglón «N
// pedidos sin cobrar» de «Me deben»: los que tienen mercadería afuera sin
// cobrar (entregados o con remitos parciales, con la misma regla que la
// tarjeta: fragmentos.SinCobrarDeLoQueSalio), el más viejo primero (el
// primero a reclamar). Solo con los entregados, la tarjeta contaba la obra
// con un remito parcial y la lista no la mostraba.
const EstadoSinCobrar = "sin-cobrar"

// VistaDePedidos acota el listado: el tablero no necesita el historial
// entero (lo traía todo, desde el primer pedido), y el historial va por
// páginas y por período.
type VistaDePedidos struct {
	Vista        string // "", "tablero" o "historial"
	Desde, Hasta string // AAAA-MM-DD, del historial
	Pagina       int
}

// PorPaginaDeHistorial es cuántos pedidos trae cada página del historial.
const PorPaginaDeHistorial = 50

// ListarPedidos es listarPedidos: lo más nuevo primero.
func (s *Servicio) ListarPedidos(ctx context.Context, f Filtros) ([]PedidoListado, error) {
	return s.ListarPedidosEn(ctx, f, VistaDePedidos{})
}

// ListarPedidosEn es ListarPedidos con la vista del tablero o del historial.
func (s *Servicio) ListarPedidosEn(ctx context.Context, f Filtros, v VistaDePedidos) ([]PedidoListado, error) {
	var a argumentos
	var cond []string
	pie := ""
	orden := "o.created_at DESC"
	switch v.Vista {
	case "tablero":
		// El entregado sin cobrar sigue en curso hasta que se cobre: a la
		// semana desaparecía de Pedidos, del mostrador y de la deuda del
		// cliente, y para cobrarlo había que entrar por Clientes (mes
		// simulado, H367).
		cond = append(cond, "(o.estado NOT IN ('entregado', 'cancelado') OR o.updated_at >= now() - interval '7 days' OR (o.estado = 'entregado' AND "+
			fragmentos.SinCobrarDeLoQueSalio+" > 0.009))")
	case "historial":
		if f.Estado == "" || f.Estado == "todos" {
			cond = append(cond, "o.estado IN ('entregado', 'cancelado')")
		}
		if f.Estado == EstadoSinCobrar {
			cond = append(cond, fragmentos.SalioMercaderia, fragmentos.SinCobrarDeLoQueSalio+" > 0.009")
			orden = "o.created_at ASC"
		}
		if v.Desde != "" {
			cond = append(cond, "o.created_at >= ("+a.poner(v.Desde)+"::date AT TIME ZONE 'America/Argentina/Buenos_Aires')")
		}
		if v.Hasta != "" {
			cond = append(cond, "o.created_at < (("+a.poner(v.Hasta)+"::date + 1) AT TIME ZONE 'America/Argentina/Buenos_Aires')")
		}
		pagina := v.Pagina
		if pagina < 1 {
			pagina = 1
		}
		pie = fmt.Sprintf(" LIMIT %d OFFSET %d", PorPaginaDeHistorial+1, (pagina-1)*PorPaginaDeHistorial)
	}
	if f.Estado != "" && f.Estado != "todos" && f.Estado != EstadoSinCobrar {
		cond = append(cond, "o.estado::text = "+a.poner(f.Estado))
	}
	if f.Sucursal != "" && f.Sucursal != "todas" {
		cond = append(cond, "b.slug = "+a.poner(f.Sucursal))
	}
	if f.Busqueda != "" {
		if c := a.coincide(f.Busqueda, "o.numero", "o.contacto_nombre", "o.direccion_entrega", "c.razon_social"); c != "" {
			cond = append(cond, c)
		}
	}
	filas, err := s.pool.Query(ctx, `
		SELECT o.id, o.numero, o.contacto_nombre, c.razon_social, b.name, b.slug, o.estado::text, o.tipo_entrega::text,
		       o.direccion_entrega, o.medio_pago::text, o.estado_pago::text, o.total::text, o.created_at,
		       coalesce(conteo.items, 0), o.customer_id, o.zona_envio, `+fragmentos.SinCobrarDelPedido+`::float8,
		       `+fragmentos.PagoEnRevision+`,
		       CASE WHEN o.estado = 'entregado' THEN (SELECT max(h.created_at) FROM order_status_history h
		                                             WHERE h.order_id = o.id AND h.estado = 'entregado') END,
		       to_char(o.entregar_el, 'YYYY-MM-DD'),
		       o.estado NOT IN ('entregado', 'cancelado') AND EXISTS (SELECT 1 FROM deliveries d WHERE d.order_id = o.id AND d.estado <> 'anulada'),
		       CASE WHEN o.estado NOT IN ('entregado', 'cancelado') THEN (SELECT coalesce(array_agg(co.numero ORDER BY co.numero), '{}')
		            FROM cutting_orders co WHERE co.order_id = o.id AND co.estado IN ('en-cola', 'en-proceso')) ELSE '{}' END,
		       o.comprobante,
		       EXISTS (SELECT 1 FROM invoices f WHERE f.order_id = o.id AND f.estado NOT IN ('anulada', 'borrador') AND f.tipo::text LIKE 'factura%'),
		       `+sqlAcopio+`, o.a_cuenta::float8
		FROM orders o
		LEFT JOIN customers c ON c.id = o.customer_id
		LEFT JOIN branches b ON b.id = o.branch_id
		LEFT JOIN (SELECT order_id, count(*)::int AS items FROM order_items GROUP BY order_id) conteo ON conteo.order_id = o.id`+
		donde(cond)+`
		ORDER BY `+orden+pie, a...)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	out := []PedidoListado{}
	enParte := map[string]bool{}
	for filas.Next() {
		var p PedidoListado
		var total string
		var salioAlgo bool
		if err := filas.Scan(&p.ID, &p.Numero, &p.Cliente, &p.Empresa, &p.Sucursal, &p.SucursalSlug, &p.Estado, &p.TipoEntrega,
			&p.DireccionEntrega, &p.MedioPago, &p.EstadoPago, &total, &p.CreatedAt, &p.Items, &p.CustomerID, &p.ZonaEnvio, &p.SinCobrar,
			&p.PagoEnRevision, &p.EntregadoAt, &p.EntregarEl, &salioAlgo, &p.CortesSinTerminar, &p.Comprobante, &p.Facturado, &p.Acopio, &p.ACuenta); err != nil {
			return nil, err
		}
		p.Total = jsmath.Numero(total)
		if salioAlgo || p.Acopio {
			enParte[p.ID] = true
		}
		out = append(out, p)
	}
	if err := filas.Err(); err != nil {
		return nil, err
	}
	filas.Close()
	return out, s.completarListado(ctx, out, enParte)
}

// ItemDePedido es la fila entera de order_items, como la devolvía drizzle.
type ItemDePedido struct {
	ID             string  `json:"id"`
	OrderID        string  `json:"orderId"`
	VariantID      *string `json:"variantId"`
	Descripcion    string  `json:"descripcion"`
	Unidad         string  `json:"unidad"`
	Cantidad       string  `json:"cantidad"`
	PrecioUnitario string  `json:"precioUnitario"`
	Subtotal       string  `json:"subtotal"`
	Presentacion   *string `json:"presentacion"`
	StockPorUnidad float64 `json:"stockPorUnidad"`
	CostoUnitario  *string `json:"costoUnitario"`
	AlicuotaIva    *string `json:"alicuotaIva"`
	Orden          int     `json:"orden"`
	// Devuelto es lo que volvió de este renglón (mes simulado 2, M2S1-082:
	// la ficha seguía mostrando las 3 placas con una devuelta).
	Devuelto float64 `json:"devuelto"`
}

// DevolucionEnLaFicha es una devolución del pedido, con su nota de crédito
// si la tuvo (M2S1-082, M3S2-049: la ficha no la mostraba y no había cómo
// llegar a la nota).
type DevolucionEnLaFicha struct {
	ID        string    `json:"id"`
	Importe   float64   `json:"importe"`
	Destino   string    `json:"destino"`
	Motivo    string    `json:"motivo"`
	NotaID    *string   `json:"notaId"`
	Nota      *string   `json:"nota"`
	Quien     *string   `json:"quien"`
	CreatedAt time.Time `json:"createdAt"`
}

// ComprobanteDelPedido es una factura o nota del pedido, para quien no entra
// a Facturación (M2S3-027: el vendedor no veía ni el número de la factura).
type ComprobanteDelPedido struct {
	ID       string `json:"id"`
	Etiqueta string `json:"etiqueta"`
	Tipo     string `json:"tipo"`
	Estado   string `json:"estado"`
}

// PasoDelPedido es una fila de order_status_history.
type PasoDelPedido struct {
	ID              string    `json:"id"`
	OrderID         string    `json:"orderId"`
	Estado          string    `json:"estado"`
	Nota            *string   `json:"nota"`
	CreatedByUserID *string   `json:"createdByUserId"`
	Quien           *string   `json:"quien"`
	CreatedAt       time.Time `json:"createdAt"`
}

// PagoDelPedido es cómo se pagó, con lote y cupón.
type PagoDelPedido struct {
	Medio    string  `json:"medio"`
	Importe  string  `json:"importe"`
	NroLote  *string `json:"nroLote"`
	NroCupon *string `json:"nroCupon"`
	Cuotas   int     `json:"cuotas"`
	Tarjeta  *string `json:"tarjeta"`
}

// FichaDePedido es obtenerPedido, más el margen (solo para el admin).
type FichaDePedido struct {
	ID               string          `json:"id"`
	Numero           string          `json:"numero"`
	NumeroProvisorio *string         `json:"numeroProvisorio"`
	Cliente          string          `json:"cliente"`
	Email            *string         `json:"email"`
	Telefono         *string         `json:"telefono"`
	Empresa          *string         `json:"empresa"`
	BranchID         *string         `json:"branchId"`
	CustomerID       *string         `json:"customerId"`
	Sucursal         *string         `json:"sucursal"`
	Estado           string          `json:"estado"`
	Origen           string          `json:"origen"`
	TipoEntrega      string          `json:"tipoEntrega"`
	DireccionEntrega *string         `json:"direccionEntrega"`
	ZonaEnvio        *string         `json:"zonaEnvio"`
	CostoEnvio       string          `json:"costoEnvio"`
	Subtotal         string          `json:"subtotal"`
	Descuento        string          `json:"descuento"`
	DescuentoMotivo  *string         `json:"descuentoMotivo"`
	Total            string          `json:"total"`
	MedioPago        *string         `json:"medioPago"`
	EstadoPago       string          `json:"estadoPago"`
	Notas            *string         `json:"notas"`
	CreatedAt        time.Time       `json:"createdAt"`
	Items            []ItemDePedido  `json:"items"`
	Historial        []PasoDelPedido `json:"historial"`
	Pagos            []PagoDelPedido `json:"pagos"`
	Margen           *Margen         `json:"margen"`
	// El presupuesto del que nació, para ir y volver entre las dos fichas.
	QuoteID           *string `json:"quoteId"`
	NumeroPresupuesto *string `json:"numeroPresupuesto"`
	// Lo que debe el cliente en su cuenta corriente, para cobrarle o no
	// entregarle sin preguntar. Nil si el pedido no tiene cliente.
	SaldoCliente *float64 `json:"saldoCliente"`
	// EntregarEl es el día comprometido (AAAA-MM-DD).
	EntregarEl *string `json:"entregarEl"`
	// SinCobrar: como en PedidoListado.
	SinCobrar *float64 `json:"sinCobrar"`
	// FichaPorCorreo: sin cliente, la ficha con el correo del contacto, para
	// unirlo a mano (unir.go).
	FichaPorCorreo *FichaParaUnir `json:"fichaPorCorreo"`
	// Cobrado es lo cobrado fuera de la caja del mostrador (los recibos y
	// los pagos en línea: fragmentos.CobradoDelPedido); ACobrar, el total
	// menos lo devuelto contra la deuda. Un cobro parcial no se veía: el
	// pedido seguía «Sin cobrar» por el total (mes simulado).
	Cobrado float64 `json:"cobrado"`
	ACobrar float64 `json:"aCobrar"`
	// ACuenta es lo que un pedido partido cargó a la cuenta corriente
	// (H047); el resto es lo de SinCobrar. Nil en los demás.
	ACuenta *float64 `json:"aCuenta"`
	// Recibos son los recibos del pedido, el más viejo primero: van al
	// bloque del cobro y al historial, que no registraba el cobro.
	Recibos []ReciboDelPedido `json:"recibos"`
	// Comprobante: con qué salió la venta del mostrador (ver PedidoListado).
	Comprobante *string `json:"comprobante"`
	// Acopio: se retira de a partes (ver PedidoListado).
	Acopio bool `json:"acopio"`
	// Facturado: tiene una factura viva (no se corrige ni se devuelve desde
	// el pedido: va por la factura).
	Facturado bool `json:"facturado"`
	// EfectivoRecibido: con cuánto pagó en efectivo en el mostrador (00350):
	// el ticket dice el vuelto (mes simulado, M3S1-061).
	EfectivoRecibido *float64 `json:"efectivoRecibido"`
	// FacturaID: la factura viva de la venta, si tiene: el papel que vale es
	// ese y no el ticket (M2S1-083).
	FacturaID *string `json:"facturaId"`
	// FleteSinCargo: el envío se pasó a pedido con «Sin cargo» a propósito.
	FleteSinCargo bool                   `json:"fleteSinCargo"`
	Devoluciones  []DevolucionEnLaFicha  `json:"devoluciones"`
	Comprobantes  []ComprobanteDelPedido `json:"comprobantes"`
}

// ReciboDelPedido es un recibo que cobró el pedido.
type ReciboDelPedido struct {
	ID        string    `json:"id"`
	Numero    string    `json:"numero"`
	Total     float64   `json:"total"`
	Estado    string    `json:"estado"`
	Medios    string    `json:"medios"`
	Quien     *string   `json:"quien"`
	CreatedAt time.Time `json:"createdAt"`
}

// Pedido es la ficha, o nil si no existe. Con `conMargen`, el margen de la
// venta (es de administración: no se le muestra a quien vende).
func (s *Servicio) Pedido(ctx context.Context, id string, conMargen bool) (*FichaDePedido, error) {
	var p FichaDePedido
	err := s.pool.QueryRow(ctx, `
		SELECT o.id, o.numero, o.numero_provisorio, o.contacto_nombre, o.contacto_email, o.contacto_telefono, c.razon_social,
		       o.branch_id, o.customer_id, b.name, o.estado::text, o.origen::text, o.tipo_entrega::text, o.direccion_entrega,
		       o.zona_envio, o.costo_envio::text, o.subtotal::text, o.descuento::text, `+fragmentos.MotivoDelDescuento+`, o.total::text,
		       o.medio_pago::text, o.estado_pago::text, o.notas, o.created_at, o.quote_id, q.numero,
		       CASE WHEN o.customer_id IS NULL THEN NULL
		            ELSE (SELECT coalesce(sum(monto), 0)::float8 FROM account_movements WHERE customer_id = o.customer_id) END,
		       to_char(o.entregar_el, 'YYYY-MM-DD'), `+fragmentos.SinCobrarDelPedido+`::float8,
		       `+fragmentos.CobradoDelPedido+`::float8, `+fragmentos.ACobrarDelPedido+`::float8, o.comprobante, `+sqlAcopio+`,
		       EXISTS (SELECT 1 FROM invoices f WHERE f.order_id = o.id AND f.estado NOT IN ('anulada', 'borrador') AND f.tipo::text LIKE 'factura%'),
		       o.a_cuenta::float8, o.efectivo_recibido::float8,
		       (SELECT f.id::text FROM invoices f WHERE f.order_id = o.id AND f.estado NOT IN ('anulada', 'borrador') AND f.tipo::text LIKE 'factura%'
		        ORDER BY f.created_at LIMIT 1), o.flete_sin_cargo
		FROM orders o
		LEFT JOIN customers c ON c.id = o.customer_id
		LEFT JOIN branches b ON b.id = o.branch_id
		LEFT JOIN quotes q ON q.id = o.quote_id
		WHERE o.id = $1`, id).Scan(&p.ID, &p.Numero, &p.NumeroProvisorio, &p.Cliente, &p.Email, &p.Telefono, &p.Empresa,
		&p.BranchID, &p.CustomerID, &p.Sucursal, &p.Estado, &p.Origen, &p.TipoEntrega, &p.DireccionEntrega,
		&p.ZonaEnvio, &p.CostoEnvio, &p.Subtotal, &p.Descuento, &p.DescuentoMotivo, &p.Total,
		&p.MedioPago, &p.EstadoPago, &p.Notas, &p.CreatedAt, &p.QuoteID, &p.NumeroPresupuesto, &p.SaldoCliente, &p.EntregarEl, &p.SinCobrar,
		&p.Cobrado, &p.ACobrar, &p.Comprobante, &p.Acopio, &p.Facturado, &p.ACuenta, &p.EfectivoRecibido, &p.FacturaID, &p.FleteSinCargo)

	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if p.CustomerID == nil {
		if p.FichaPorCorreo, err = s.fichaConElCorreo(ctx, p.Email); err != nil {
			return nil, err
		}
		if p.FichaPorCorreo != nil {
			hay, err := pedidoConPapeles(ctx, s.pool, id)
			if err != nil {
				return nil, err
			}
			p.FichaPorCorreo.Unible = !hay
		}
	}

	filas, err := s.pool.Query(ctx, `
		SELECT id, order_id, variant_id, descripcion, unidad, cantidad::text, precio_unitario::text, subtotal::text,
		       presentacion, stock_por_unidad::text, costo_unitario::text, alicuota_iva::text, orden
		FROM order_items WHERE order_id = $1 ORDER BY orden, id`, id)
	if err != nil {
		return nil, err
	}
	p.Items = []ItemDePedido{}
	for filas.Next() {
		var it ItemDePedido
		var factor string
		if err := filas.Scan(&it.ID, &it.OrderID, &it.VariantID, &it.Descripcion, &it.Unidad, &it.Cantidad, &it.PrecioUnitario,
			&it.Subtotal, &it.Presentacion, &factor, &it.CostoUnitario, &it.AlicuotaIva, &it.Orden); err != nil {
			filas.Close()
			return nil, err
		}
		it.StockPorUnidad = jsmath.Numero(factor)
		p.Items = append(p.Items, it)
	}
	filas.Close()
	if err := filas.Err(); err != nil {
		return nil, err
	}

	filas, err = s.pool.Query(ctx, `
		SELECT h.id, h.order_id, h.estado::text, h.nota, h.created_by_user_id, u.name, h.created_at
		FROM order_status_history h
		LEFT JOIN "user" u ON u.id = h.created_by_user_id
		WHERE h.order_id = $1 ORDER BY h.created_at DESC, h.id`, id)
	if err != nil {
		return nil, err
	}
	p.Historial = []PasoDelPedido{}
	for filas.Next() {
		var h PasoDelPedido
		if err := filas.Scan(&h.ID, &h.OrderID, &h.Estado, &h.Nota, &h.CreatedByUserID, &h.Quien, &h.CreatedAt); err != nil {
			filas.Close()
			return nil, err
		}
		p.Historial = append(p.Historial, h)
	}
	filas.Close()
	if err := filas.Err(); err != nil {
		return nil, err
	}

	// Vacío en las ventas anteriores a order_payments: ahí medioPago cuenta
	// la historia entera.
	filas, err = s.pool.Query(ctx, `
		SELECT medio::text, importe::text, nro_lote, nro_cupon, cuotas, tarjeta
		FROM order_payments WHERE order_id = $1 ORDER BY created_at, id`, id)
	if err != nil {
		return nil, err
	}
	p.Pagos = []PagoDelPedido{}
	for filas.Next() {
		var x PagoDelPedido
		if err := filas.Scan(&x.Medio, &x.Importe, &x.NroLote, &x.NroCupon, &x.Cuotas, &x.Tarjeta); err != nil {
			filas.Close()
			return nil, err
		}
		p.Pagos = append(p.Pagos, x)
	}
	filas.Close()
	if err := filas.Err(); err != nil {
		return nil, err
	}

	filas, err = s.pool.Query(ctx, `
		SELECT r.id::text, r.numero, r.total::float8, r.estado::text,
		       coalesce((SELECT string_agg(DISTINCT rp.medio::text, ',') FROM receipt_parts rp WHERE rp.receipt_id = r.id), ''),
		       u.name, r.created_at
		FROM receipts r LEFT JOIN "user" u ON u.id = r.created_by_user_id
		WHERE r.id IN `+fragmentos.RecibosDelPedido("$1::uuid")+`
		ORDER BY r.created_at, r.numero`, id)
	if err != nil {
		return nil, err
	}
	p.Recibos = []ReciboDelPedido{}
	for filas.Next() {
		var r ReciboDelPedido
		if err := filas.Scan(&r.ID, &r.Numero, &r.Total, &r.Estado, &r.Medios, &r.Quien, &r.CreatedAt); err != nil {
			filas.Close()
			return nil, err
		}
		p.Recibos = append(p.Recibos, r)
	}
	filas.Close()
	if err := filas.Err(); err != nil {
		return nil, err
	}

	filas, err = s.pool.Query(ctx, `
		SELECT d.id::text, d.importe::float8, d.destino, d.motivo, n.id::text, n.tipo::text, n.punto_venta::int8, n.numero::int8,
		       u.name, d.created_at
		FROM devoluciones d LEFT JOIN invoices n ON n.id = d.nota_id LEFT JOIN "user" u ON u.id = d.created_by_user_id
		WHERE d.order_id = $1 ORDER BY d.created_at, d.id`, id)
	if err != nil {
		return nil, err
	}
	p.Devoluciones = []DevolucionEnLaFicha{}
	for filas.Next() {
		var d DevolucionEnLaFicha
		var tipo *string
		var pv, n *int64
		if err := filas.Scan(&d.ID, &d.Importe, &d.Destino, &d.Motivo, &d.NotaID, &tipo, &pv, &n, &d.Quien, &d.CreatedAt); err != nil {
			filas.Close()
			return nil, err
		}
		if tipo != nil && pv != nil && n != nil {
			x := fiscal.NombreComprobante(*tipo) + " " + fiscal.NumeroFormateado(*pv, *n)
			d.Nota = &x
		}
		p.Devoluciones = append(p.Devoluciones, d)
	}
	filas.Close()
	if err := filas.Err(); err != nil {
		return nil, err
	}

	filas, err = s.pool.Query(ctx, `
		SELECT id::text, tipo::text, punto_venta, numero, estado::text FROM invoices
		WHERE order_id = $1 AND estado <> 'borrador' ORDER BY created_at, id`, id)
	if err != nil {
		return nil, err
	}
	p.Comprobantes = []ComprobanteDelPedido{}
	for filas.Next() {
		var c ComprobanteDelPedido
		var pv, n int64
		if err := filas.Scan(&c.ID, &c.Tipo, &pv, &n, &c.Estado); err != nil {
			filas.Close()
			return nil, err
		}
		c.Etiqueta = fiscal.NombreComprobante(c.Tipo) + " " + fiscal.NumeroFormateado(pv, n)
		p.Comprobantes = append(p.Comprobantes, c)
	}
	filas.Close()
	if err := filas.Err(); err != nil {
		return nil, err
	}

	{
		devueltos := map[string]float64{}
		filas, err = s.pool.Query(ctx, `
			SELECT di.order_item_id::text, sum(di.cantidad)::float8
			FROM devolucion_items di JOIN devoluciones d ON d.id = di.devolucion_id
			WHERE d.order_id = $1 AND di.order_item_id IS NOT NULL GROUP BY di.order_item_id`, id)
		if err != nil {
			return nil, err
		}
		for filas.Next() {
			var item string
			var c float64
			if err := filas.Scan(&item, &c); err != nil {
				filas.Close()
				return nil, err
			}
			devueltos[item] = c
		}
		filas.Close()
		if err := filas.Err(); err != nil {
			return nil, err
		}
		for i := range p.Items {
			p.Items[i].Devuelto = devueltos[p.Items[i].ID]
		}
	}

	if conMargen {
		type devuelto struct{ cantidad, importe float64 }
		devueltos := map[string]devuelto{}
		filas, err = s.pool.Query(ctx, `
			SELECT di.order_item_id::text, sum(di.cantidad)::float8, sum(di.importe)::float8
			FROM devolucion_items di JOIN devoluciones d ON d.id = di.devolucion_id
			WHERE d.order_id = $1 AND di.order_item_id IS NOT NULL GROUP BY di.order_item_id`, id)
		if err != nil {
			return nil, err
		}
		for filas.Next() {
			var item string
			var x devuelto
			if err := filas.Scan(&item, &x.cantidad, &x.importe); err != nil {
				filas.Close()
				return nil, err
			}
			devueltos[item] = x
		}
		filas.Close()
		if err := filas.Err(); err != nil {
			return nil, err
		}
		lineas := make([]LineaConCosto, len(p.Items))
		for i, it := range p.Items {
			d := devueltos[it.ID]
			lineas[i] = LineaConCosto{Subtotal: it.Subtotal, Cantidad: it.Cantidad, AlicuotaIva: it.AlicuotaIva, CostoUnitario: it.CostoUnitario,
				DevueltoCantidad: d.cantidad, DevueltoImporte: d.importe}
		}
		p.Margen = MargenDelPedido(lineas)
	}
	return &p, nil
}

// PedidoParaElTaller es la ficha del aserradero (T3, hallazgo 40): lo que se
// corta y para quién. La ficha completa le mostraba los precios, el saldo de
// la cuenta, el mail y el teléfono del cliente.
type PedidoParaElTaller struct {
	ID          string          `json:"id"`
	Numero      string          `json:"numero"`
	Cliente     string          `json:"cliente"`
	Empresa     *string         `json:"empresa"`
	CustomerID  *string         `json:"customerId"`
	BranchID    *string         `json:"branchId"`
	Sucursal    *string         `json:"sucursal"`
	Estado      string          `json:"estado"`
	TipoEntrega string          `json:"tipoEntrega"`
	EntregarEl  *string         `json:"entregarEl"`
	Notas       *string         `json:"notas"`
	Items       []ItemDelTaller `json:"items"`
}

// ItemDelTaller es un renglón sin precio. La medida y el color de la placa
// son para que «Mandar a cortar» arranque con la placa que el pedido vende
// (mes simulado, H188: arrancaba con una medida supuesta).
type ItemDelTaller struct {
	VariantID    *string `json:"variantId"`
	Descripcion  string  `json:"descripcion"`
	Unidad       string  `json:"unidad"`
	Cantidad     string  `json:"cantidad"`
	Presentacion *string `json:"presentacion"`
	LargoMm      *int32  `json:"largoMm"`
	AnchoMm      *int32  `json:"anchoMm"`
	Color        *string `json:"color"`
}

// ParaElTaller lee esa ficha, o nil si el pedido no existe.
func (s *Servicio) ParaElTaller(ctx context.Context, id string) (*PedidoParaElTaller, error) {
	var p PedidoParaElTaller
	err := s.pool.QueryRow(ctx, `
		SELECT o.id, o.numero, o.contacto_nombre, c.razon_social, o.customer_id, o.branch_id, b.name, o.estado::text,
		       o.tipo_entrega::text, to_char(o.entregar_el, 'YYYY-MM-DD'), o.notas
		FROM orders o
		LEFT JOIN customers c ON c.id = o.customer_id
		LEFT JOIN branches b ON b.id = o.branch_id
		WHERE o.id = $1`, id).Scan(&p.ID, &p.Numero, &p.Cliente, &p.Empresa, &p.CustomerID, &p.BranchID, &p.Sucursal,
		&p.Estado, &p.TipoEntrega, &p.EntregarEl, &p.Notas)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	filas, err := s.pool.Query(ctx, `
		SELECT oi.variant_id, oi.descripcion, oi.unidad, oi.cantidad::text, oi.presentacion, pv.largo_mm, pv.ancho_mm, pv.color
		FROM order_items oi LEFT JOIN product_variants pv ON pv.id = oi.variant_id
		WHERE oi.order_id = $1 ORDER BY oi.orden, oi.id`, id)
	if err != nil {
		return nil, err
	}
	p.Items, err = pgx.CollectRows(filas, func(r pgx.CollectableRow) (ItemDelTaller, error) {
		var it ItemDelTaller
		err := r.Scan(&it.VariantID, &it.Descripcion, &it.Unidad, &it.Cantidad, &it.Presentacion, &it.LargoMm, &it.AnchoMm, &it.Color)
		return it, err
	})
	if p.Items == nil {
		p.Items = []ItemDelTaller{}
	}
	return &p, err
}
