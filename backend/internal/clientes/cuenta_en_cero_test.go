package clientes

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/pruebas"
)

// ceroDeLaFicha es lo que el trigger de la 00201 guardó en cada cliente.
func ceroDeLaFicha(t *testing.T, pool *pgxpool.Pool) map[string]string {
	t.Helper()
	filas, err := pool.Query(context.Background(), `SELECT id::text, coalesce(cuenta_en_cero_id::text, '') FROM customers`)
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]string{}
	var id, cero string
	if _, err := pgx.ForEachRow(filas, []any{&id, &cero}, func() error { out[id] = cero; return nil }); err != nil {
		t.Fatal(err)
	}
	return out
}

// ceroDesdeElPrincipio es el último cero calculado sobre la cuenta entera,
// como lo buscaba la ventana de antes.
func ceroDesdeElPrincipio(t *testing.T, pool *pgxpool.Pool) map[string]string {
	t.Helper()
	filas, err := pool.Query(context.Background(), `
		SELECT c.id::text, coalesce(z.id::text, '') FROM customers c LEFT JOIN (
		  SELECT DISTINCT ON (customer_id) customer_id, id FROM (
		    SELECT customer_id, created_at, id, sum(monto) OVER (PARTITION BY customer_id ORDER BY created_at, id) AS acumulado
		    FROM account_movements) m
		  WHERE acumulado = 0 ORDER BY customer_id, created_at DESC, id DESC) z ON z.customer_id = c.id`)
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]string{}
	var id, cero string
	if _, err := pgx.ForEachRow(filas, []any{&id, &cero}, func() error { out[id] = cero; return nil }); err != nil {
		t.Fatal(err)
	}
	return out
}

// saldoCorridoDistinto lista las fichas en las que el saldo y el último
// movimiento guardados (00202) no son los de la cuenta entera.
func saldoCorridoDistinto(t *testing.T, pool *pgxpool.Pool) []string {
	t.Helper()
	filas, err := pool.Query(context.Background(), `
		SELECT c.nombre || ': guardado ' || c.cuenta_saldo || ' ' || coalesce(c.cuenta_ultimo_id::text, '-') ||
		       ', cuenta ' || coalesce(z.saldo, 0) || ' ' || coalesce(z.id::text, '-')
		FROM customers c LEFT JOIN (
		  SELECT DISTINCT ON (customer_id) customer_id, id, sum(monto) OVER (PARTITION BY customer_id) AS saldo
		  FROM account_movements ORDER BY customer_id, created_at DESC, id DESC) z ON z.customer_id = c.id
		WHERE (c.cuenta_saldo, c.cuenta_ultimo_id) IS DISTINCT FROM (coalesce(z.saldo, 0), z.id)`)
	if err != nil {
		t.Fatal(err)
	}
	out, err := pgx.CollectRows(filas, pgx.RowTo[string])
	if err != nil {
		t.Fatal(err)
	}
	return out
}

// mismaCartera compara el cero, el saldo y el último movimiento guardados
// contra los calculados, y la cartera contra la cuenta de antes (todos los
// movimientos de todos).
func mismaCartera(t *testing.T, pool *pgxpool.Pool, s *Servicio, paso string) {
	t.Helper()
	guardado, calculado := ceroDeLaFicha(t, pool), ceroDesdeElPrincipio(t, pool)
	for id, c := range calculado {
		if guardado[id] != c {
			t.Errorf("%s: el cero de %s es %q y la cuenta dice %q", paso, id, guardado[id], c)
		}
	}
	for _, d := range saldoCorridoDistinto(t, pool) {
		t.Errorf("%s: %s", paso, d)
	}
	esperado := cuentaDeAntes(t, pool)
	c, err := s.Listar(context.Background(), FiltrosDeClientes{}, hoyDeLaCartera)
	if err != nil {
		t.Fatal(err)
	}
	if c.CantidadDeudores != len(esperado.deudores) || c.DeudaTotal != esperado.deuda || c.VencidoTotal != esperado.vencido {
		t.Fatalf("%s: %d %v %v, antes %d %v %v", paso, c.CantidadDeudores, c.DeudaTotal, c.VencidoTotal,
			len(esperado.deudores), esperado.deuda, esperado.vencido)
	}
	for _, x := range c.PorCobrar {
		antes := esperado.deudores[x.ID]
		if antes == nil || x.Deuda.Vencido != antes.Vencido || dias(x.Deuda.DiasDeLaMasVieja) != dias(antes.DiasDeLaMasVieja) ||
			x.Deuda.Prioridad != antes.Prioridad {
			t.Errorf("%s: %s %+v, antes %+v", paso, x.Nombre, *x.Deuda, antes)
		}
	}
}

// El último saldo cero de cada cliente lo mantiene un trigger: con cada
// forma en que se escribe la cuenta corriente, el cero guardado es el de la
// cuenta entera y la cartera da lo mismo que sumando todo.
func TestCuentaEnCeroSeMantiene(t *testing.T) {
	pool := pruebas.Base(t)
	ctx := context.Background()
	s := Nuevo(pool, silencio)
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	movimiento := func(cliente string, monto float64, dias int) string {
		t.Helper()
		var id string
		if err := pool.QueryRow(ctx, `insert into account_movements (customer_id, tipo, monto, created_at) values ($1, 'ajuste', $2, $3) returning id`,
			cliente, monto, hoyDeLaCartera.AddDate(0, 0, -dias)).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	// Paga todo y vuelve a comprar: el cero es el pago.
	ana := cliente(t, pool, "Ana", "", [2]float64{1000, 90}, [2]float64{-1000, 60}, [2]float64{500, 20})
	// Nunca llegó a cero.
	beto := cliente(t, pool, "Beto", "", [2]float64{700, 100}, [2]float64{-200, 50})
	// Al día.
	cliente(t, pool, "Carla", "", [2]float64{300, 40}, [2]float64{-300, 30})
	mismaCartera(t, pool, s, "altas")

	// Un pago con fecha vieja, antes del cero: se recorre la cuenta entera.
	movimiento(ana, -100, 75)
	mismaCartera(t, pool, s, "pago con fecha vieja")
	// Y lo que lo compensa, al final: un cero nuevo.
	movimiento(ana, -400, 10)
	mismaCartera(t, pool, s, "un cero nuevo al final")

	// Varios clientes en una sola sentencia, fuera de orden.
	exec(`insert into account_movements (customer_id, tipo, monto, created_at) values
		($1, 'pago', -500, $3), ($2, 'compra', 50, $4), ($1, 'compra', 80, $5)`,
		beto, ana, hoyDeLaCartera.AddDate(0, 0, -5), hoyDeLaCartera.AddDate(0, 0, -3), hoyDeLaCartera.AddDate(0, 0, -1))
	mismaCartera(t, pool, s, "varios en una sentencia")

	// Cambiar el monto mueve el cero; cambiar el detalle no toca nada.
	pago := movimiento(beto, -80, 0)
	mismaCartera(t, pool, s, "beto en cero")
	exec(`update account_movements set monto = -79 where id = $1`, pago)
	mismaCartera(t, pool, s, "cambió el monto")
	exec(`update account_movements set detalle = 'corregido' where customer_id = $1`, beto)
	mismaCartera(t, pool, s, "cambió el detalle")

	// Borrar el movimiento del cero (la baja de una factura borra).
	var cero string
	if err := pool.QueryRow(ctx, `select cuenta_en_cero_id::text from customers where id = $1`, ana).Scan(&cero); err != nil || cero == "" {
		t.Fatalf("ana sin cero: %v", err)
	}
	exec(`delete from account_movements where id = $1`, cero)
	mismaCartera(t, pool, s, "borrado el cero")

	// Unir dos fichas mueve la cuenta de una a la otra.
	exec(`update account_movements set customer_id = $1 where customer_id = $2`, beto, ana)
	mismaCartera(t, pool, s, "unión de fichas")

	// Borrar lo último de una cuenta sin cero (la baja de la última
	// factura): el último pasa a ser el anterior.
	carla := cliente(t, pool, "Carla bis", "", [2]float64{200, 9}, [2]float64{300, 8})
	var ultimo string
	if err := pool.QueryRow(ctx, `select cuenta_ultimo_id::text from customers where id = $1`, carla).Scan(&ultimo); err != nil {
		t.Fatal(err)
	}
	exec(`delete from account_movements where id = $1`, ultimo)
	mismaCartera(t, pool, s, "borrado el último")
	exec(`delete from account_movements where customer_id = $1`, carla)
	mismaCartera(t, pool, s, "cuenta vacía")
}

// filasLeidas es lo que la transacción en curso leyó de account_movements,
// por índice o recorriendo la tabla. Solo hay contadores por transacción de
// la tabla, así que quien mide apaga el index-only scan (que no pasa por la
// tabla y no se contaría).
func filasLeidas(t *testing.T, tx pgx.Tx) int64 {
	t.Helper()
	var n int64
	if err := tx.QueryRow(context.Background(), `
		SELECT coalesce((SELECT seq_tup_read + coalesce(idx_tup_fetch, 0) FROM pg_stat_xact_user_tables WHERE relname = 'account_movements'), 0)`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// Un movimiento al final de una cuenta que nunca llegó a cero no recorre la
// cuenta: parte del saldo guardado (00202). Con la 00201 leía los 3.000
// movimientos de la constructora en cada venta y cada cobro, con la ficha
// bloqueada. Uno con fecha vieja sí recorre, y eso prueba que la medida mide.
func TestCuentaEnCeroNoRecorreLaCuenta(t *testing.T) {
	pool := pruebas.Base(t)
	ctx := context.Background()
	s := Nuevo(pool, silencio)
	id := cliente(t, pool, "Constructora", "")
	if _, err := pool.Exec(ctx, `insert into account_movements (customer_id, tipo, monto, created_at)
		select $1, 'ajuste', case when g % 2 = 0 then 1000 else -900 end, $2::timestamptz + g * interval '1 hour'
		from generate_series(1, 3000) g`, id, hoyDeLaCartera.AddDate(-1, 0, 0)); err != nil {
		t.Fatal(err)
	}
	mismaCartera(t, pool, s, "la constructora")

	leidas := func(cuando time.Time) int64 {
		t.Helper()
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback(ctx)
		if _, err := tx.Exec(ctx, `set local enable_indexonlyscan = off`); err != nil {
			t.Fatal(err)
		}
		antes := filasLeidas(t, tx)
		if _, err := tx.Exec(ctx, `insert into account_movements (customer_id, tipo, monto, created_at) values ($1, 'compra', 500, $2)`,
			id, cuando); err != nil {
			t.Fatal(err)
		}
		despues := filasLeidas(t, tx)
		if err := tx.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		return despues - antes
	}
	if n := leidas(hoyDeLaCartera); n > 10 {
		t.Errorf("una venta al final leyó %d movimientos; tiene que leer solo el nuevo", n)
	}
	mismaCartera(t, pool, s, "una venta al final")
	if n := leidas(hoyDeLaCartera.AddDate(-2, 0, 0)); n < 3000 {
		t.Errorf("una venta con fecha vieja leyó %d movimientos; tiene que recorrer la cuenta", n)
	}
	mismaCartera(t, pool, s, "una venta con fecha vieja")
}

// Dos movimientos del mismo cliente a la vez: el segundo espera al primero y
// ve lo que escribió. Sin el candado, el pago de 100 sumado sin la compra de
// 50 que todavía no se confirmaba dejaba un cero que no existe, y la cartera
// perdía esa compra.
func TestCuentaEnCeroConDosALaVez(t *testing.T) {
	pool := pruebas.Base(t)
	ctx := context.Background()
	s := Nuevo(pool, silencio)
	id := cliente(t, pool, "Dora", "", [2]float64{100, 30})
	a, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Rollback(ctx)
	if _, err := a.Exec(ctx, `insert into account_movements (customer_id, tipo, monto, created_at) values ($1, 'compra', 50, $2)`,
		id, hoyDeLaCartera.AddDate(0, 0, -2)); err != nil {
		t.Fatal(err)
	}
	listo := make(chan error, 1)
	go func() {
		_, err := pool.Exec(ctx, `insert into account_movements (customer_id, tipo, monto, created_at) values ($1, 'pago', -100, $2)`,
			id, hoyDeLaCartera.AddDate(0, 0, -1))
		listo <- err
	}()
	select {
	case err := <-listo:
		t.Fatalf("el segundo no esperó al primero: %v", err)
	case <-time.After(300 * time.Millisecond):
	}
	if err := a.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err := <-listo; err != nil {
		t.Fatal(err)
	}
	mismaCartera(t, pool, s, "dos a la vez")
	var cero *string
	if err := pool.QueryRow(ctx, `select cuenta_en_cero_id::text from customers where id = $1`, id).Scan(&cero); err != nil || cero != nil {
		t.Errorf("Dora debe 50 y nunca estuvo en cero: %v %v", cero, err)
	}
}
