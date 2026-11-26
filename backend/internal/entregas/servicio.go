// Package entregas son las entregas y el acopio: el saldo de lo que queda
// por retirar de un pedido, los remitos (preparar, anular, el de constancia
// del mostrador), la firma con el dedo del que retira, el remito completo
// para imprimir y en PDF, y las zonas de envío del panel. Era lib/entregas,
// lib/dal/admin/entregas.ts, app/admin/pedidos/entregas-actions.ts,
// app/firmar/[token]/actions.ts y app/admin/envios.
//
// En una maderera el pedido rara vez se lleva de una sola vez: la mercadería
// queda en acopio y el cliente retira a medida que avanza la obra. Por eso
// «entregado» no es un estado guardado sino una cuenta: lo pedido menos lo
// que ya salió con remitos no anulados.
//
// Los candados: un remito toma el de la serie (918273645, el del TS) **antes
// de leer el saldo**, y bloquea la fila del pedido; la salida del depósito
// toma el del stock de cada variante (internal/reservas). El TS leía el saldo
// fuera de la transacción: veinte retiros a la vez del mismo pedido sacaban
// veinte veces lo mismo.
package entregas

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/auth"
	"mjbj/internal/autorizacion"
	"mjbj/internal/bitacora"
	"mjbj/internal/cola"
	"mjbj/internal/jsmath"
	"mjbj/internal/numeracion"
	"mjbj/internal/plataforma"
	"mjbj/internal/productos"
	"mjbj/internal/reservas"
	"mjbj/internal/sqlc"
	"mjbj/internal/ventas"
	"mjbj/internal/zodjs"
)

// Los avisos al cliente que dejan el remito preparado y el firmado, en la
// misma transacción (los manda el worker, internal/notificaciones).
const (
	TrabajoRemitoParaFirmar = "remito.para-firmar"
	TrabajoRemitoFirmado    = "remito.firmado"
)

// Servicio son las entregas.
type Servicio struct {
	pool *pgxpool.Pool
	q    *sqlc.Queries
	log  *slog.Logger
	// aut firma la anulación de un remito ya firmado (el PIN de un admin).
	// Sin él, la anula solo una sesión de administrador.
	aut *autorizacion.Servicio
}

// Nuevo arma el servicio.
func Nuevo(pool *pgxpool.Pool, log *slog.Logger) *Servicio {
	return &Servicio{pool: pool, q: sqlc.New(pool), log: log}
}

// ConAutorizacion suma el PIN de los administradores.
func (s *Servicio) ConAutorizacion(aut *autorizacion.Servicio) *Servicio {
	s.aut = aut
	return s
}

// Anulacion es lo que acompaña la anulación de un remito firmado: por qué,
// y el PIN de un admin (o la ficha que devolvió uno anterior).
type Anulacion struct {
	Motivo, PIN, Ficha string
}

// MsjMotivoDeAnulacion es el 422 de un remito firmado que se anula sin decir
// por qué.
const MsjMotivoDeAnulacion = "Escribí por qué se anula: el cliente ya firmó que se lo llevó."

// autorizarAnulacion: un remito firmado es la constancia de que la
// mercadería salió; anularlo la devuelve al stock. Pide motivo y la firma de
// un admin.
func (s *Servicio) autorizarAnulacion(ctx context.Context, ses *auth.Sesion, id string, a Anulacion) (string, error) {
	if zodjs.TrimJS(a.Motivo) == "" {
		return "", plataforma.Invalido(map[string]string{"motivo": MsjMotivoDeAnulacion})
	}
	if s.aut == nil {
		if ses.Tiene(sqlc.StaffRoleAdmin) {
			return ses.Nombre, nil
		}
		return "", plataforma.NuevoProblema(http.StatusForbidden, "Un remito firmado lo anula un administrador.")
	}
	firma, err := s.aut.Exigir(ctx, ses, autorizacion.Pedido{Motivo: autorizacion.Remito, Clave: id, PIN: a.PIN, Ficha: a.Ficha})
	var falta *autorizacion.Falta
	if errors.As(err, &falta) {
		e := map[string]string{"pin": falta.Mensaje(), "pinMonto": "0"}
		if falta.PinIncorrecto {
			e["pinIncorrecto"] = "si"
		}
		if falta.BloqueadoHasta != nil {
			e["pinHasta"] = falta.BloqueadoHasta.UTC().Format(time.RFC3339)
		}
		return "", plataforma.Invalido(e)
	}
	if err != nil {
		return "", err
	}
	return firma.Nombre, nil
}

// consultor es lo que tienen en común el pool y una transacción.
type consultor interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}

// ErrorDeEntrega es el mensaje para mostrar tal cual (el ErrorDeEntrega del
// TS): un 422.
func ErrorDeEntrega(m string) error {
	return plataforma.NuevoProblema(http.StatusUnprocessableEntity, m)
}

// ErrNoEsta: el remito o el pedido no existen.
var ErrNoEsta = errors.New("no está")

/* ------------------------------ saldos ------------------------------ */

// Lo pedido es lo que queda después de las devoluciones parciales: lo que
// se devolvió del acopio ya no se entrega (la devolución bajó su reserva).
// Lo que el cliente trajo de lo que ya se había llevado no cambia lo que le
// queda por retirar: antes se restaba todo lo devuelto, y el que traía 2
// placas perdía 2 de las que tenía apartadas.
const consultaSaldo = `
	SELECT oi.id, oi.descripcion, oi.unidad, greatest(oi.cantidad - coalesce((
	    SELECT sum(di.del_acopio) FROM devolucion_items di
	    JOIN devoluciones dv ON dv.id = di.devolucion_id
	    WHERE di.order_item_id = oi.id %[2]s
	  ), 0), 0)::text,
	  coalesce((
	    SELECT sum(di.cantidad) FROM delivery_items di
	    JOIN deliveries d ON d.id = di.delivery_id
	    WHERE di.order_item_id = oi.id %[1]s
	  ), 0)::text,
	  coalesce(p.unit::text, '')
	FROM order_items oi
	LEFT JOIN product_variants pv ON pv.id = oi.variant_id
	LEFT JOIN products p ON p.id = pv.product_id
	WHERE oi.order_id = $1 %[3]s ORDER BY oi.orden`

// vivas: lo entregado son los remitos sin anular.
const vivas = `AND d.estado <> 'anulada'`

// sinServicios saca del acopio lo que no es mercadería: las pasadas y el
// tapacanto de un corte (sin producto, del_corte). Se retiran las piezas,
// que salen de la placa; el remito listaba «Corte a medida · 9 piezas | 12
// cortes» como un renglón por retirar (mes simulado).
//
// Tampoco los servicios que llegan de un presupuesto, que no tienen corte
// atado (mes simulado: «Corte de Placas (pasadas) 12 u.», «Canto 8 ml» y
// «Armado de cajonera» figuraban «por retirar» como la mercadería): las
// pasadas, el canto en metros y los renglones a mano que dicen un trabajo
// (armado, colocación, flete…). Un renglón a mano sin esas palabras sigue
// siendo mercadería, como una escalera a medida.
const sinServicios = `AND NOT (oi.variant_id IS NULL AND (oi.del_corte
	OR oi.unidad = 'pasada'
	OR (oi.unidad IN ('m', 'metro_lineal') AND oi.descripcion ~* '^(tapa)?canto')
	OR oi.descripcion ~* '^(armado|colocaci[oó]n|instalaci[oó]n|flete|env[ií]o|mano de obra|corte|pegado)( |$)'))`

func leerSaldo(ctx context.Context, db consultor, consulta string, args ...any) ([]Renglon, error) {
	filas, err := db.Query(ctx, consulta, args...)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	out := []Renglon{}
	for filas.Next() {
		var id, desc, unidad, pedido, entregado, delProducto string
		if err := filas.Scan(&id, &desc, &unidad, &pedido, &entregado, &delProducto); err != nil {
			return nil, err
		}
		r := NuevoRenglon(id, desc, unidad, pedido, entregado)
		r.Enteros = delProducto != "" && !productos.AdmiteDecimales(delProducto)
		out = append(out, r)
	}
	return out, filas.Err()
}

// SaldoDeAcopio es qué queda por entregar de un pedido, renglón por renglón.
func SaldoDeAcopio(ctx context.Context, db consultor, pedido string) ([]Renglon, error) {
	if !plataforma.UUIDValido(pedido) {
		return []Renglon{}, nil
	}
	return leerSaldo(ctx, db, sprintf(consultaSaldo, vivas, "", sinServicios), pedido)
}

// SaldoConServicios es SaldoDeAcopio con las líneas de servicio del corte:
// la devolución las cuenta como pendientes mientras el pedido no salió.
func SaldoConServicios(ctx context.Context, db consultor, pedido string) ([]Renglon, error) {
	if !plataforma.UUIDValido(pedido) {
		return []Renglon{}, nil
	}
	return leerSaldo(ctx, db, sprintf(consultaSaldo, vivas, "", ""), pedido)
}

// ConGalpon le suma a cada renglón con producto lo que hay en el galpón de
// la sucursal de donde sale: la de su reserva, o la del pedido.
func ConGalpon(ctx context.Context, db consultor, pedido string, renglones []Renglon) ([]Renglon, error) {
	if len(renglones) == 0 || !plataforma.UUIDValido(pedido) {
		return renglones, nil
	}
	filas, err := db.Query(ctx, `
		WITH r AS (
		  SELECT oi.id, oi.variant_id, oi.stock_por_unidad AS factor,
		    coalesce((SELECT sr.branch_id FROM stock_reservations sr WHERE sr.order_item_id = oi.id AND sr.estado = 'activa'
		              ORDER BY sr.created_at LIMIT 1), o.branch_id) AS sucursal
		  FROM order_items oi JOIN orders o ON o.id = oi.order_id
		  WHERE oi.order_id = $1 AND oi.variant_id IS NOT NULL
		)
		SELECT r.id, r.factor::float8,
		  (coalesce((SELECT i.qty FROM inventory i WHERE i.variant_id = r.variant_id AND i.branch_id = r.sucursal), 0)
		   - coalesce((SELECT sum(sr.cantidad) FROM stock_reservations sr JOIN orders o ON o.id = sr.order_id
		               WHERE sr.estado = 'activa' AND o.estado = 'en-camino' AND sr.variant_id = r.variant_id AND sr.branch_id = r.sucursal
		                 AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.order_id = o.id AND d.tipo = 'envio' AND d.estado <> 'anulada')), 0))::float8
		FROM r WHERE r.sucursal IS NOT NULL`, pedido)
	if err != nil {
		return nil, err
	}
	galpon := map[string]float64{}
	var id string
	var factor, n float64
	if _, err := pgx.ForEachRow(filas, []any{&id, &factor, &n}, func() error {
		if factor > 0 {
			n = n / factor
		}
		galpon[id] = jsmath.Round(n*1000) / 1000
		return nil
	}); err != nil {
		return nil, err
	}
	for i := range renglones {
		if g, ok := galpon[renglones[i].OrderItemID]; ok {
			renglones[i].EnElGalpon = &g
		}
	}
	return renglones, nil
}

// SaldoAlRemito es qué quedaba en acopio **cuando se hizo ese remito**: se
// cuentan las entregas hasta esa, inclusive. Un remito reimpreso dice lo
// mismo que el día que se firmó. Anulado no cambia: él mismo cuenta, y los
// anteriores anulados después también (al hacerlo estaban vivos). Sin eso,
// un remito que se llevó todo pasaba a decir «Entrega parcial» al anularlo
// (mes simulado, REM-0017).
//
// El papel queda fijo al firmarse (o al anularse sin firma). Mientras nadie
// lo firmó, un remito anterior anulado ya no cuenta: el envío REM-0011, que
// iba en el camión, seguía diciendo «Entrega total» después de anular el
// REM-0010 que se había llevado 20 placas, y eso firmaba quien recibía
// (tercera prueba del mes simulado).
func SaldoAlRemito(ctx context.Context, db consultor, pedido, remito string) ([]Renglon, error) {
	rs, err := leerSaldo(ctx, db, sprintf(consultaSaldo,
		`AND (d.estado <> 'anulada' OR d.id = $2 OR d.updated_at > (
		       SELECT coalesce(firmado_at, CASE WHEN estado = 'anulada' THEN updated_at END, 'infinity')
		       FROM deliveries WHERE id = $2))
		 AND d.created_at <= (SELECT created_at FROM deliveries WHERE id = $2)`,
		`AND dv.created_at <= (SELECT created_at FROM deliveries WHERE id = $2)`, sinServicios), pedido, remito)
	if err != nil {
		return nil, err
	}
	return SoloPendientes(rs), nil
}

/* ------------------------------ remitos ----------------------------- */

// EntregaCreada es lo que devuelve un remito nuevo.
type EntregaCreada struct {
	ID             string `json:"id"`
	Numero         string `json:"numero"`
	FirmaToken     string `json:"firmaToken"`
	PedidoCompleto bool   `json:"pedidoCompleto"`
	// Visita son los remitos de los otros pedidos que salieron en la misma
	// visita (se firman con el enlace de este).
	Visita []EntregaCreada `json:"visita,omitempty"`
}

// tokenDeFirma son 24 bytes al azar en base64url (randomBytes(24)).
func tokenDeFirma() string {
	var b [24]byte
	_, _ = rand.Read(b[:])
	return base64.RawURLEncoding.EncodeToString(b[:])
}

type pedidoDelRemito struct {
	sucursal, cliente *string
	estado            string
	tipoEntrega       string
}

// pedidoBloqueado lee el pedido y bloquea su fila (nadie lo cancela ni lo
// cierra mientras sale mercadería).
func pedidoBloqueado(ctx context.Context, tx pgx.Tx, id string) (*pedidoDelRemito, error) {
	if !plataforma.UUIDValido(id) {
		return nil, nil
	}
	var p pedidoDelRemito
	err := tx.QueryRow(ctx, `SELECT branch_id, estado::text, customer_id::text, tipo_entrega::text FROM orders WHERE id = $1 FOR UPDATE`, id).
		Scan(&p.sucursal, &p.estado, &p.cliente, &p.tipoEntrega)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &p, err
}

func textoONulo(p *string) any {
	if p == nil {
		return nil
	}
	return *p
}

// insertarRemito escribe el remito y sus líneas (cantidad con toFixed(2)).
// La fecha es la del reloj (clock_timestamp) y no la del comienzo de la
// transacción: con el candado de la serie, un remito que esperó tiene que
// quedar después del que lo hizo esperar, o saldoAlRemito los cuenta al
// revés.
func insertarRemito(ctx context.Context, tx pgx.Tx, numero, pedido string, sucursal *string, tipo, estado string,
	nombre, documento, notas *string, token string, usuario *string, lineas []LineaAEntregar) (string, error) {
	var id string
	if err := tx.QueryRow(ctx, `
		INSERT INTO deliveries (numero, order_id, branch_id, tipo, estado, receptor_nombre, receptor_documento, notas,
		  firma_token, created_by_user_id, created_at, updated_at)
		VALUES ($1, $2, $3, $4::tipo_entrega_remito, $5::estado_entrega, $6, $7, $8, $9, $10, clock_timestamp(), clock_timestamp())
		RETURNING id`, numero, pedido, sucursal, tipo, estado, textoONulo(nombre), textoONulo(documento), textoONulo(notas), token, usuario).Scan(&id); err != nil {
		return "", err
	}
	for i, l := range lineas {
		if _, err := tx.Exec(ctx, `INSERT INTO delivery_items (delivery_id, order_item_id, cantidad, orden) VALUES ($1, $2, $3::numeric, $4)`,
			id, l.OrderItemID, fijo2(l.Cantidad), i); err != nil {
			return "", err
		}
	}
	return id, nil
}

// sucursalDelRemito es de dónde sale la mercadería: la del pedido, o donde
// quedó reservada (un envío sin sucursal reserva en la primera activa).
func sucursalDelRemito(ctx context.Context, tx pgx.Tx, pedido string, sucursal *string) (*string, error) {
	if sucursal != nil {
		return sucursal, nil
	}
	suc, ok, err := reservas.SucursalDeSalida(ctx, tx, pedido, nil)
	if err != nil || !ok {
		return nil, err
	}
	return &suc, nil
}

// sacarDelDeposito baja el stock de lo que sale con el remito. La última
// línea de cada renglón que lo deja entregado entero va marcada: esa consume
// todo lo que quede de la reserva.
func sacarDelDeposito(ctx context.Context, tx pgx.Tx, pedido string, sucursal *string, numero string, usuario *string,
	lineas []LineaAEntregar, pendientes []Renglon) error {
	if sucursal == nil {
		return nil
	}
	pendiente := map[string]float64{}
	for _, p := range pendientes {
		pendiente[p.OrderItemID] = p.Pendiente
	}
	total := map[string]float64{}
	ultima := map[string]int{}
	for i, l := range lineas {
		total[l.OrderItemID] += l.Cantidad
		ultima[l.OrderItemID] = i
	}
	s := reservas.Salida{OrderID: pedido, BranchID: *sucursal, NumeroRemito: numero, UsuarioID: usuario}
	for i, l := range lineas {
		completa := ultima[l.OrderItemID] == i && pendiente[l.OrderItemID]-total[l.OrderItemID] <= 0.01
		s.Lineas = append(s.Lineas, reservas.SalidaDeMercaderia{OrderItemID: l.OrderItemID, Cantidad: l.Cantidad, Completa: completa})
	}
	return reservas.SalidaPorEntrega(ctx, tx, s)
}

// CrearEntrega prepara un remito y saca la mercadería del depósito, todo en
// una transacción: el remito, sus líneas, el descuento de stock y el consumo
// de la reserva. Si con esto no queda nada pendiente, el pedido pasa a
// entregado (en un envío, a «en camino» hasta la firma).
//
// Con `Otros` (mes simulado), la misma visita se lleva cosas de otros
// acopios del mismo cliente: sale un remito por pedido, con el mismo
// receptor, y los demás apuntan al primero (visita_de) para firmarse todos
// juntos con su enlace. Solo en un retiro.
func (s *Servicio) CrearEntrega(ctx context.Context, ses *auth.Sesion, f FormRemito) (*EntregaCreada, error) {
	usuario := &ses.UserID
	partes := []FormRemito{}
	for i, p := range append([]FormRemito{f}, f.otrosComoFormularios()...) {
		// El principal va siempre si no hay otros: su validación da el
		// mensaje de siempre («Elegí al menos un producto…»).
		if conAlgo(p.Lineas) || (i == 0 && len(f.Otros) == 0) {
			partes = append(partes, p)
		}
	}
	if len(partes) == 0 {
		return nil, ErrorDeEntrega("Elegí al menos un producto para entregar.")
	}
	if len(partes) > 1 && f.Tipo != "retiro" {
		return nil, ErrorDeEntrega("Lo de otros pedidos sale junto solo en un retiro.")
	}
	var out *EntregaCreada
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if err := numeracion.BloquearRemitos(ctx, tx); err != nil {
			return err
		}
		var cliente *string
		for i, parte := range partes {
			var visita *string
			if i > 0 {
				visita = &out.ID
			}
			creada, delCliente, err := crearEnTransaccion(ctx, tx, parte, usuario, visita)
			if err != nil {
				return err
			}
			if i == 0 {
				out, cliente = creada, delCliente
				continue
			}
			// Solo los acopios del mismo cliente: si no, una visita se
			// llevaría lo de otra obra.
			if cliente == nil || delCliente == nil || *cliente != *delCliente {
				return ErrorDeEntrega("Ese pedido es de otro cliente.")
			}
			out.Visita = append(out.Visita, *creada)
		}
		return nil
	})
	return out, err
}

func conAlgo(ls []LineaAEntregar) bool {
	for _, l := range ls {
		if l.Cantidad > 0 {
			return true
		}
	}
	return false
}

// crearEnTransaccion es un remito de CrearEntrega: quien llama tiene el
// candado de la serie. Devuelve también el cliente del pedido.
func crearEnTransaccion(ctx context.Context, tx pgx.Tx, f FormRemito, usuario, visitaDe *string) (*EntregaCreada, *string, error) {
	pendientes, err := SaldoDeAcopio(ctx, tx, f.OrderID)
	if err != nil {
		return nil, nil, err
	}
	control := ValidarEntrega(pendientes, f.Lineas)
	if control.Error != "" {
		return nil, nil, ErrorDeEntrega(control.Error)
	}
	if msj := RevisarEnteros(pendientes, control.Lineas); msj != "" {
		return nil, nil, ErrorDeEntrega(msj)
	}
	pedido, err := pedidoBloqueado(ctx, tx, f.OrderID)
	if err != nil {
		return nil, nil, err
	}
	if pedido == nil {
		return nil, nil, ErrorDeEntrega("El pedido no existe.")
	}
	if pedido.estado == "cancelado" {
		return nil, nil, ErrorDeEntrega("El pedido está cancelado.")
	}
	// Un pedido entregado con saldo es una venta directa del mostrador:
	// la mercadería salió al cobrar y el stock ya bajó. Un remito común
	// la descontaría otra vez; el de constancia no toca el inventario.
	// (Los demás pedidos dejan de estar entregados al anular un remito.)
	if pedido.estado == "entregado" {
		return nil, nil, ErrorDeEntrega("Este pedido ya salió del depósito: emití el remito de constancia, que no vuelve a descontar el stock.")
	}
	if visitaDe != nil && pedido.tipoEntrega != "retiro" {
		return nil, nil, ErrorDeEntrega("Lo de otros pedidos sale junto solo en un retiro.")
	}
	// Lo que completa el pedido no sale con un corte sin terminar: las
	// piezas todavía no existen.
	if control.Completo {
		if err := FaltaElCorte(ctx, tx, f.OrderID); err != nil {
			return nil, nil, err
		}
	}
	yaSalio, err := SalioConLaVenta(ctx, tx, f.OrderID)
	if err != nil {
		return nil, nil, err
	}
	numero, err := numeracion.Remito(ctx, tx)
	if err != nil {
		return nil, nil, err
	}
	salida, err := sucursalDelRemito(ctx, tx, f.OrderID, pedido.sucursal)
	if err != nil {
		return nil, nil, err
	}
	token := tokenDeFirma()
	id, err := insertarRemito(ctx, tx, numero, f.OrderID, salida, f.Tipo, "preparada",
		f.ReceptorNombre, f.ReceptorDocumento, f.Notas, token, usuario, control.Lineas)
	if err != nil {
		return nil, nil, err
	}
	if visitaDe != nil {
		if _, err := tx.Exec(ctx, `UPDATE deliveries SET visita_de = $2 WHERE id = $1`, id, *visitaDe); err != nil {
			return nil, nil, err
		}
	}
	if f.Tipo == "envio" {
		if _, err := tx.Exec(ctx, `INSERT INTO shipments (delivery_id, transportista, numero_seguimiento, estado) VALUES ($1, $2, $3, 'preparando')`,
			id, textoONulo(f.Transportista), textoONulo(f.NumeroSeguimiento)); err != nil {
			return nil, nil, err
		}
	}
	if !yaSalio {
		if err := sacarDelDeposito(ctx, tx, f.OrderID, salida, numero, usuario, control.Lineas, pendientes); err != nil {
			return nil, nil, err
		}
	}
	switch {
	case f.Tipo == "envio" && pedido.estado != "en-camino":
		// El remito de un envío acompaña al camión: el pedido queda «en
		// camino» y se da por entregado cuando firma quien recibe
		// (VueltaDelViaje). Quedaba entregado al cargar el camión, y el
		// cobro contra entrega desaparecía del reparto.
		nota := "Remito " + numero + ": salió en camino"
		if !control.Completo {
			nota = "Remito " + numero + ": salió en camino una parte"
		}
		if err := pasarA(ctx, tx, f.OrderID, "en-camino", nota, usuario, true); err != nil {
			return nil, nil, err
		}
	case f.Tipo != "envio" && control.Completo:
		// Como «Avanzar» a entregado: si falta cobrar, la nota lo dice con
		// la misma cabecera, y queda quién soltó la mercadería.
		nota, err := notaSinCobrar(ctx, tx, f.OrderID, "Remito "+numero+": se retiró todo lo que quedaba")
		if err != nil {
			return nil, nil, err
		}
		if err := pasarA(ctx, tx, f.OrderID, "entregado", nota, usuario, false); err != nil {
			return nil, nil, err
		}
	case f.Tipo != "envio" && (pedido.estado == "pendiente" || pedido.estado == "preparando"):
		// Ya se llevó una parte: lo que queda está para retirar. Seguía
		// «Sin preparar» con el paso «Recibido» (mes simulado, PED-1149).
		// Con un corte en la máquina no está listo: queda donde estaba.
		cortes, err := CortesSinTerminar(ctx, tx, f.OrderID)
		if err != nil {
			return nil, nil, err
		}
		if len(cortes) == 0 {
			if err := pasarA(ctx, tx, f.OrderID, "listo", "Remito "+numero+": se retiró una parte", usuario, false); err != nil {
				return nil, nil, err
			}
		}
	}
	// El enlace para firmar desde el celular: el de la visita va con el
	// primero, que lleva todo.
	if visitaDe == nil {
		if _, err := cola.Encolar(ctx, sqlc.New(tx), TrabajoRemitoParaFirmar, map[string]string{"deliveryId": id}, time.Time{}); err != nil {
			return nil, nil, err
		}
	}
	return &EntregaCreada{ID: id, Numero: numero, FirmaToken: token, PedidoCompleto: control.Completo}, pedido.cliente, nil
}

// RemitoPorLoQueQueda es el remito que nace cuando un pedido pasa a
// «entregado» desde el tablero («Avanzar») con mercadería todavía en
// depósito: sale todo lo pendiente, con su movimiento y el consumo de la
// reserva, igual que un remito preparado a mano, y queda «preparada» con su
// enlace para que el que retira firme. Sin saldo no hace nada (nil).
//
// Quien llama ya tiene el candado de la serie (numeracion.BloquearRemitos,
// **antes** de bloquear el pedido, el orden de CrearEntrega) y la fila del
// pedido. No cambia el estado del pedido: eso lo hace quien avanza.
func RemitoPorLoQueQueda(ctx context.Context, tx pgx.Tx, pedidoID string, sucursal *string, tipo string, usuario *string, quien Receptor) (*EntregaCreada, error) {
	pendientes, err := SaldoDeAcopio(ctx, tx, pedidoID)
	if err != nil {
		return nil, err
	}
	lineas := LineasDeConstancia(pendientes)
	if len(lineas) == 0 {
		return nil, nil
	}
	if tipo != "envio" {
		if campo, msj := quien.Revisar(); msj != "" {
			return nil, plataforma.Invalido(map[string]string{campo: msj})
		}
	}
	numero, err := numeracion.Remito(ctx, tx)
	if err != nil {
		return nil, err
	}
	salida, err := sucursalDelRemito(ctx, tx, pedidoID, sucursal)
	if err != nil {
		return nil, err
	}
	if tipo != "envio" {
		tipo = "retiro"
	}
	nota := "Entregado desde el tablero de pedidos"
	if tipo == "envio" {
		nota = "Despachado desde el tablero de pedidos"
	}
	token := tokenDeFirma()
	var nombre, documento *string
	if tipo == "retiro" {
		nombre, documento = quien.Nombre, quien.Documento
	}
	id, err := insertarRemito(ctx, tx, numero, pedidoID, salida, tipo, "preparada", nombre, documento, &nota, token, usuario, lineas)
	if err != nil {
		return nil, err
	}
	yaSalio, err := SalioConLaVenta(ctx, tx, pedidoID)
	if err != nil {
		return nil, err
	}
	if !yaSalio {
		if err := sacarDelDeposito(ctx, tx, pedidoID, salida, numero, usuario, lineas, pendientes); err != nil {
			return nil, err
		}
	}
	if _, err := cola.Encolar(ctx, sqlc.New(tx), TrabajoRemitoParaFirmar, map[string]string{"deliveryId": id}, time.Time{}); err != nil {
		return nil, err
	}
	return &EntregaCreada{ID: id, Numero: numero, FirmaToken: token, PedidoCompleto: true}, nil
}

// RemitoDeConstancia es el remito de una venta que ya salió por el
// mostrador: la mercadería cruzó la puerta y el stock se descontó al cobrar,
// así que este remito **no toca el inventario**. Nace entregado, con todo lo
// pendiente del pedido. Queda en la bitácora.
func (s *Servicio) RemitoDeConstancia(ctx context.Context, ses *auth.Sesion, pedidoID string, receptorNombre *string) (*EntregaCreada, error) {
	var out *EntregaCreada
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if err := numeracion.BloquearRemitos(ctx, tx); err != nil {
			return err
		}
		pedido, err := pedidoBloqueado(ctx, tx, pedidoID)
		if err != nil {
			return err
		}
		if pedido == nil {
			return ErrorDeEntrega("El pedido no existe.")
		}
		if pedido.estado == "cancelado" {
			return ErrorDeEntrega("El pedido está cancelado.")
		}
		if pedido.estado != "entregado" {
			return ErrorDeEntrega("Este pedido todavía tiene mercadería en depósito: registrá el retiro desde la ficha del pedido, que es lo que descuenta el stock.")
		}
		pendientes, err := SaldoDeAcopio(ctx, tx, pedidoID)
		if err != nil {
			return err
		}
		lineas := LineasDeConstancia(pendientes)
		if len(lineas) == 0 {
			// Solo el corte (pasadas sin placa) no lleva mercadería.
			var conRemito bool
			if err := tx.QueryRow(ctx, `SELECT exists(SELECT 1 FROM deliveries WHERE order_id = $1 AND estado <> 'anulada')`, pedidoID).Scan(&conRemito); err != nil {
				return err
			}
			if !conRemito {
				return ErrorDeEntrega("Esta venta no lleva mercadería: no hay remito que emitir.")
			}
			return ErrorDeEntrega("Esta venta ya tiene su remito emitido.")
		}
		numero, err := numeracion.Remito(ctx, tx)
		if err != nil {
			return err
		}
		token := tokenDeFirma()
		id, err := insertarRemito(ctx, tx, numero, pedidoID, pedido.sucursal, "retiro", "entregada",
			receptorNombre, nil, nil, token, &ses.UserID, lineas)
		if err != nil {
			return err
		}
		bitacora.Anotar(ctx, s.q.WithTx(tx), s.log, ses, sqlc.AccionAuditoriaCrear, "remito", id,
			"Remito "+numero+" emitido desde el mostrador", nil)
		out = &EntregaCreada{ID: id, Numero: numero, FirmaToken: token, PedidoCompleto: true}
		return nil
	})
	return out, err
}

// FirmaRegistrada es el remito que se firmó.
type FirmaRegistrada struct {
	DeliveryID string `json:"deliveryId"`
	Numero     string `json:"numero"`
}

// RegistrarFirma guarda la firma de quien retiró, con cuándo y desde dónde.
// Solo un remito «preparada» se firma: el segundo intento no hace nada (nil),
// y el token no se borra, para que el enlace siga mostrando la constancia.
//
// Sin documento en el formulario **no se pisa el guardado** (el que el
// mostrador estaba obligado a pedir al preparar el retiro).
//
// **Arreglado**: el TS leía el remito y después lo actualizaba sin volver a
// mirar el estado; dos firmas a la vez pasaban las dos y la segunda pisaba a
// la primera. Ahora es un solo UPDATE condicionado.
func (s *Servicio) RegistrarFirma(ctx context.Context, f FormFirma, ip *string) (*FirmaRegistrada, error) {
	var r FirmaRegistrada
	firmo := false
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var pedido, tipo string
		err := tx.QueryRow(ctx, `
			UPDATE deliveries SET estado = 'entregada', firma_url = $2, firmado_at = now(), firmado_ip = $3,
			  receptor_nombre = $4, receptor_documento = coalesce(nullif($5, ''), receptor_documento),
			  entregado_at = now(), updated_at = now()
			WHERE firma_token = $1 AND estado = 'preparada'
			RETURNING id, numero, order_id, tipo::text`, f.Token, f.Firma, ip, f.ReceptorNombre, textoONulo(f.ReceptorDocumento)).
			Scan(&r.DeliveryID, &r.Numero, &pedido, &tipo)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		firmo = true
		// Los remitos de la misma visita se firman con el primero.
		if _, err := tx.Exec(ctx, `
			UPDATE deliveries SET estado = 'entregada', firma_url = $2, firmado_at = now(), firmado_ip = $3,
			  receptor_nombre = $4, receptor_documento = coalesce(nullif($5, ''), receptor_documento),
			  entregado_at = now(), updated_at = now()
			WHERE visita_de = $1 AND estado = 'preparada'`, r.DeliveryID, f.Firma, ip, f.ReceptorNombre, textoONulo(f.ReceptorDocumento)); err != nil {
			return err
		}
		// El envío se da por entregado cuando firma quien recibe en la obra.
		if tipo == "envio" {
			if _, err := pedidoBloqueado(ctx, tx, pedido); err != nil {
				return err
			}
			if err := VueltaDelViaje(ctx, tx, pedido, r.DeliveryID, r.Numero, nil, true); err != nil {
				return err
			}
		}
		// La constancia de lo que se retiró, por correo.
		_, err = cola.Encolar(ctx, sqlc.New(tx), TrabajoRemitoFirmado, map[string]string{"deliveryId": r.DeliveryID}, time.Time{})
		return err
	})
	if err != nil || !firmo {
		return nil, err
	}
	return &r, nil
}

// AnularEntrega anula un remito: no lo borra (alguien pudo haberlo visto),
// lo marca anulado y la mercadería vuelve al stock con un movimiento de
// devolución. Anular uno ya anulado o que no existe no hace nada.
//
// **Arreglado** (dos bugs del TS, cada uno con su prueba):
//   - Dos anulaciones a la vez devolvían dos veces: el TS leía el estado sin
//     bloquear la fila. Ahora `FOR UPDATE`.
//   - Anular un remito de constancia del mostrador devolvía al stock
//     mercadería que ese remito nunca sacó (se descontó al cobrar). Ahora se
//     devuelve solo si el remito tiene su salida del depósito
//     («Remito REM-…»).
//
// **Arreglado** (auditoría del 30/10): lo que vuelve sale de los movimientos
// del remito —lo que de verdad salió, de la sucursal de donde salió— y, si el
// pedido sigue vivo, **vuelve a reservarse**: la mercadería es del cliente y
// sigue en acopio. Antes volvía al físico sin reserva (quedaba disponible
// para venderle a otro) y el pedido seguía «entregado» con saldo; anular
// después la venta del mostrador la devolvía otra vez. Si el pedido estaba
// entregado y ahora le queda saldo, vuelve a «listo».
func (s *Servicio) AnularEntrega(ctx context.Context, ses *auth.Sesion, id string) error {
	return s.AnularEntregaCon(ctx, ses, id, Anulacion{})
}

// AnularEntregaCon es AnularEntrega con el motivo y el PIN que pide un
// remito ya firmado: el motivo queda en el historial del pedido.
func (s *Servicio) AnularEntregaCon(ctx context.Context, ses *auth.Sesion, id string, a Anulacion) error {
	if !plataforma.UUIDValido(id) {
		return nil
	}
	var firmado *time.Time
	if err := s.pool.QueryRow(ctx, `SELECT firmado_at FROM deliveries WHERE id = $1 AND estado <> 'anulada'`, id).Scan(&firmado); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	var autorizo string
	if firmado != nil {
		var err error
		if autorizo, err = s.autorizarAnulacion(ctx, ses, id, a); err != nil {
			return err
		}
	}
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		// El mismo orden que CrearEntrega: la serie, el remito, el pedido.
		// Con la serie, nadie lee el saldo del pedido a mitad de la anulación.
		if err := numeracion.BloquearRemitos(ctx, tx); err != nil {
			return err
		}
		var numero, estado, pedidoID string
		err := tx.QueryRow(ctx, `SELECT numero, estado::text, order_id FROM deliveries WHERE id = $1 FOR UPDATE`, id).Scan(&numero, &estado, &pedidoID)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && estado == "anulada") {
			return nil
		}
		if err != nil {
			return err
		}
		pedido, err := pedidoBloqueado(ctx, tx, pedidoID)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE deliveries SET estado = 'anulada', updated_at = now() WHERE id = $1`, id); err != nil {
			return err
		}
		// El motivo del firmado anulado va al historial del pedido. Si el
		// pedido vuelve a «listo», es un solo renglón con el cambio de
		// estado: eran dos, y el del motivo salía con el chip «Entregado»
		// (mes simulado).
		notaFirma := ""
		if firmado != nil && pedido != nil {
			notaFirma = "Remito " + numero + " firmado, anulado: " + zodjs.TrimJS(a.Motivo) + " · autorizó " + autorizo
			bitacora.Anotar(ctx, s.q.WithTx(tx), s.log, ses, sqlc.AccionAuditoriaAnular, "remito", id, notaFirma, nil)
		}
		anotarFirma := func() error {
			if notaFirma == "" {
				return nil
			}
			_, err := tx.Exec(ctx, `INSERT INTO order_status_history (order_id, estado, nota, created_by_user_id) VALUES ($1, $2, $3, $4)`,
				pedidoID, pedido.estado, notaFirma, ses.UserID)
			return err
		}
		// Lo que salió con este remito, por variante y sucursal. Se filtra
		// por las variantes del remito para usar el índice.
		filas, err := tx.Query(ctx, `
			SELECT variant_id, branch_id, (-sum(qty))::text FROM inventory_movements
			WHERE type = 'venta' AND note = $2
			  AND variant_id IN (SELECT oi.variant_id FROM delivery_items di JOIN order_items oi ON oi.id = di.order_item_id
			                     WHERE di.delivery_id = $1 AND oi.variant_id IS NOT NULL)
			GROUP BY variant_id, branch_id ORDER BY variant_id, branch_id`, id, "Remito "+numero)
		if err != nil {
			return err
		}
		var lineas []reservas.LineaDevuelta
		dondeSalio := map[string]string{}
		for filas.Next() {
			var l reservas.LineaDevuelta
			var cantidad string
			if err := filas.Scan(&l.VariantID, &l.BranchID, &cantidad); err != nil {
				filas.Close()
				return err
			}
			l.Cantidad = numeroJS(cantidad)
			if l.Cantidad > 0 {
				lineas = append(lineas, l)
				dondeSalio[l.VariantID] = l.BranchID
			}
		}
		filas.Close()
		if err := filas.Err(); err != nil {
			return err
		}
		if len(lineas) == 0 {
			// Un remito de constancia: la mercadería salió con la venta.
			return anotarFirma()
		}
		if err := reservas.DevolverAlStock(ctx, tx, numero, &ses.UserID, lineas); err != nil {
			return err
		}
		if pedido == nil || pedido.estado == "cancelado" {
			return anotarFirma()
		}
		filas, err = tx.Query(ctx, `
			SELECT di.order_item_id, oi.variant_id, di.cantidad::text, oi.stock_por_unidad::text
			FROM delivery_items di JOIN order_items oi ON oi.id = di.order_item_id
			WHERE di.delivery_id = $1 AND oi.variant_id IS NOT NULL ORDER BY di.orden`, id)
		if err != nil {
			return err
		}
		var otraVez []reservas.ReservaDeVuelta
		for filas.Next() {
			var item, variante, cantidad, factor string
			if err := filas.Scan(&item, &variante, &cantidad, &factor); err != nil {
				filas.Close()
				return err
			}
			suc, ok := dondeSalio[variante]
			if !ok {
				continue
			}
			otraVez = append(otraVez, reservas.ReservaDeVuelta{OrderID: pedidoID, OrderItemID: item, VariantID: variante, BranchID: suc,
				Cantidad: ventas.UnidadesDeStock(numeroJS(cantidad), numeroJS(factor))})
		}
		filas.Close()
		if err := filas.Err(); err != nil {
			return err
		}
		if err := reservas.VolverAReservar(ctx, tx, otraVez); err != nil {
			return err
		}
		if pedido.estado == "en-camino" {
			if err := anotarFirma(); err != nil {
				return err
			}
			return VueltaDelViaje(ctx, tx, pedidoID, id, numero, &ses.UserID, false)
		}
		if pedido.estado != "entregado" {
			return anotarFirma()
		}
		saldo, err := SaldoDeAcopio(ctx, tx, pedidoID)
		if err != nil {
			return err
		}
		if len(SoloPendientes(saldo)) == 0 {
			return anotarFirma()
		}
		if _, err := tx.Exec(ctx, `UPDATE orders SET estado = 'listo', updated_at = now() WHERE id = $1`, pedidoID); err != nil {
			return err
		}
		// Un envío no tiene acopio: lo que vuelve queda por llevar.
		queda := "vuelve a quedar mercadería en acopio"
		if pedido.tipoEntrega == "envio" {
			queda = "vuelve a quedar mercadería por llevar"
		}
		nota := "Remito " + numero + " anulado: " + queda
		if notaFirma != "" {
			nota = notaFirma + " · " + queda
		}
		_, err = tx.Exec(ctx, `INSERT INTO order_status_history (order_id, estado, nota, created_by_user_id) VALUES ($1, 'listo', $2, $3)`,
			pedidoID, nota, ses.UserID)
		return err
	})
}

/* ----------------------------- lecturas ----------------------------- */

// RemitoListado es un remito en la ficha del pedido.
type RemitoListado struct {
	ID                string     `json:"id"`
	Numero            string     `json:"numero"`
	Tipo              string     `json:"tipo"`
	Estado            string     `json:"estado"`
	ReceptorNombre    *string    `json:"receptorNombre"`
	FirmadoAt         *time.Time `json:"firmadoAt"`
	FirmaToken        *string    `json:"firmaToken"`
	CreatedAt         time.Time  `json:"createdAt"`
	Transportista     *string    `json:"transportista"`
	NumeroSeguimiento *string    `json:"numeroSeguimiento"`
	CantidadLineas    int        `json:"cantidadLineas"`
	// Parcial: cuando se hizo, quedaba algo por entregar (SaldoAlRemito, lo
	// mismo que imprime el PDF). La ficha lo deducía y decía «Entrega
	// parcial» de un remito que se llevó todo.
	Parcial bool `json:"parcial"`
}

// RemitosDelPedido son los remitos de un pedido, los más nuevos primero.
func (s *Servicio) RemitosDelPedido(ctx context.Context, pedido string) ([]RemitoListado, error) {
	out := []RemitoListado{}
	if !plataforma.UUIDValido(pedido) {
		return out, nil
	}
	filas, err := s.pool.Query(ctx, `
		SELECT d.id, d.numero, d.tipo::text, d.estado::text, d.receptor_nombre, d.firmado_at, d.firma_token, d.created_at,
		  s.transportista, s.numero_seguimiento,
		  (SELECT count(*) FROM delivery_items di WHERE di.delivery_id = d.id)::int
		FROM deliveries d LEFT JOIN shipments s ON s.delivery_id = d.id
		WHERE d.order_id = $1 ORDER BY d.created_at DESC`, pedido)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	for filas.Next() {
		var r RemitoListado
		if err := filas.Scan(&r.ID, &r.Numero, &r.Tipo, &r.Estado, &r.ReceptorNombre, &r.FirmadoAt, &r.FirmaToken, &r.CreatedAt,
			&r.Transportista, &r.NumeroSeguimiento, &r.CantidadLineas); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	if err := filas.Err(); err != nil {
		return nil, err
	}
	filas.Close()
	for i := range out {
		quedaba, err := SaldoAlRemito(ctx, s.pool, pedido, out[i].ID)
		if err != nil {
			return nil, err
		}
		out[i].Parcial = len(quedaba) > 0
	}
	return out, nil
}

// OtroAcopio es lo que el mismo cliente tiene en acopio en otro pedido.
type OtroAcopio struct {
	OrderID   string    `json:"orderId"`
	Numero    string    `json:"numero"`
	Renglones []Renglon `json:"renglones"`
}

// OtrosAcopios son los demás pedidos de retiro del cliente del pedido con
// algo por retirar: la visita del albañil se lleva cosas de todos (mes
// simulado), y no había dónde ver todo lo que la obra tiene en acopio.
func (s *Servicio) OtrosAcopios(ctx context.Context, pedido string) ([]OtroAcopio, error) {
	out := []OtroAcopio{}
	if !plataforma.UUIDValido(pedido) {
		return out, nil
	}
	filas, err := s.pool.Query(ctx, `
		SELECT o.id::text, o.numero FROM orders o
		WHERE o.customer_id = (SELECT customer_id FROM orders WHERE id = $1) AND o.id <> $1
		  AND o.tipo_entrega = 'retiro' AND o.estado NOT IN ('entregado', 'cancelado')
		ORDER BY o.created_at`, pedido)
	if err != nil {
		return nil, err
	}
	type fila struct{ id, numero string }
	var pedidos []fila
	for filas.Next() {
		var f fila
		if err := filas.Scan(&f.id, &f.numero); err != nil {
			filas.Close()
			return nil, err
		}
		pedidos = append(pedidos, f)
	}
	filas.Close()
	if err := filas.Err(); err != nil {
		return nil, err
	}
	for _, p := range pedidos {
		saldo, err := SaldoDeAcopio(ctx, s.pool, p.id)
		if err != nil {
			return nil, err
		}
		if quedan := SoloPendientes(saldo); len(quedan) > 0 {
			out = append(out, OtroAcopio{OrderID: p.id, Numero: p.numero, Renglones: quedan})
		}
	}
	return out, nil
}

// RemitoDelPortal es un retiro en «mi pedido».
type RemitoDelPortal struct {
	ID             string     `json:"id"`
	Numero         string     `json:"numero"`
	Tipo           string     `json:"tipo"`
	Estado         string     `json:"estado"`
	ReceptorNombre *string    `json:"receptorNombre"`
	FirmadoAt      *time.Time `json:"firmadoAt"`
	CreatedAt      time.Time  `json:"createdAt"`
}

// EntregasDelPortal son los retiros y el acopio de un pedido del cliente de
// la sesión (nil si el pedido no es suyo).
type EntregasDelPortal struct {
	Entregas []RemitoDelPortal `json:"entregas"`
	Acopio   []Renglon         `json:"acopio"`
}

// DelPortal: el cliente de la sesión y el pedido van juntos en el where.
func (s *Servicio) DelPortal(ctx context.Context, ses *auth.Sesion, pedido string) (*EntregasDelPortal, error) {
	if !plataforma.UUIDValido(pedido) {
		return nil, nil
	}
	var es bool
	if err := s.pool.QueryRow(ctx, `
		SELECT exists(SELECT 1 FROM orders o JOIN customers c ON c.id = o.customer_id
		  WHERE o.id = $1 AND c.user_id = $2 AND c.active)`, pedido, ses.UserID).Scan(&es); err != nil || !es {
		return nil, err
	}
	out := &EntregasDelPortal{Entregas: []RemitoDelPortal{}}
	filas, err := s.pool.Query(ctx, `
		SELECT id, numero, tipo::text, estado::text, receptor_nombre, firmado_at, created_at
		FROM deliveries WHERE order_id = $1 ORDER BY created_at DESC`, pedido)
	if err != nil {
		return nil, err
	}
	for filas.Next() {
		var r RemitoDelPortal
		if err := filas.Scan(&r.ID, &r.Numero, &r.Tipo, &r.Estado, &r.ReceptorNombre, &r.FirmadoAt, &r.CreatedAt); err != nil {
			filas.Close()
			return nil, err
		}
		out.Entregas = append(out.Entregas, r)
	}
	filas.Close()
	if err := filas.Err(); err != nil {
		return nil, err
	}
	out.Acopio, err = SaldoDeAcopio(ctx, s.pool, pedido)
	if err != nil {
		return out, err
	}
	// Entregado sin ningún remito: la venta del mostrador que se llevó en
	// el acto (descontó el stock al vender). No le queda nada en acopio; el
	// portal decía «Te queda en acopio · 4 de 4» y «Entregado: 0 de 4»
	// debajo de «Retirado 4 de 4» (mes simulado, H095).
	var sinRemito bool
	if err := s.pool.QueryRow(ctx, `SELECT o.estado = 'entregado' AND NOT EXISTS (
		  SELECT 1 FROM deliveries d WHERE d.order_id = o.id AND d.estado <> 'anulada')
		FROM orders o WHERE o.id = $1`, pedido).Scan(&sinRemito); err != nil {
		return out, err
	}
	if sinRemito {
		for i := range out.Acopio {
			out.Acopio[i].Entregado, out.Acopio[i].Pendiente = out.Acopio[i].Pedido, 0
		}
		return out, nil
	}
	out.Acopio, err = ConGalpon(ctx, s.pool, pedido, out.Acopio)
	return out, err
}
