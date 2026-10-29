package pedidos

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"sync"
	"testing"

	"mjbj/internal/auth"
	"mjbj/internal/plataforma"
	"mjbj/internal/sqlc"
)

// Las carreras que el TS tenía y Go no. Cada una se corrió sin el arreglo
// (sin el FOR UPDATE de la fila, o sin el candado de la serie) y falló: ver
// docs/go/progreso.md, tanda 5.

func aLaVez(n int, f func(i int)) {
	var wg sync.WaitGroup
	listos := make(chan struct{})
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-listos
			f(i)
		}(i)
	}
	close(listos)
	wg.Wait()
}

// presupuesto carga uno con `cantidad` de la placa y devuelve su id.
func (e *entorno) presupuesto(t *testing.T, ses *auth.Sesion, cantidad float64) string {
	t.Helper()
	alta := e.alta("Concurrencia", cantidad, nil)
	r, err := e.s.CrearPresupuesto(context.Background(), ses, alta["cabecera"].(map[string]any), alta["lineas"].([]any), false)
	if err != nil {
		t.Fatal(err)
	}
	return r.ID
}

func (e *entorno) pedido(t *testing.T, ses *auth.Sesion, cantidad float64) string {
	t.Helper()
	r, err := e.s.ConvertirEnPedido(context.Background(), ses, e.presupuesto(t, ses, cantidad))
	if err != nil {
		t.Fatal(err)
	}
	return r.ID
}

func esProblema(err error, estado int) bool {
	var p *plataforma.Problema
	return errors.As(err, &p) && p.Estado == estado
}

// Veinte presupuestos distintos pasan a pedido a la vez: veinte números
// seguidos, sin huecos ni repetidos (el candado de la serie de pedidos).
func TestConversionesSimultaneasNumeranSinHuecos(t *testing.T) {
	e := armar(t)
	_, ses := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	ids := make([]string, 20)
	for i := range ids {
		ids[i] = e.presupuesto(t, ses, 1)
	}
	numeros := make([]string, 20)
	errs := make([]error, 20)
	aLaVez(20, func(i int) {
		r, err := e.s.ConvertirEnPedido(context.Background(), ses, ids[i])
		errs[i] = err
		if err == nil {
			numeros[i] = r.Numero
		}
	})
	for _, err := range errs {
		if err != nil {
			t.Fatalf("una conversión falló: %v", err)
		}
	}
	sort.Slice(numeros, func(a, b int) bool { return numeros[a] < numeros[b] })
	for i, n := range numeros {
		if want := fmt.Sprintf("PED-%d", 1000+i); n != want {
			t.Fatalf("números: %v", numeros)
		}
	}
	if r := e.reservado(t, e.placa); r != 20 {
		t.Errorf("reservado: %v", r)
	}
}

// La misma conversión diez veces a la vez da un solo pedido, y la
// mercadería se reserva una vez. En el TS el «ya existe» se miraba afuera de
// la transacción: salían varios pedidos del mismo presupuesto.
func TestLaMismaConversionDosVecesEsUnPedido(t *testing.T) {
	e := armar(t)
	_, ses := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	id := e.presupuesto(t, ses, 4)
	var mu sync.Mutex
	bien, repetidos := 0, 0
	aLaVez(10, func(int) {
		_, err := e.s.ConvertirEnPedido(context.Background(), ses, id)
		mu.Lock()
		defer mu.Unlock()
		switch {
		case err == nil:
			bien++
		case esProblema(err, 422):
			repetidos++
		default:
			t.Errorf("error inesperado: %v", err)
		}
	})
	if n := e.numero(t, `select count(*) from orders where quote_id = $1`, id); n != 1 || bien != 1 || repetidos != 9 {
		t.Fatalf("pedidos: %v (bien %d, repetidos %d)", n, bien, repetidos)
	}
	if r := e.reservado(t, e.placa); r != 4 {
		t.Errorf("reservado: %v, tendría que ser 4", r)
	}
}

// Diez cancelaciones del mismo pedido a la vez liberan una sola vez. Otro
// pedido reserva la misma placa: si se liberara dos veces, se comería su
// reserva (el tope en cero no lo taparía).
func TestCancelarDosVecesLiberaUnaSola(t *testing.T) {
	e := armar(t)
	_, ses := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	e.pedido(t, ses, 10)
	id := e.pedido(t, ses, 3)
	if r := e.reservado(t, e.placa); r != 13 {
		t.Fatalf("reservado al empezar: %v", r)
	}
	aLaVez(10, func(int) {
		_, err := e.s.Cancelar(context.Background(), ses, id, nil)
		if err != nil && !esProblema(err, 422) {
			t.Errorf("error inesperado: %v", err)
		}
	})
	if r := e.reservado(t, e.placa); r != 10 {
		t.Errorf("reservado: %v, tendría que ser 10", r)
	}
	if n := e.numero(t, `select count(*) from order_status_history where order_id = $1 and estado = 'cancelado'`, id); n != 1 {
		t.Errorf("cancelaciones en el historial: %v", n)
	}
}

// Avanzar y cancelar a la vez: o se cancela un pedido ya avanzado, o el
// avance llega tarde y se rechaza. Nunca un pedido vivo con la mercadería
// liberada (el TS leía el estado afuera de la transacción y el avance pisaba
// la cancelación).
func TestAvanzarYCancelarALaVez(t *testing.T) {
	e := armar(t)
	_, ses := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	for vuelta := 0; vuelta < 15; vuelta++ {
		id := e.pedido(t, ses, 1)
		aLaVez(2, func(i int) {
			var err error
			if i == 0 {
				_, err = e.s.Avanzar(context.Background(), ses, id)
			} else {
				_, err = e.s.Cancelar(context.Background(), ses, id, nil)
			}
			if err != nil && !esProblema(err, 422) {
				t.Errorf("error inesperado: %v", err)
			}
		})
		var estado string
		_ = e.pool.QueryRow(context.Background(), `select estado::text from orders where id = $1`, id).Scan(&estado)
		activas := e.numero(t, `select count(*) from stock_reservations where order_id = $1 and estado = 'activa'`, id)
		if (estado == "cancelado") != (activas == 0) {
			t.Fatalf("vuelta %d: el pedido quedó %s con %v reservas activas", vuelta, estado, activas)
		}
	}
	if r := e.reservado(t, e.placa); r != 0 {
		t.Errorf("reservado al final: %v", r)
	}
}

// Tres «avanzar» a la vez sobre un pedido de retiro: cada estado una sola
// vez en el historial (en el TS, tres veces «preparando»).
func TestAvanzarALaVezNoRepiteEstados(t *testing.T) {
	e := armar(t)
	_, ses := e.staff(t, "deposito@prueba.test", sqlc.StaffRoleDeposito)
	_, ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	id := e.pedido(t, ven, 1)
	aLaVez(3, func(int) {
		if _, err := e.s.Avanzar(context.Background(), ses, id); err != nil {
			t.Errorf("avanzar: %v", err)
		}
	})
	filas, _ := e.pool.Query(context.Background(), `select estado::text from order_status_history where order_id = $1 order by created_at`, id)
	var estados []string
	for filas.Next() {
		var s string
		_ = filas.Scan(&s)
		estados = append(estados, s)
	}
	filas.Close()
	if fmt.Sprint(estados) != "[pendiente preparando listo entregado]" {
		t.Errorf("historial: %v", estados)
	}
}
