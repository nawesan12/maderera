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
	"mjbj/internal/bitacora"
	"mjbj/internal/cola"
	"mjbj/internal/numeracion"
	"mjbj/internal/plataforma"
	"mjbj/internal/reservas"
	"mjbj/internal/sqlc"
	"mjbj/internal/ventas"
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
}

// Nuevo arma el servicio.
func Nuevo(pool *pgxpool.Pool, log *slog.Logger) *Servicio {
	return &Servicio{pool: pool, q: sqlc.New(pool), log: log}
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

const consultaSaldo = `
	SELECT oi.id, oi.descripcion, oi.unidad, oi.cantidad::text,
	  coalesce((
	    SELECT sum(di.cantidad) FROM delivery_items di
	    JOIN deliveries d ON d.id = di.delivery_id
	    WHERE di.order_item_id = oi.id AND d.estado <> 'anulada' %s
	  ), 0)::text
	FROM order_items oi WHERE oi.order_id = $1 ORDER BY oi.orden`

func leerSaldo(ctx context.Context, db consultor, consulta string, args ...any) ([]Renglon, error) {
	filas, err := db.Query(ctx, consulta, args...)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	out := []Renglon{}
	for filas.Next() {
		var id, desc, unidad, pedido, entregado string
		if err := filas.Scan(&id, &desc, &unidad, &pedido, &entregado); err != nil {
			return nil, err
		}
		out = append(out, NuevoRenglon(id, desc, unidad, pedido, entregado))
	}
	return out, filas.Err()
}

// SaldoDeAcopio es qué queda por entregar de un pedido, renglón por renglón.
func SaldoDeAcopio(ctx context.Context, db consultor, pedido string) ([]Renglon, error) {
	if !plataforma.UUIDValido(pedido) {
		return []Renglon{}, nil
	}
	return leerSaldo(ctx, db, sprintf(consultaSaldo, ""), pedido)
}

// SaldoAlRemito es qué quedaba en acopio **cuando se hizo ese remito**: se
// cuentan las entregas hasta esa, inclusive. Un remito reimpreso dice lo
// mismo que el día que se firmó.
func SaldoAlRemito(ctx context.Context, db consultor, pedido, remito string) ([]Renglon, error) {
	rs, err := leerSaldo(ctx, db, sprintf(consultaSaldo,
		`AND d.created_at <= (SELECT created_at FROM deliveries WHERE id = $2)`), pedido, remito)
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
}

// tokenDeFirma son 24 bytes al azar en base64url (randomBytes(24)).
func tokenDeFirma() string {
	var b [24]byte
	_, _ = rand.Read(b[:])
	return base64.RawURLEncoding.EncodeToString(b[:])
}

type pedidoDelRemito struct {
	sucursal *string
	estado   string
}

// pedidoBloqueado lee el pedido y bloquea su fila (nadie lo cancela ni lo
// cierra mientras sale mercadería).
func pedidoBloqueado(ctx context.Context, tx pgx.Tx, id string) (*pedidoDelRemito, error) {
	if !plataforma.UUIDValido(id) {
		return nil, nil
	}
	var p pedidoDelRemito
	err := tx.QueryRow(ctx, `SELECT branch_id, estado::text FROM orders WHERE id = $1 FOR UPDATE`, id).Scan(&p.sucursal, &p.estado)
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

// CrearEntrega prepara un remito y saca la mercadería del depósito, todo en
// una transacción: el remito, sus líneas, el descuento de stock y el consumo
// de la reserva. Si con esto no queda nada pendiente, el pedido pasa a
// entregado.
func (s *Servicio) CrearEntrega(ctx context.Context, ses *auth.Sesion, f FormRemito) (*EntregaCreada, error) {
	usuario := &ses.UserID
	var out *EntregaCreada
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if err := numeracion.BloquearRemitos(ctx, tx); err != nil {
			return err
		}
		pendientes, err := SaldoDeAcopio(ctx, tx, f.OrderID)
		if err != nil {
			return err
		}
		control := ValidarEntrega(pendientes, f.Lineas)
		if control.Error != "" {
			return ErrorDeEntrega(control.Error)
		}
		pedido, err := pedidoBloqueado(ctx, tx, f.OrderID)
		if err != nil {
			return err
		}
		if pedido == nil {
			return ErrorDeEntrega("El pedido no existe.")
		}
		if pedido.estado == "cancelado" {
			return ErrorDeEntrega("El pedido está cancelado.")
		}
		numero, err := numeracion.Remito(ctx, tx)
		if err != nil {
			return err
		}
		token := tokenDeFirma()
		id, err := insertarRemito(ctx, tx, numero, f.OrderID, pedido.sucursal, f.Tipo, "preparada",
			f.ReceptorNombre, f.ReceptorDocumento, f.Notas, token, usuario, control.Lineas)
		if err != nil {
			return err
		}
		if f.Tipo == "envio" {
			if _, err := tx.Exec(ctx, `INSERT INTO shipments (delivery_id, transportista, numero_seguimiento, estado) VALUES ($1, $2, $3, 'preparando')`,
				id, textoONulo(f.Transportista), textoONulo(f.NumeroSeguimiento)); err != nil {
				return err
			}
		}
		if pedido.sucursal != nil {
			salida := reservas.Salida{OrderID: f.OrderID, BranchID: *pedido.sucursal, NumeroRemito: numero, UsuarioID: usuario}
			for _, l := range control.Lineas {
				salida.Lineas = append(salida.Lineas, reservas.SalidaDeMercaderia{OrderItemID: l.OrderItemID, Cantidad: l.Cantidad})
			}
			if err := reservas.SalidaPorEntrega(ctx, tx, salida); err != nil {
				return err
			}
		}
		if control.Completo && pedido.estado != "entregado" {
			if _, err := tx.Exec(ctx, `UPDATE orders SET estado = 'entregado', updated_at = now() WHERE id = $1`, f.OrderID); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `INSERT INTO order_status_history (order_id, estado, nota, created_by_user_id) VALUES ($1, 'entregado', $2, $3)`,
				f.OrderID, "Remito "+numero+": se retiró todo lo que quedaba", usuario); err != nil {
				return err
			}
		}
		out = &EntregaCreada{ID: id, Numero: numero, FirmaToken: token, PedidoCompleto: control.Completo}
		// El enlace para firmar desde el celular.
		_, err = cola.Encolar(ctx, sqlc.New(tx), TrabajoRemitoParaFirmar, map[string]string{"deliveryId": id}, time.Time{})
		return err
	})
	return out, err
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
		err := tx.QueryRow(ctx, `
			UPDATE deliveries SET estado = 'entregada', firma_url = $2, firmado_at = now(), firmado_ip = $3,
			  receptor_nombre = $4, receptor_documento = coalesce(nullif($5, ''), receptor_documento),
			  entregado_at = now(), updated_at = now()
			WHERE firma_token = $1 AND estado = 'preparada'
			RETURNING id, numero`, f.Token, f.Firma, ip, f.ReceptorNombre, textoONulo(f.ReceptorDocumento)).Scan(&r.DeliveryID, &r.Numero)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		firmo = true
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
func (s *Servicio) AnularEntrega(ctx context.Context, ses *auth.Sesion, id string) error {
	if !plataforma.UUIDValido(id) {
		return nil
	}
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var numero, estado string
		var sucursal *string
		err := tx.QueryRow(ctx, `SELECT numero, estado::text, branch_id FROM deliveries WHERE id = $1 FOR UPDATE`, id).Scan(&numero, &estado, &sucursal)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && estado == "anulada") {
			return nil
		}
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE deliveries SET estado = 'anulada', updated_at = now() WHERE id = $1`, id); err != nil {
			return err
		}
		if sucursal == nil {
			return nil
		}
		var salio bool
		if err := tx.QueryRow(ctx, `SELECT exists(SELECT 1 FROM inventory_movements WHERE type = 'venta' AND note = $1)`,
			"Remito "+numero).Scan(&salio); err != nil {
			return err
		}
		if !salio {
			return nil
		}
		filas, err := tx.Query(ctx, `
			SELECT oi.variant_id, di.cantidad::text, oi.stock_por_unidad::text
			FROM delivery_items di JOIN order_items oi ON oi.id = di.order_item_id
			WHERE di.delivery_id = $1 ORDER BY di.orden`, id)
		if err != nil {
			return err
		}
		var lineas []reservas.LineaDevuelta
		for filas.Next() {
			var variante *string
			var cantidad, factor string
			if err := filas.Scan(&variante, &cantidad, &factor); err != nil {
				filas.Close()
				return err
			}
			if variante == nil {
				continue
			}
			lineas = append(lineas, reservas.LineaDevuelta{VariantID: *variante,
				Cantidad: ventas.UnidadesDeStock(numeroJS(cantidad), numeroJS(factor))})
		}
		filas.Close()
		if err := filas.Err(); err != nil {
			return err
		}
		return reservas.DevolverAlStock(ctx, tx, *sucursal, numero, &ses.UserID, lineas)
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
	return out, filas.Err()
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
	return out, err
}
