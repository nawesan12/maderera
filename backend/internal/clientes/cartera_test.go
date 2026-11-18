package clientes

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"math/rand/v2"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/cobros"
	"mjbj/internal/pruebas"
)

// La cartera con el padrón de ISIS: «Por cobrar» con tope, «Al día» de a
// páginas, y los totales siempre de todos.

var silencio = slog.New(slog.NewTextHandler(io.Discard, nil))

var hoyDeLaCartera = time.Date(2026, 11, 18, 15, 0, 0, 0, time.UTC)

// cliente da de alta un cliente con estos movimientos (monto, días atrás).
func cliente(t *testing.T, pool *pgxpool.Pool, nombre, rubro string, movimientos ...[2]float64) string {
	t.Helper()
	ctx := context.Background()
	var id string
	if err := pool.QueryRow(ctx, `insert into customers (nombre, rubro) values ($1, nullif($2, '')) returning id`, nombre, rubro).Scan(&id); err != nil {
		t.Fatal(err)
	}
	for _, m := range movimientos {
		tipo := "compra"
		if m[0] < 0 {
			tipo = "pago"
		}
		if _, err := pool.Exec(ctx, `insert into account_movements (customer_id, tipo, monto, created_at) values ($1, $2, $3, $4)`,
			id, tipo, fmt.Sprintf("%.2f", m[0]), hoyDeLaCartera.AddDate(0, 0, -int(m[1]))); err != nil {
			t.Fatal(err)
		}
	}
	return id
}

func TestCarteraPaginada(t *testing.T) {
	pool := pruebas.Base(t)
	ctx := context.Background()
	s := Nuevo(pool, silencio)
	// 40 al día —de ellos diez con el mismo nombre, como trae ISIS— y 35
	// que deben.
	for i := range 40 {
		nombre := fmt.Sprintf("Al día %02d", i)
		if i < 10 {
			nombre = "Repetido"
		}
		rubro := "carpinteria"
		if i%2 == 0 {
			rubro = "constructora"
		}
		cliente(t, pool, nombre, rubro, [2]float64{1000, 40}, [2]float64{-1000, 30})
	}
	for i := range 35 {
		rubro := "carpinteria"
		if i%5 == 0 {
			rubro = "constructora"
		}
		cliente(t, pool, fmt.Sprintf("Debe %02d", i), rubro, [2]float64{float64(100 * (i + 1)), float64(i * 3)})
	}

	c, err := s.Listar(ctx, FiltrosDeClientes{}, hoyDeLaCartera)
	if err != nil {
		t.Fatal(err)
	}
	if len(c.AlDia) != 30 || c.TotalAlDia != 40 || len(c.PorCobrar) != 35 || c.CantidadDeudores != 35 {
		t.Fatalf("página 1: %d de %d al día, %d deudores", len(c.AlDia), c.TotalAlDia, len(c.PorCobrar))
	}
	// Las páginas no se pisan aunque los nombres se repitan: el id desempata.
	vistos := map[string]bool{}
	for p := 1; p <= 2; p++ {
		c, err := s.Listar(ctx, FiltrosDeClientes{Pagina: p}, hoyDeLaCartera)
		if err != nil {
			t.Fatal(err)
		}
		for _, x := range c.AlDia {
			if vistos[x.ID] {
				t.Errorf("%s salió en dos páginas", x.Nombre)
			}
			vistos[x.ID] = true
		}
	}
	if len(vistos) != 40 {
		t.Errorf("entre las dos páginas: %d", len(vistos))
	}
	// Una página que se pasó del final vuelve vacía, con el total.
	c, err = s.Listar(ctx, FiltrosDeClientes{Pagina: 99999}, hoyDeLaCartera)
	if err != nil || len(c.AlDia) != 0 || c.TotalAlDia != 40 {
		t.Errorf("página 99999: %d de %d, %v", len(c.AlDia), c.TotalAlDia, err)
	}
	// Cero o negativa es la primera.
	for _, p := range []int{0, -1} {
		c, err = s.Listar(ctx, FiltrosDeClientes{Pagina: p}, hoyDeLaCartera)
		if err != nil || len(c.AlDia) != 30 {
			t.Errorf("página %d: %d, %v", p, len(c.AlDia), err)
		}
	}
	// El rubro filtra los dos grupos.
	c, err = s.Listar(ctx, FiltrosDeClientes{Rubro: "constructora"}, hoyDeLaCartera)
	if err != nil || c.TotalAlDia != 20 || c.CantidadDeudores != 7 || len(c.PorCobrar) != 7 {
		t.Errorf("por rubro: %d al día, %d deudores, %v", c.TotalAlDia, c.CantidadDeudores, err)
	}
	// Lo comprado viaja con la página.
	for _, x := range c.AlDia {
		if x.Deuda != nil {
			t.Errorf("%s está al día y tiene deuda", x.Nombre)
		}
	}
}

// Con más de 60 deudores viajan los 60 más urgentes, y los totales son de
// todos: se comparan contra la cuenta de antes —todos los movimientos de
// todos, CalcularAging y la suma en el orden por nombre—, no contra la misma
// consulta nueva.
func TestCarteraConMuchosDeudores(t *testing.T) {
	pool := pruebas.Base(t)
	ctx := context.Background()
	s := Nuevo(pool, silencio)
	azar := rand.New(rand.NewPCG(7, 33))
	for i := range 75 {
		var movs [][2]float64
		dias := 400.0
		for range 2 + azar.IntN(8) {
			dias -= float64(azar.IntN(60))
			monto := float64(azar.IntN(90000)+100) + float64(azar.IntN(100))/100
			if azar.IntN(3) == 0 {
				monto = -monto
			}
			movs = append(movs, [2]float64{monto, max(dias, 0)})
		}
		// Uno de cada tres paga todo en algún momento y vuelve a comprar:
		// el aging tiene que salir igual empezando desde ese cero.
		if i%3 == 0 {
			saldo := 0.0
			for _, m := range movs {
				saldo += m[0]
			}
			movs = append(movs, [2]float64{-saldo, 5}, [2]float64{1500, 4}, [2]float64{1500, 4})
		}
		cliente(t, pool, fmt.Sprintf("Cliente %02d", i), "", movs...)
	}
	// Un saldo a favor de un centavo está al día; uno de un centavo debe.
	cliente(t, pool, "A favor", "", [2]float64{100, 10}, [2]float64{-100.01, 9})
	cliente(t, pool, "Un centavo", "", [2]float64{100.01, 10}, [2]float64{-100, 9})

	esperado := cuentaDeAntes(t, pool)
	c, err := s.Listar(ctx, FiltrosDeClientes{}, hoyDeLaCartera)
	if err != nil {
		t.Fatal(err)
	}
	if c.CantidadDeudores != len(esperado.deudores) || c.DeudaTotal != esperado.deuda || c.VencidoTotal != esperado.vencido {
		t.Fatalf("totales: %d %v %v, antes %d %v %v", c.CantidadDeudores, c.DeudaTotal, c.VencidoTotal,
			len(esperado.deudores), esperado.deuda, esperado.vencido)
	}
	if c.CantidadDeudores <= DeudoresVisibles || len(c.PorCobrar) != DeudoresVisibles {
		t.Fatalf("hacen falta más de 60 deudores: %d (viajaron %d)", c.CantidadDeudores, len(c.PorCobrar))
	}
	todos, err := s.Listar(ctx, FiltrosDeClientes{TodosLosDeudores: true}, hoyDeLaCartera)
	if err != nil || len(todos.PorCobrar) != c.CantidadDeudores {
		t.Fatalf("todos los deudores: %d, %v", len(todos.PorCobrar), err)
	}
	for i, x := range todos.PorCobrar {
		antes := esperado.deudores[x.ID]
		if antes == nil {
			t.Errorf("%s no debía", x.Nombre)
			continue
		}
		if x.Deuda.Vencido != antes.Vencido || dias(x.Deuda.DiasDeLaMasVieja) != dias(antes.DiasDeLaMasVieja) ||
			x.Deuda.Prioridad != antes.Prioridad {
			t.Errorf("%s: %+v (%s días), antes %+v (%s días)", x.Nombre, *x.Deuda, dias(x.Deuda.DiasDeLaMasVieja), *antes, dias(antes.DiasDeLaMasVieja))
		}
		if i > 0 && todos.PorCobrar[i-1].Deuda.Prioridad.Puntaje < x.Deuda.Prioridad.Puntaje {
			t.Errorf("%s está debajo de uno menos urgente", x.Nombre)
		}
		if i < DeudoresVisibles && c.PorCobrar[i].ID != x.ID {
			t.Errorf("el %d de los 60 no es el %d de todos", i, i)
		}
	}
	for _, x := range c.AlDia {
		if x.Nombre == "Un centavo" {
			t.Error("el que debe un centavo está al día")
		}
	}
	if _, ok := esperado.deudores[idDe(t, pool, "A favor")]; ok {
		t.Error("el saldo a favor cuenta como deuda")
	}
}

type cuentaVieja struct {
	deudores       map[string]*DeudaDeCliente
	deuda, vencido float64
}

// cuentaDeAntes es la cartera como la hacía la versión anterior: el saldo de
// cada cliente, y de cada deudor todos sus movimientos.
func cuentaDeAntes(t *testing.T, pool *pgxpool.Pool) cuentaVieja {
	t.Helper()
	ctx := context.Background()
	filas, err := pool.Query(ctx, `SELECT c.id::text, coalesce(sum(m.monto), 0)::float8, c.dias_credito, c.cuenta_bloqueada
		FROM customers c LEFT JOIN account_movements m ON m.customer_id = c.id GROUP BY c.id ORDER BY c.nombre, c.id`)
	if err != nil {
		t.Fatal(err)
	}
	type fila struct {
		ID        string
		Saldo     float64
		Dias      int32
		Bloqueada bool
	}
	cs, err := pgx.CollectRows(filas, pgx.RowToStructByPos[fila])
	if err != nil {
		t.Fatal(err)
	}
	out := cuentaVieja{deudores: map[string]*DeudaDeCliente{}}
	for _, c := range cs {
		if c.Saldo <= 0 {
			continue
		}
		movs, err := pool.Query(ctx, `SELECT monto::float8, created_at FROM account_movements WHERE customer_id = $1 ORDER BY created_at, id`, c.ID)
		if err != nil {
			t.Fatal(err)
		}
		ms, err := pgx.CollectRows(movs, pgx.RowToStructByPos[cobros.Movimiento])
		if err != nil {
			t.Fatal(err)
		}
		a := cobros.CalcularAging(ms, hoyDeLaCartera)
		vencido := 0.0
		for _, tr := range a.Tramos {
			if tr.Desde > int(c.Dias) {
				vencido += tr.Monto
			}
		}
		out.deudores[c.ID] = &DeudaDeCliente{Vencido: vencido, DiasDeLaMasVieja: a.DiasDeLaMasVieja,
			Prioridad: cobros.PrioridadDeCobranza(cobros.Deuda{Vencido: vencido, DiasDeLaMasVieja: a.DiasDeLaMasVieja,
				DiasCredito: int(c.Dias), Bloqueada: c.Bloqueada})}
		out.deuda += c.Saldo
		out.vencido += vencido
	}
	return out
}

func idDe(t *testing.T, pool *pgxpool.Pool, nombre string) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(), `select id from customers where nombre = $1`, nombre).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func dias(d *int) string {
	if d == nil {
		return "sin"
	}
	return fmt.Sprint(*d)
}
