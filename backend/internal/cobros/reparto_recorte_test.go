package cobros

import (
	"context"
	"reflect"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/pruebas"
)

// El recorte de los recibos ya fijados (recorteDelRecibo) y los pendientes
// en Go (pendientes.delRecibo) no pueden cambiar ningún reparto:
// CargarEventos y el SQL de antes —sin recortar ({F} y {G} en «true») y con
// el LATERAL que calculaba los pendientes de cada recibo— tienen que dar el
// mismo ResultadoDelReparto, entero, antes y después de fijar, en todas las
// cuentas y en cada una sola.

// caeADeAntes, abiertoADeAntes y pendientesDeAntes son los del LATERAL de
// antes, tal cual.
const caeADeAntes = `coalesce((SELECT max(l.created_at) FROM arca_log l WHERE l.invoice_id = i.id AND l.exito
	  AND l.operacion IN ('FECAESolicitar', 'FECompConsultar')), i.fecha_emision)`

const abiertoADeAntes = `CASE WHEN EXISTS (SELECT 1 FROM order_status_history h WHERE h.order_id = o.id AND h.created_at > r.created_at)
	  THEN coalesce((SELECT h.estado::text FROM order_status_history h WHERE h.order_id = o.id AND h.created_at <= r.created_at
	                 ORDER BY h.created_at DESC LIMIT 1), 'pendiente')
	  ELSE o.estado::text END NOT IN ('cancelado', 'entregado')`

const pendientesDeAntes = `
SELECT coalesce(array_agg(d.destino ORDER BY d.destino), '{}'::text[]) AS destinos, coalesce(sum(d.monto), 0)::float8 AS por_facturar
FROM (
  SELECT 'i:' || i.id::text AS destino, i.total AS monto FROM invoices i
  WHERE {F} AND i.tipo::text NOT LIKE 'nota_credito%' AND i.estado <> 'borrador' AND i.created_at <= r.created_at
    AND i.id IN (SELECT x.id FROM invoices x WHERE x.customer_id = r.customer_id
                 UNION ALL SELECT ip.invoice_id FROM invoice_payments ip WHERE r.customer_id IS NULL AND ip.receipt_id = r.id
                 UNION ALL SELECT x.id FROM invoices x WHERE r.customer_id IS NULL AND x.order_id = r.order_id)
    AND CASE WHEN i.cae IS NULL THEN i.estado IN ('emitida', 'rechazada') ELSE ` + caeADeAntes + ` > r.created_at END
  UNION ALL
  SELECT 'o:' || o.id::text, o.total FROM orders o
  WHERE {F} AND (o.customer_id = r.customer_id OR (r.customer_id IS NULL AND o.id = r.order_id)) AND o.created_at <= r.created_at AND ` + abiertoADeAntes + `
    AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id AND i.tipo::text LIKE 'factura%' AND i.created_at <= r.created_at
      AND (i.cae IS NOT NULL OR i.estado IN ('emitida', 'rechazada')))
) d`

const ramaDelReciboDeAntes = `SELECT ` + claveDeRecibo + `, r.created_at, 2, r.id::text, r.total::float8,
    CASE WHEN {G} THEN coalesce((SELECT sum(importe) FROM receipt_parts WHERE receipt_id = r.id AND medio = 'retencion'), 0) ELSE 0 END::float8,
    CASE WHEN {G} THEN coalesce((SELECT sum(x.importe) FROM receipt_parts x JOIN cheques ch ON ch.id = x.cheque_id
              WHERE x.receipt_id = r.id AND ch.circuito = 'negro'), 0) ELSE 0 END::float8,
    cardinality(pend.destinos) > 0,
    r.reparto_deudores::float8, r.reparto_anticipo::float8, r.reparto_b::float8, '', 0, 0, r.recibido_de,
    pend.destinos, pend.por_facturar, '', ` + columnasDelRecibo + `
  FROM receipts r CROSS JOIN LATERAL (` + pendientesDeAntes + `) pend
  WHERE r.created_at <= $1 AND {R}`

var (
	eventosDeAntes                      = strings.Replace(eventosSQL, ramaDelRecibo, ramaDelReciboDeAntes, 1)
	todasSinRecorte, unaClaveSinRecorte = armarEventos(eventosDeAntes, "true", "true")
	// El SQL de producción de antes de pendientes.go: con el recorte y el
	// LATERAL (volumen_test.go).
	todasDeAntes, unaClaveDeAntes = armarEventos(eventosDeAntes, recorteDelRecibo, sinRepartoGuardado)
)

// cargarDeAntes lee los eventos con el SQL de antes, sin recortar.
func cargarDeAntes(ctx context.Context, db *pgxpool.Pool, hasta time.Time, clave string) ([]EventoDeCuenta, error) {
	return cargarCon(ctx, db, todasSinRecorte, unaClaveSinRecorte, hasta, clave)
}

func cargarCon(ctx context.Context, db *pgxpool.Pool, todas, unaClave string, hasta time.Time, clave string) ([]EventoDeCuenta, error) {
	sql := todas
	if clave != "" {
		sql = unaClave
	}
	rs, err := db.Query(ctx, sql, argumentosDeEventos(hasta, clave)...)
	if err != nil {
		return nil, err
	}
	return leerEventos(rs)
}

func TestElSQLDeAntesTieneElLateral(t *testing.T) {
	if !strings.Contains(eventosSQL, ramaDelRecibo) || !strings.Contains(todasSinRecorte, "CROSS JOIN LATERAL") {
		t.Fatal("la rama de los recibos no se reemplazó: la comparación sería contra el mismo SQL")
	}
}

type escenario struct {
	t    *testing.T
	pool *pgxpool.Pool
	n    int
}

func (e *escenario) id(sql string, args ...any) string {
	e.t.Helper()
	var id string
	if err := e.pool.QueryRow(context.Background(), sql, args...).Scan(&id); err != nil {
		e.t.Fatalf("%s: %v", sql, err)
	}
	return id
}

func (e *escenario) exec(sql string, args ...any) {
	e.t.Helper()
	if _, err := e.pool.Exec(context.Background(), sql, args...); err != nil {
		e.t.Fatalf("%s: %v", sql, err)
	}
}

// pedido abierto desde `cuando`; si se entrega, con su historial.
func (e *escenario) pedido(cliente *string, total float64, cuando string, entregado string) string {
	e.n++
	estado := "pendiente"
	if entregado != "" {
		estado = "entregado"
	}
	id := e.id(`insert into orders (numero, contacto_nombre, estado, total, subtotal, created_at, customer_id)
		values ('P-' || $1::int, 'Contacto', $2, $3, $3, $4, $5) returning id`, e.n, estado, total, cuando, cliente)
	e.exec(`insert into order_status_history (order_id, estado, created_at) values ($1, 'pendiente', $2)`, id, cuando)
	if entregado != "" {
		e.exec(`insert into order_status_history (order_id, estado, created_at) values ($1, 'entregado', $2)`, id, entregado)
	}
	return id
}

// factura con CAE (caeA = cuándo llegó, por arca_log) o, con caeA vacío,
// emitida esperándolo.
func (e *escenario) factura(cliente, pedido *string, tipo string, total float64, cuando, caeA string) string {
	e.n++
	var cae, ambiente *string
	estado := "emitida"
	if caeA != "" {
		c, a := "CAE", "produccion"
		cae, ambiente, estado = &c, &a, "autorizada"
	}
	id := e.id(`insert into invoices (tipo, punto_venta, numero, estado, receptor_nombre, customer_id, order_id, total, neto, fecha_emision, created_at,
		cae, cae_ambiente) values ($1, 9, $2, $3, 'Cliente', $4, $5, $6, round($6 / 1.21, 2), $7, $7, $8, $9) returning id`,
		tipo, e.n, estado, cliente, pedido, total, cuando, cae, ambiente)
	if caeA != "" {
		e.exec(`insert into arca_log (invoice_id, operacion, exito, created_at) values ($1, 'FECAESolicitar', true, $2)`, id, caeA)
	}
	return id
}

// recibo sin reparto fijado (como los de antes), con sus partes.
func (e *escenario) recibo(cliente, pedido *string, cuando string, partes ...[2]any) string {
	e.n++
	total := 0.0
	for _, p := range partes {
		total += p[1].(float64)
	}
	id := e.id(`insert into receipts (numero, recibido_de, total, origen, customer_id, order_id, created_at)
		values ('R-' || $1::int, 'Cliente', $2, 'panel', $3, $4, $5) returning id`, e.n, total, cliente, pedido, cuando)
	for i, p := range partes {
		e.exec(`insert into receipt_parts (receipt_id, medio, importe, orden) values ($1, $2, $3, $4)`, id, p[0], p[1], i)
	}
	return id
}

func (e *escenario) fijarTodos() {
	e.t.Helper()
	if err := pgx.BeginFunc(context.Background(), e.pool, func(tx pgx.Tx) error {
		_, err := FijarRepartosDeAntes(context.Background(), tx)
		return err
	}); err != nil {
		e.t.Fatal(err)
	}
}

// comparar: el reparto con el SQL recortado y sin recortar, de todas las
// cuentas y de cada una, a cada `hasta`.
func (e *escenario) comparar(etapa string) {
	e.t.Helper()
	ctx := context.Background()
	for _, hasta := range []time.Time{
		time.Date(2026, 10, 31, 23, 59, 59, 0, time.FixedZone("ART", -3*3600)),
		time.Date(2026, 11, 30, 23, 59, 59, 0, time.FixedZone("ART", -3*3600)),
		time.Date(9999, 1, 1, 0, 0, 0, 0, time.UTC),
	} {
		con, err := CargarEventos(ctx, e.pool, hasta, "")
		if err != nil {
			e.t.Fatal(err)
		}
		sin, err := cargarDeAntes(ctx, e.pool, hasta, "")
		if err != nil {
			e.t.Fatal(err)
		}
		a, b := RepartirCobros(con), RepartirCobros(sin)
		if !reflect.DeepEqual(a, b) {
			e.t.Errorf("%s, hasta %v: el recorte cambió el reparto\ncon:  %+v\nsin:  %+v", etapa, hasta, a, b)
		}
		if etapa == "sin fijar" && (len(a.Recibos) == 0 || len(a.Aplicaciones) == 0 || len(a.Bolsas) == 0) {
			e.t.Fatalf("%s: al escenario le faltan recibos, aplicaciones o anticipos sin aplicar: %+v", etapa, a)
		}
		for clave := range a.Deudores {
			con, err := CargarEventos(ctx, e.pool, hasta, clave)
			if err != nil {
				e.t.Fatal(err)
			}
			sin, err := cargarDeAntes(ctx, e.pool, hasta, clave)
			if err != nil {
				e.t.Fatal(err)
			}
			if a, b := RepartirCobros(con), RepartirCobros(sin); !reflect.DeepEqual(a, b) {
				e.t.Errorf("%s, %s hasta %v: el recorte cambió el reparto de la cuenta\ncon:  %+v\nsin:  %+v", etapa, clave, hasta, a, b)
			}
		}
	}
}

func TestElRecorteNoCambiaElReparto(t *testing.T) {
	e := &escenario{t: t, pool: pruebas.Base(t)}
	ctx := context.Background()
	cli := e.id(`insert into customers (nombre) values ('Seña y factura') returning id`)
	otro := e.id(`insert into customers (nombre) values ('Cheques') returning id`)

	// La seña de un pedido abierto que se factura después; otra seña del
	// mismo pedido que se anula en noviembre, después de aplicada.
	p1 := e.pedido(&cli, 1000, "2026-09-01T12:00:00Z", "2026-10-10T12:00:00Z")
	sena := e.recibo(&cli, nil, "2026-09-05T12:00:00Z", [2]any{"efectivo", 300.0})
	anulado := e.recibo(&cli, nil, "2026-09-06T12:00:00Z", [2]any{"transferencia", 200.0})
	// Una factura emitida que espera el CAE, y la seña que la espera.
	f2 := e.factura(&cli, nil, "factura_b", 500, "2026-09-20T12:00:00Z", "")
	r2 := e.recibo(&cli, nil, "2026-09-25T12:00:00Z", [2]any{"transferencia", 200.0})
	// La factura del pedido con CAE, y un recibo con retención que la cancela.
	f1 := e.factura(&cli, &p1, "factura_b", 1000, "2026-10-10T12:00:00Z", "2026-10-10T12:05:00Z")
	r3 := e.recibo(&cli, nil, "2026-10-12T12:00:00Z", [2]any{"efectivo", 400.0}, [2]any{"retencion", 50.0})
	e.exec(`update receipts set estado = 'anulado', anulado_at = '2026-11-05T12:00:00Z' where id = $1`, anulado)
	// Devoluciones que le devuelven plata a un recibo: de la factura con CAE
	// (al blanco entero) y de la que espera el CAE (con el reparto).
	d1 := e.id(`insert into devoluciones (clave, order_id, invoice_id, importe, destino, motivo, created_at)
		values ('d1', $1, $2, 100, 'caja', 'x', '2026-10-20T12:00:00Z') returning id`, p1, f1)
	e.exec(`insert into receipt_refunds (receipt_id, devolucion_id, medio, importe, created_at) values ($1, $2, 'efectivo', 100, '2026-10-20T12:00:00Z')`, r3, d1)
	pf2 := e.pedido(&cli, 500, "2026-09-19T12:00:00Z", "")
	e.exec(`update invoices set order_id = $1 where id = $2`, pf2, f2)
	d2 := e.id(`insert into devoluciones (clave, order_id, invoice_id, importe, destino, motivo, created_at)
		values ('d2', $1, $2, 50, 'caja', 'x', '2026-10-21T12:00:00Z') returning id`, pf2, f2)
	e.exec(`insert into receipt_refunds (receipt_id, devolucion_id, medio, importe, created_at) values ($1, $2, 'efectivo', 50, '2026-10-21T12:00:00Z')`, r2, d2)

	// Un recibo con un pago de Mercado Pago que tuvo un reintegro parcial
	// que devolvió deuda a la cuenta (el tramo).
	pago := e.id(`insert into payments (customer_id, tipo, proveedor, proveedor_payment_id, medio, monto, estado, created_at)
		values ($1, 'deuda', 'mercado_pago', 'mp-1', 'mercado_pago', 300, 'aprobado', '2026-10-13T12:00:00Z') returning id`, cli)
	r5 := e.recibo(&cli, nil, "2026-10-13T12:00:00Z", [2]any{"mercado_pago", 300.0})
	e.exec(`update receipt_parts set payment_id = $1 where receipt_id = $2`, pago, r5)
	mov := e.id(`insert into account_movements (customer_id, tipo, monto, created_at) values ($1, 'nota_debito', 80, '2026-10-14T12:00:00Z') returning id`, cli)
	e.exec(`insert into payment_refunds (payment_id, importe, acumulado, account_movement_id, created_at) values ($1, 80, 80, $2, '2026-10-14T12:00:00Z')`, pago, mov)

	// El otro cliente: una venta sin factura cobrada con un cheque B, una
	// factura cobrada con un cheque que rebota y su nota de débito.
	e.pedido(&otro, 700, "2026-09-02T12:00:00Z", "2026-09-03T12:00:00Z")
	cb := e.recibo(&otro, nil, "2026-09-04T12:00:00Z", [2]any{"efectivo", 400.0}, [2]any{"cheque", 300.0})
	chb := e.id(`insert into cheques (sentido, numero, banco, fecha_pago, importe, estado, customer_id, circuito, receipt_id)
		values ('recibido', 'B1', 'Provincia', '2026-10-01', 300, 'cartera', $1, 'negro', $2) returning id`, otro, cb)
	e.exec(`update receipt_parts set cheque_id = $1 where receipt_id = $2 and medio = 'cheque'`, chb, cb)
	e.factura(&otro, nil, "factura_b", 600, "2026-10-01T12:00:00Z", "2026-10-01T12:01:00Z")
	cr := e.recibo(&otro, nil, "2026-10-02T12:00:00Z", [2]any{"cheque", 600.0})
	ch := e.id(`insert into cheques (sentido, numero, banco, fecha_pago, importe, estado, customer_id, circuito, receipt_id)
		values ('recibido', 'R1', 'Nación', '2026-10-20', 600, 'depositado', $1, 'blanco', $2) returning id`, otro, cr)
	e.exec(`update receipt_parts set cheque_id = $1 where receipt_id = $2`, ch, cr)
	e.exec(`update cheques set estado = 'rechazado' where id = $1`, ch)
	e.exec(`update cheque_estados set at = '2026-10-22T12:00:00Z' where cheque_id = $1`, ch)
	e.exec(`insert into account_movements (customer_id, tipo, monto, cheque_id, created_at) values ($1, 'nota_debito', 600, $2, '2026-10-22T12:00:00Z')`, otro, ch)

	// Un pedido sin cliente: la seña antes de facturar («p:») y la factura.
	ps := e.pedido(nil, 900, "2026-10-03T12:00:00Z", "2026-10-08T12:00:00Z")
	e.recibo(nil, &ps, "2026-10-04T12:00:00Z", [2]any{"transferencia", 400.0})
	e.factura(nil, &ps, "factura_b", 900, "2026-10-08T12:00:00Z", "2026-10-08T12:01:00Z")
	e.recibo(nil, &ps, "2026-10-09T12:00:00Z", [2]any{"efectivo", 500.0})

	// Otro pedido sin cliente cuya factura espera el CAE cuando llega el
	// recibo: el destino sale de las facturas del pedido.
	ps2 := e.pedido(nil, 800, "2026-10-03T12:00:00Z", "")
	e.factura(nil, &ps2, "factura_b", 800, "2026-10-04T12:00:00Z", "")
	e.recibo(nil, &ps2, "2026-10-05T12:00:00Z", [2]any{"transferencia", 300.0})

	// Un pedido entregado en septiembre y reabierto en noviembre: en octubre
	// estaba cerrado según el historial, aunque hoy esté abierto. Y otro
	// entregado después del recibo: ese día estaba abierto.
	hist := e.id(`insert into customers (nombre) values ('Historial') returning id`)
	re := e.pedido(&hist, 400, "2026-09-01T12:00:00Z", "2026-09-10T12:00:00Z")
	e.exec(`insert into order_status_history (order_id, estado, created_at) values ($1, 'pendiente', '2026-11-01T12:00:00Z')`, re)
	e.exec(`update orders set estado = 'pendiente' where id = $1`, re)
	e.pedido(&hist, 600, "2026-09-25T12:00:00Z", "2026-10-15T12:00:00Z")
	e.recibo(&hist, nil, "2026-10-01T12:00:00Z", [2]any{"efectivo", 900.0})

	e.comparar("sin fijar")
	e.fijarTodos()
	e.comparar("fijados")

	// Lo fijado no se recalcula aunque hoy daría otra cosa: un pedido nuevo
	// del cliente, abierto antes de sus recibos de septiembre según el
	// historial, y un CAE que llega para la factura que lo esperaba.
	e.pedido(&cli, 2000, "2026-08-01T12:00:00Z", "")
	e.exec(`update invoices set cae = 'CAE', cae_ambiente = 'produccion', estado = 'autorizada' where id = $1`, f2)
	e.exec(`insert into arca_log (invoice_id, operacion, exito, created_at) values ($1, 'FECAESolicitar', true, '2026-11-02T12:00:00Z')`, f2)
	// Un reparto guardado a mano distinto del que daría el cálculo, uno con
	// anticipo de un centavo, uno con anticipo en cero, y uno a medias
	// (reparto_b nulo): ese no está fijado para Go, y tampoco para el SQL.
	e.exec(`update receipts set reparto_deudores = 0, reparto_anticipo = 0, reparto_b = 450 where id = $1`, r3)
	e.exec(`update receipts set reparto_deudores = 0, reparto_anticipo = 0.01, reparto_b = 199.99 where id = $1`, r2)
	e.exec(`update receipts set reparto_deudores = 300, reparto_anticipo = 0.00, reparto_b = 0 where id = $1`, r5)
	// La seña y el del cheque B, a medias: recalculada sin sus pendientes
	// (como con un recorte que solo mirara reparto_deudores), la seña iría
	// al B en vez de a Anticipos.
	e.exec(`update receipts set reparto_anticipo = 0, reparto_b = null where id = $1`, sena)
	e.exec(`update receipts set reparto_b = null where id = $1`, cb)
	// Estado mixto: un recibo nuevo sin fijar después de los fijados, en la
	// misma cuenta.
	nuevo := e.recibo(&cli, nil, "2026-11-10T12:00:00Z", [2]any{"efectivo", 700.0})
	e.comparar("mixto")

	// FijarReparto sobre una cuenta con recibos fijados con y sin anticipo
	// da lo mismo que el cálculo sin recortar.
	ev, err := cargarDeAntes(ctx, e.pool, time.Date(9999, 1, 1, 0, 0, 0, 0, time.UTC), "c:"+cli)
	if err != nil {
		t.Fatal(err)
	}
	esperado := RepartirCobros(ev).Recibos[nuevo]
	var fijado Reparto
	if err := pgx.BeginFunc(ctx, e.pool, func(tx pgx.Tx) error {
		var err error
		fijado, err = FijarReparto(ctx, tx, nuevo)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if fijado != esperado {
		t.Errorf("FijarReparto con el recorte: %+v, sin el recorte: %+v", fijado, esperado)
	}
	e.comparar("después de FijarReparto")
}

// Si un {X} quedara sin reemplazar en alguno de los dos SQL, Postgres daría
// error de sintaxis: con eventosDeUnaClave, ningún recibo se podría emitir.
func TestNoQuedanMarcasEnElSQL(t *testing.T) {
	marca := regexp.MustCompile(`\{[A-Z]\}`)
	for n, sql := range map[string]string{"todas": eventosDeTodas, "una clave": eventosDeUnaClave,
		"pendientes de todas": pendientesDeTodas, "pendientes de un cliente": pendientesDeUnCliente, "pendientes sin cliente": pendientesSinCliente,
		"todas sin recorte": todasSinRecorte, "una clave sin recorte": unaClaveSinRecorte} {
		if m := marca.FindAllString(sql, -1); m != nil {
			t.Errorf("%s: quedan %v", n, m)
		}
	}
}

// PlanDelReparto apaga el JIT y fuerza el plan a medida en la transacción,
// vuelve a los de antes cuando se le pide, y no deja nada en la conexión: el
// pool la reusa para otra cosa.
func TestPlanDelReparto(t *testing.T) {
	pool := pruebas.Base(t)
	ctx := context.Background()
	conn, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Release()
	if _, err := conn.Exec(ctx, `SET jit = on; SET plan_cache_mode = auto`); err != nil {
		t.Fatal(err)
	}
	ajustes := func(q interface {
		QueryRow(context.Context, string, ...any) pgx.Row
	}) string {
		var v string
		if err := q.QueryRow(ctx, `SELECT current_setting('jit') || ' ' || current_setting('plan_cache_mode')`).Scan(&v); err != nil {
			t.Fatal(err)
		}
		return v
	}
	if err := pgx.BeginFunc(ctx, conn, func(tx pgx.Tx) error {
		volver, err := PlanDelReparto(ctx, tx)
		if err != nil {
			return err
		}
		if v := ajustes(tx); v != "off force_custom_plan" {
			t.Errorf("dentro de la transacción: %s", v)
		}
		if err := volver(ctx); err != nil {
			return err
		}
		if v := ajustes(tx); v != "on auto" {
			t.Errorf("después de volver: %s", v)
		}
		_, err = PlanDelReparto(ctx, tx)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if v := ajustes(conn); v != "on auto" {
		t.Errorf("la conexión quedó con %s", v)
	}
}

// Dos cambios del historial en el mismo instante son de una transacción:
// cuenta el cerrado, en el orden que sea.
func TestAbiertoAConCambiosEnElMismoInstante(t *testing.T) {
	a := time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)
	b := a.Add(48 * time.Hour)
	for _, estados := range [][]string{{"entregado", "pendiente"}, {"pendiente", "entregado"}} {
		o := &pedidoPendiente{estado: "pendiente", cambios: []time.Time{a, a, b}, estados: append(estados, "pendiente")}
		if o.abiertoA(a.Add(time.Hour)) {
			t.Errorf("%v: abierto entre los cambios", estados)
		}
		if !o.abiertoA(a.Add(-time.Hour)) {
			t.Errorf("%v: cerrado antes del historial", estados)
		}
		if !o.abiertoA(b.Add(time.Hour)) {
			t.Errorf("%v: cerrado después de reabrirse", estados)
		}
	}
	if deCentavos(123456) != 1234.56 || deCentavos(-5) != -0.05 || deCentavos(0) != 0 || deCentavos(100) != 1 {
		t.Error("deCentavos")
	}
}
