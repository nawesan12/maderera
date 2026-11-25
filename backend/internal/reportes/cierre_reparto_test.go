package reportes

import (
	"context"
	"errors"
	"reflect"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/cobros"
)

// Un solo reparto por vista del cierre: los asientos con el reparto ya
// hecho dan lo mismo que AsientosDelPeriodo, y el control «deudores-mayor»
// saca el mismo saldo de 1.1.03 con solo los asientos que tocan Deudores.

// conDeudores son los asientos que tienen algún renglón en 1.1.03.
func conDeudores(asientos []Asiento) []Asiento {
	var out []Asiento
	for _, a := range asientos {
		for _, r := range a.Renglones {
			if r.Cuenta == Cuentas.Deudores {
				out = append(out, a)
				break
			}
		}
	}
	return out
}

// mismosDeudores compara el armado entero contra asientosDeDeudores: los
// asientos que tocan 1.1.03 son los mismos, en el mismo orden, y el saldo
// del blanco da el mismo número, sin tolerancia.
func mismosDeudores(t *testing.T, s *Servicio, desde, hasta time.Time) {
	t.Helper()
	ctx := context.Background()
	todos, err := s.AsientosDelPeriodo(ctx, desde, hasta)
	if err != nil {
		t.Fatal(err)
	}
	_, ihasta := instantes(desde, hasta)
	reparto, err := s.repartoHasta(ctx, ihasta)
	if err != nil {
		t.Fatal(err)
	}
	deudores, err := s.asientosDeDeudores(ctx, desde, hasta, reparto)
	if err != nil {
		t.Fatal(err)
	}
	if a, b := conDeudores(todos), conDeudores(deudores); !reflect.DeepEqual(a, b) {
		t.Errorf("los asientos de 1.1.03 no son los mismos: %d en el armado entero, %d en asientosDeDeudores", len(a), len(b))
	}
	if a, b := SaldoDeCuenta(DelCircuito(todos, "blanco"), Cuentas.Deudores), SaldoDeCuenta(DelCircuito(deudores, "blanco"), Cuentas.Deudores); a != b {
		t.Errorf("saldo de Deudores: %v con todo, %v con asientosDeDeudores", a, b)
	}
	con, err := s.asientosDelPeriodoCon(ctx, desde, hasta, reparto)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(con, todos) {
		t.Errorf("asientosDelPeriodoCon no da lo mismo que AsientosDelPeriodo (%d contra %d)", len(con), len(todos))
	}
	if len(conDeudores(todos)) == 0 {
		t.Fatal("no hay asientos de Deudores que comparar")
	}
}

func TestLosAsientosDeDeudoresSonLosDelArchivo(t *testing.T) {
	e := armar(t)
	cli := e.id(t, `insert into customers (nombre) values ('Gómez') returning id`)
	prov := e.id(t, `insert into suppliers (nombre) values ('Aserradero del Sur') returning id`)
	pedido := e.pedido(t, "P-1", e.central, "pendiente", "mostrador", time.Date(2026, 9, 1, 12, 0, 0, 0, Argentina), &cli)
	e.exec(t, `update orders set total = 1500 where id = $1`, pedido)
	e.recibir(t, &cli, "R-1", "2026-09-05T15:00:00Z", [2]any{"efectivo", 500.0})
	e.facturaConCae(t, &cli, 40, 1500, "2026-10-05T15:00:00Z", &pedido)
	e.recibir(t, &cli, "R-2", "2026-10-06T15:00:00Z", [2]any{"transferencia", 600.0}, [2]any{"retencion", 30.0})

	// Compras, pagos y gastos, de los dos circuitos: no tocan Deudores.
	e.exec(t, `insert into purchase_invoices (supplier_id, tipo, punto_venta, numero, fecha_emision, neto, iva21, total)
		values ($1, 'factura_a', 1, 7, '2026-10-02', 1000, 210, 1210)`, prov)
	e.exec(t, `insert into supplier_payments (supplier_id, total, neto, medio, fecha, circuito) values
		($1, 1210, 1210, 'transferencia', '2026-10-09T15:00:00Z', 'blanco'), ($1, 300, 300, 'efectivo', '2026-10-09T16:00:00Z', 'negro')`, prov)
	e.exec(t, `insert into expenses (fecha, descripcion, importe, medio, circuito) values ('2026-10-03', 'Flete', 200, 'efectivo', 'blanco'),
		('2026-10-03', 'Flete B', 100, 'efectivo', 'negro')`)

	// Un cheque que rebota de la cartera y uno que rebota después de
	// endosado a un proveedor, los dos con su nota de débito: van contra
	// Deudores (AsientoDeCheque con ADeudores).
	for i, desde := range []string{"cartera", "entregado"} {
		ch := e.id(t, `insert into cheques (sentido, numero, banco, fecha_pago, importe, estado, customer_id) values ('recibido', $1, 'Nación', '2026-10-20', 250, 'cartera', $2) returning id`,
			"C"+desde, cli)
		if desde == "entregado" {
			e.exec(t, `update cheques set estado = 'entregado' where id = $1`, ch)
		}
		e.exec(t, `update cheques set estado = 'rechazado' where id = $1`, ch)
		e.exec(t, `update cheque_estados set at = $2 where cheque_id = $1`, ch, time.Date(2026, 10, 21+i, 15, 0, 0, 0, time.UTC))
		e.exec(t, `insert into account_movements (customer_id, tipo, monto, cheque_id, created_at) values ($1, 'nota_debito', 250, $2, $3)`,
			cli, ch, time.Date(2026, 10, 21+i, 15, 0, 0, 0, time.UTC))
	}

	octubre := PeriodoDelCierre("2026-10", ahoraDePrueba)
	mismosDeudores(t, e.s, octubre.Desde, octubre.Hasta)
	mismosDeudores(t, e.s, time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC), octubre.Hasta)
}

// Las llamadas que reparten hasta el mismo instante mientras otra ya está
// leyendo esperan esa lectura en vez de hacer la suya; otro instante hace la
// suya. El primero que se va no se lleva a los demás: reciben el reparto.
// Y la lectura corre sin JIT y con el plan a medida (cobros.PlanDelReparto).
func TestUnSoloRepartoALaVez(t *testing.T) {
	e := armar(t)
	var lecturas atomic.Int32
	empezo := make(chan struct{}, 10)
	soltar := make(chan struct{})
	e.s.alCargarReparto = func(ctx context.Context, tx pgx.Tx) error {
		var ajustes string
		if err := tx.QueryRow(ctx, `SELECT current_setting('jit') || ' ' || current_setting('plan_cache_mode')`).Scan(&ajustes); err != nil {
			return err
		}
		if ajustes != "off force_custom_plan" {
			t.Errorf("el reparto se lee con %s", ajustes)
		}
		lecturas.Add(1)
		empezo <- struct{}{}
		<-soltar
		return nil
	}
	hasta := time.Date(2026, 10, 31, 23, 59, 59, 0, Argentina)
	ctx := context.Background()

	primero, irse := context.WithCancel(ctx)
	delPrimero := make(chan error, 1)
	go func() {
		_, err := e.s.repartoHasta(primero, hasta)
		delPrimero <- err
	}()
	<-empezo
	demas := make(chan error, 3)
	for range 3 {
		go func() {
			_, err := e.s.repartoHasta(ctx, hasta)
			demas <- err
		}()
	}
	otro := make(chan error, 1)
	go func() {
		_, err := e.s.repartoHasta(ctx, hasta.Add(time.Hour))
		otro <- err
	}()
	<-empezo
	// Que los tres alcancen a sumarse a la lectura en curso.
	time.Sleep(300 * time.Millisecond)
	irse()
	if err := <-delPrimero; !errors.Is(err, context.Canceled) {
		t.Errorf("el que se fue: %v", err)
	}
	close(soltar)
	for range 3 {
		if err := <-demas; err != nil {
			t.Errorf("los que esperaban: %v", err)
		}
	}
	if err := <-otro; err != nil {
		t.Errorf("otro instante: %v", err)
	}
	if n := lecturas.Load(); n != 2 {
		t.Errorf("lecturas: %d, se esperaban 2 (una por instante)", n)
	}
	// Terminada, no queda guardada: la próxima lee de nuevo.
	if _, err := e.s.repartoHasta(ctx, hasta); err != nil {
		t.Fatal(err)
	}
	if n := lecturas.Load(); n != 3 {
		t.Errorf("después de terminar: %d lecturas, se esperaban 3", n)
	}
}

// Los asientos del blanco y los del B que pide la vista a la vez salen de un
// solo armado, y cada uno recibe su lista: lo que uno le hace a la suya no
// le cambia la del otro.
func TestLosAsientosDeLaVistaSeArmanUnaVez(t *testing.T) {
	e := armar(t)
	cli := e.id(t, `insert into customers (nombre) values ('Gómez') returning id`)
	e.facturaConCae(t, &cli, 40, 1000, "2026-10-05T15:00:00Z", nil)
	e.recibir(t, &cli, "R-1", "2026-10-06T15:00:00Z", [2]any{"transferencia", 400.0})
	var lecturas atomic.Int32
	empezo := make(chan struct{}, 10)
	soltar := make(chan struct{})
	e.s.alCargarReparto = func(ctx context.Context, tx pgx.Tx) error {
		lecturas.Add(1)
		empezo <- struct{}{}
		<-soltar
		return nil
	}
	octubre := PeriodoDelCierre("2026-10", ahoraDePrueba)
	ctx := context.Background()
	listas := make(chan []Asiento, 2)
	for range 2 {
		go func() {
			a, err := e.s.AsientosDelPeriodo(ctx, octubre.Desde, octubre.Hasta)
			if err != nil {
				t.Error(err)
			}
			listas <- a
		}()
	}
	<-empezo
	time.Sleep(300 * time.Millisecond)
	close(soltar)
	a, b := <-listas, <-listas
	if n := lecturas.Load(); n != 1 {
		t.Errorf("lecturas del reparto: %d, se esperaba 1", n)
	}
	if len(a) == 0 || !reflect.DeepEqual(a, b) {
		t.Fatalf("las dos listas: %d y %d asientos", len(a), len(b))
	}
	a[0] = Asiento{}
	if reflect.DeepEqual(a[0], b[0]) {
		t.Error("las dos llamadas comparten la lista")
	}
}

// Cuando se va el último que esperaba, el reparto se cancela y no sigue
// ocupando una conexión del pool de los reportes; el que llega después hace
// su propia lectura en vez de sumarse a la cancelada.
func TestElUltimoQueSeVaCancelaElReparto(t *testing.T) {
	e := armar(t)
	var lecturas atomic.Int32
	empezo := make(chan struct{}, 10)
	cancelado := make(chan error, 10)
	e.s.alCargarReparto = func(ctx context.Context, tx pgx.Tx) error {
		if lecturas.Add(1) > 1 {
			return nil
		}
		empezo <- struct{}{}
		select {
		case <-ctx.Done():
			cancelado <- ctx.Err()
			return ctx.Err()
		case <-time.After(10 * time.Second):
			cancelado <- nil
			return nil
		}
	}
	hasta := time.Date(2026, 10, 31, 23, 59, 59, 0, Argentina)
	ctx := context.Background()
	uno, irseUno := context.WithCancel(ctx)
	dos, irseDos := context.WithCancel(ctx)
	errs := make(chan error, 2)
	go func() { _, err := e.s.repartoHasta(uno, hasta); errs <- err }()
	<-empezo
	go func() { _, err := e.s.repartoHasta(dos, hasta); errs <- err }()
	time.Sleep(200 * time.Millisecond)
	irseUno()
	if err := <-errs; !errors.Is(err, context.Canceled) {
		t.Errorf("el primero que se fue: %v", err)
	}
	// Queda uno esperando: el reparto sigue.
	select {
	case err := <-cancelado:
		t.Fatalf("el reparto terminó con uno esperando: %v", err)
	case <-time.After(300 * time.Millisecond):
	}
	irseDos()
	if err := <-errs; !errors.Is(err, context.Canceled) {
		t.Errorf("el último que se fue: %v", err)
	}
	if err := <-cancelado; !errors.Is(err, context.Canceled) {
		t.Errorf("el reparto sin nadie que lo espere: %v, se esperaba que se cancelara", err)
	}
	if _, err := e.s.repartoHasta(ctx, hasta); err != nil {
		t.Fatal(err)
	}
	if n := lecturas.Load(); n != 2 {
		t.Errorf("lecturas: %d, se esperaban 2", n)
	}
}

// Lo que se emite o se anula después de la foto del reparto queda para la
// próxima lectura, igual que en el reparto: el cierre del mes no da error
// y el saldo de 1.1.03 sigue dando lo que suman las cuentas.
func TestLoDeDespuesDeLaFotoQuedaParaLaProxima(t *testing.T) {
	e := armar(t)
	cli := e.id(t, `insert into customers (nombre) values ('Gómez') returning id`)
	pedido := e.pedido(t, "P-1", e.central, "pendiente", "mostrador", time.Date(2026, 9, 1, 12, 0, 0, 0, Argentina), &cli)
	e.exec(t, `update orders set total = 1500 where id = $1`, pedido)
	sena := e.recibir(t, &cli, "R-1", "2026-09-05T15:00:00Z", [2]any{"efectivo", 500.0})
	e.facturaConCae(t, &cli, 40, 1500, "2026-10-05T15:00:00Z", &pedido)
	e.recibir(t, &cli, "R-2", "2026-10-06T15:00:00Z", [2]any{"transferencia", 600.0})

	ctx := context.Background()
	octubre := PeriodoDelCierre("2026-10", ahoraDePrueba)
	_, ihasta := instantes(octubre.Desde, octubre.Hasta)
	foto, err := e.s.repartoHasta(ctx, ihasta)
	if err != nil {
		t.Fatal(err)
	}
	saldo := func(reparto cobros.ResultadoDelReparto) (mayor, listado float64, n int) {
		t.Helper()
		todos, err := e.s.asientosDeDeudores(ctx, time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC), octubre.Hasta, reparto)
		if err != nil {
			t.Fatal(err)
		}
		for _, d := range reparto.Deudores {
			listado = float64(listado + d)
		}
		return redondear(SaldoDeCuenta(DelCircuito(todos, "blanco"), Cuentas.Deudores)), redondear(listado), len(todos)
	}
	mayor, listado, antes := saldo(foto)
	if mayor != listado {
		t.Fatalf("de entrada: mayor %v, listado %v", mayor, listado)
	}

	// Después de la foto: la seña se anula y sale otro recibo, los dos en
	// octubre.
	e.exec(t, `update receipts set estado = 'anulado', anulado_at = '2026-10-20T15:00:00Z', motivo_anulacion = 'prueba' where id = $1`, sena)
	e.recibir(t, &cli, "R-3", "2026-10-25T15:00:00Z", [2]any{"efectivo", 200.0})
	mayor, listado, n := saldo(foto)
	if mayor != listado || n != antes {
		t.Errorf("con la foto de antes: mayor %v, listado %v, %d asientos (eran %d)", mayor, listado, n, antes)
	}
	// La próxima lectura los ve.
	nuevo, err := e.s.repartoHasta(ctx, ihasta)
	if err != nil {
		t.Fatal(err)
	}
	if !nuevo.Anulados[sena] {
		t.Error("el reparto nuevo no ve la anulación")
	}
	mayor, listado, n = saldo(nuevo)
	if mayor != listado || n <= antes {
		t.Errorf("con el reparto nuevo: mayor %v, listado %v, %d asientos (eran %d)", mayor, listado, n, antes)
	}
}
