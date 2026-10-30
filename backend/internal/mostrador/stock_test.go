package mostrador

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/entregas"
	"mjbj/internal/pedidos"
	"mjbj/internal/plataforma"
	"mjbj/internal/reservas"
	"mjbj/internal/sqlc"
	"mjbj/internal/stock"
	"mjbj/internal/ventas"
)

// Las pruebas del stock entre la venta, el remito, el tablero de pedidos y
// el ajuste rápido (auditoría del 30/10). Cada una falla sin su arreglo.

func (e *entorno) sesionDe(t *testing.T, correo string) *auth.Sesion {
	t.Helper()
	id, err := e.ses.AltaDeStaff(context.Background(), correo, "una clave larga", "Depósito", sqlc.StaffRoleAdmin)
	if err != nil {
		t.Fatal(err)
	}
	return &auth.Sesion{UserID: id, Nombre: "Depósito"}
}

// fisicoYReservado es la placa en Casa Central.
func (e *entorno) fisicoYReservado(t *testing.T) (float64, float64) {
	t.Helper()
	var q, r float64
	if err := e.pool.QueryRow(context.Background(), `select qty::float8, reservado::float8 from inventory where variant_id = $1 and branch_id = $2`,
		e.placa, e.central).Scan(&q, &r); err != nil {
		t.Fatal(err)
	}
	return q, r
}

var clavesDeStock int64 = 700000

func claveDeStock() string {
	return fmt.Sprintf("8f2b5c1e-1d2a-4c3b-9a8e-%012d", atomic.AddInt64(&clavesDeStock, 1))
}

func (e *entorno) ventaEnAcopio(t *testing.T, usuario string, placas float64) string {
	t.Helper()
	p := e.placa
	r, err := e.svc.RegistrarVenta(context.Background(), VentaPedida{Clave: claveDeStock(), BranchID: e.central, ContactoNombre: "CF",
		MedioPago: ventas.Transferencia, Acopio: true,
		Lineas: []ventas.LineaDeVenta{{VariantID: &p, Descripcion: "Fenólico", Unidad: "placa", Cantidad: placas, PrecioUnitario: 100}}}, usuario)
	if err != nil || !r.Ok {
		t.Fatalf("venta en acopio: %v %+v", err, r)
	}
	return r.OrderID
}

func (e *entorno) primerRenglon(t *testing.T, pedido string) string {
	return e.txt(t, `select id::text from order_items where order_id = $1 order by orden limit 1`, pedido)
}

func (e *entorno) reservasActivas(t *testing.T, pedido string) float64 {
	return e.num(t, `select coalesce(sum(cantidad), 0)::float8 from stock_reservations where order_id = $1 and estado = 'activa'`, pedido)
}

// Anular el remito de un acopio vuelve a reservar lo devuelto y el pedido
// deja de estar entregado; anular después la venta no devuelve el físico
// otra vez. Antes: reservado 0 con 10 en acopio (vendibles a otro), el
// pedido «entregado», y el físico terminaba en 110.
func TestAnularElRemitoDeUnAcopioVuelveAReservar(t *testing.T) {
	e := armar(t)
	ses := e.sesionDe(t, "acopio@prueba.test")
	ctx := context.Background()
	ent := entregas.Nuevo(e.pool, silencio)
	inicial, _ := e.fisicoYReservado(t)
	pedido := e.ventaEnAcopio(t, ses.UserID, 10)
	rem, err := ent.CrearEntrega(ctx, ses, entregas.FormRemito{OrderID: pedido, Tipo: "retiro",
		Lineas: []entregas.LineaAEntregar{{OrderItemID: e.primerRenglon(t, pedido), Cantidad: 10}}})
	if err != nil {
		t.Fatal(err)
	}
	if q, r := e.fisicoYReservado(t); q != inicial-10 || r != 0 {
		t.Fatalf("después del remito: físico %v, reservado %v", q, r)
	}
	if err := ent.AnularEntrega(ctx, ses, rem.ID); err != nil {
		t.Fatal(err)
	}
	q, r := e.fisicoYReservado(t)
	estado := e.txt(t, `select estado::text from orders where id = $1`, pedido)
	if q != inicial || r != 10 || e.reservasActivas(t, pedido) != 10 || estado != "listo" {
		t.Errorf("después de anular el remito: físico %v, reservado %v, reservas %v, estado %s (quería %v, 10, 10, listo)",
			q, r, e.reservasActivas(t, pedido), estado, inicial)
	}
	an, err := e.svc.Anular(ctx, pedido, "se arrepintió", ses.UserID)
	if err != nil || !an.Ok {
		t.Fatalf("anular la venta: %v %+v", err, an)
	}
	q, r = e.fisicoYReservado(t)
	if q != inicial || r != 0 {
		t.Errorf("después de anular la venta: físico %v (empezó en %v), reservado %v", q, inicial, r)
	}
}

// Una venta del mostrador sin acopio sigue devolviendo lo que salió.
func TestAnularUnaVentaSinAcopioDevuelveLoQueSalio(t *testing.T) {
	e := armar(t)
	ses := e.sesionDe(t, "suelta@prueba.test")
	p := e.placa
	r, err := e.svc.RegistrarVenta(context.Background(), VentaPedida{Clave: claveDeStock(), BranchID: e.central, ContactoNombre: "CF",
		MedioPago: ventas.Transferencia,
		Lineas:    []ventas.LineaDeVenta{{VariantID: &p, Descripcion: "Fenólico", Unidad: "placa", Cantidad: 4, PrecioUnitario: 100}}}, ses.UserID)
	if err != nil || !r.Ok {
		t.Fatalf("venta: %v %+v", err, r)
	}
	if q, _ := e.fisicoYReservado(t); q != 96 {
		t.Fatalf("después de la venta: %v", q)
	}
	an, err := e.svc.Anular(context.Background(), r.OrderID, "error de carga", ses.UserID)
	if err != nil || !an.Ok {
		t.Fatalf("anular: %v %+v", err, an)
	}
	if q, res := e.fisicoYReservado(t); q != 100 || res != 0 {
		t.Errorf("después de anular: físico %v, reservado %v", q, res)
	}
}

// «Avanzar» un pedido de retiro de «listo» a «entregado» saca la mercadería
// con un remito por lo pendiente. Antes: entregado, el físico sin bajar y la
// reserva activa para siempre.
func TestAvanzarAEntregadoSacaConRemito(t *testing.T) {
	e := armar(t)
	ses := e.sesionDe(t, "tablero@prueba.test")
	ctx := context.Background()
	pedido := e.ventaEnAcopio(t, ses.UserID, 5) // queda «listo», de retiro
	ps := pedidos.Nuevo(e.pool, silencio)
	res, err := ps.Avanzar(ctx, ses, pedido)
	if err != nil {
		t.Fatal(err)
	}
	q, r := e.fisicoYReservado(t)
	estado := e.txt(t, `select estado::text from orders where id = $1`, pedido)
	if estado != "entregado" || q != 95 || r != 0 || e.reservasActivas(t, pedido) != 0 {
		t.Errorf("después de avanzar: %s, físico %v, reservado %v, reservas %v", estado, q, r, e.reservasActivas(t, pedido))
	}
	remito := e.txt(t, `select numero from deliveries where order_id = $1 and estado = 'preparada'`, pedido)
	if !strings.Contains(res.Ok, remito) {
		t.Errorf("el mensaje no nombra el remito %s: %q", remito, res.Ok)
	}
	if saldo, _ := entregas.SaldoDeAcopio(ctx, e.pool, pedido); len(entregas.SoloPendientes(saldo)) != 0 {
		t.Errorf("quedó saldo: %+v", saldo)
	}
	// Y ese remito se anula como cualquier otro: vuelve la reserva.
	id := e.txt(t, `select id::text from deliveries where order_id = $1`, pedido)
	if err := entregas.Nuevo(e.pool, silencio).AnularEntrega(ctx, ses, id); err != nil {
		t.Fatal(err)
	}
	if q, r := e.fisicoYReservado(t); q != 100 || r != 5 {
		t.Errorf("después de anular el remito implícito: físico %v, reservado %v", q, r)
	}
}

// Un envío sin sucursal reserva en la primera activa; su remito saca de
// ahí. Antes el remito no sacaba nada y la reserva quedaba activa.
func TestRemitoDeUnEnvioSinSucursal(t *testing.T) {
	e := armar(t)
	ses := e.sesionDe(t, "envio@prueba.test")
	ctx := context.Background()
	pedido := e.txt(t, `insert into orders (numero, estado, origen, tipo_entrega, subtotal, total, contacto_nombre)
		values ('PED-9001', 'pendiente', 'tienda', 'envio', 300, 300, 'X') returning id::text`)
	item := e.txt(t, `insert into order_items (order_id, variant_id, descripcion, unidad, cantidad, precio_unitario, subtotal, stock_por_unidad, orden)
		values ($1, $2, 'Fenólico', 'placa', 3, 100, 300, 1, 0) returning id::text`, pedido, e.placa)
	if err := pgx.BeginFunc(ctx, e.pool, func(tx pgx.Tx) error { return reservas.ReservarPedido(ctx, tx, pedido) }); err != nil {
		t.Fatal(err)
	}
	if _, err := entregas.Nuevo(e.pool, silencio).CrearEntrega(ctx, ses, entregas.FormRemito{OrderID: pedido, Tipo: "envio",
		Lineas: []entregas.LineaAEntregar{{OrderItemID: item, Cantidad: 3}}}); err != nil {
		t.Fatal(err)
	}
	q, r := e.fisicoYReservado(t)
	suc := e.txt(t, `select coalesce(branch_id::text, '') from deliveries where order_id = $1`, pedido)
	if q != 97 || r != 0 || e.reservasActivas(t, pedido) != 0 || suc != e.central {
		t.Errorf("después del remito: físico %v, reservado %v, reservas %v, sucursal del remito %q", q, r, e.reservasActivas(t, pedido), suc)
	}
}

// En m², las dos mitades redondeadas no suman lo reservado: el retiro que
// completa el renglón consume lo que quede. Antes quedaba 0,001 reservado
// en un pedido entregado.
func TestElUltimoRetiroConsumeElRestoDeLaReserva(t *testing.T) {
	e := armar(t)
	ses := e.sesionDe(t, "m2@prueba.test")
	ctx := context.Background()
	pedido := e.txt(t, `insert into orders (numero, estado, origen, tipo_entrega, subtotal, total, contacto_nombre, branch_id)
		values ('PED-9002', 'pendiente', 'tienda', 'retiro', 100, 100, 'X', $1) returning id::text`, e.central)
	item := e.txt(t, `insert into order_items (order_id, variant_id, descripcion, unidad, cantidad, precio_unitario, subtotal, stock_por_unidad, orden)
		values ($1, $2, 'Fenólico por m²', 'm2', 1, 100, 100, 0.198708, 0) returning id::text`, pedido, e.placa)
	if err := pgx.BeginFunc(ctx, e.pool, func(tx pgx.Tx) error { return reservas.ReservarPedido(ctx, tx, pedido) }); err != nil {
		t.Fatal(err)
	}
	ent := entregas.Nuevo(e.pool, silencio)
	for range 2 {
		if _, err := ent.CrearEntrega(ctx, ses, entregas.FormRemito{OrderID: pedido, Tipo: "retiro",
			Lineas: []entregas.LineaAEntregar{{OrderItemID: item, Cantidad: 0.5}}}); err != nil {
			t.Fatal(err)
		}
	}
	_, r := e.fisicoYReservado(t)
	estado := e.txt(t, `select estado::text from orders where id = $1`, pedido)
	if estado != "entregado" || r != 0 || e.reservasActivas(t, pedido) != 0 {
		t.Errorf("después de las dos mitades: %s, reservado %v, reservas %v", estado, r, e.reservasActivas(t, pedido))
	}
}

// pedidosConDosVariantes arma n pedidos con [mayor, menor] reservados.
func (e *entorno) pedidosConDosVariantes(t *testing.T, prefijo string, n int) (pedidos []string, renglones [][2]string, menor, mayor string) {
	t.Helper()
	ctx := context.Background()
	vs := []string{e.placa, e.tornillo}
	sort.Strings(vs)
	menor, mayor = vs[0], vs[1]
	for i := range n {
		p := e.txt(t, `insert into orders (numero, estado, origen, tipo_entrega, subtotal, total, contacto_nombre, branch_id)
			values ($2, 'pendiente', 'tienda', 'retiro', 0, 0, 'X', $1) returning id::text`, e.central, fmt.Sprintf("%s-%d", prefijo, i))
		a := e.txt(t, `insert into order_items (order_id, variant_id, descripcion, unidad, cantidad, precio_unitario, subtotal, stock_por_unidad, orden)
			values ($1, $2, 'm', 'unidad', 1, 1, 1, 1, 0) returning id::text`, p, mayor)
		b := e.txt(t, `insert into order_items (order_id, variant_id, descripcion, unidad, cantidad, precio_unitario, subtotal, stock_por_unidad, orden)
			values ($1, $2, 'n', 'unidad', 1, 1, 1, 1, 1) returning id::text`, p, menor)
		if err := pgx.BeginFunc(ctx, e.pool, func(tx pgx.Tx) error { return reservas.ReservarPedido(ctx, tx, p) }); err != nil {
			t.Fatal(err)
		}
		pedidos = append(pedidos, p)
		renglones = append(renglones, [2]string{a, b})
	}
	return
}

// ventaDeDos vende una de cada variante, en orden [menor, mayor].
func (e *entorno) ventaDeDos(usuario, menor, mayor string) error {
	a, b := menor, mayor
	_, err := e.svc.RegistrarVenta(context.Background(), VentaPedida{Clave: claveDeStock(), BranchID: e.central, ContactoNombre: "CF",
		MedioPago: ventas.Transferencia,
		Lineas: []ventas.LineaDeVenta{{VariantID: &a, Descripcion: "a", Unidad: "unidad", Cantidad: 1, PrecioUnitario: 1},
			{VariantID: &b, Descripcion: "b", Unidad: "unidad", Cantidad: 1, PrecioUnitario: 1}}}, usuario)
	return err
}

func abrazos(errs []error) int {
	n := 0
	for _, err := range errs {
		if err != nil && (strings.Contains(err.Error(), "40P01") || strings.Contains(err.Error(), "deadlock")) {
			n++
		}
	}
	return n
}

// Treinta cancelaciones contra treinta ventas con las mismas variantes al
// revés: ningún abrazo mortal. Antes LiberarReservas tomaba los candados en
// el orden de las filas.
func TestCancelarContraVentasSinAbrazo(t *testing.T) {
	e := armar(t)
	ses := e.sesionDe(t, "cancelar@prueba.test")
	peds, _, menor, mayor := e.pedidosConDosVariantes(t, "PED-7", 30)
	ps := pedidos.Nuevo(e.pool, silencio)
	var mu sync.Mutex
	var errs []error
	var wg sync.WaitGroup
	for _, p := range peds {
		wg.Add(2)
		go func() {
			defer wg.Done()
			_, err := ps.Cancelar(context.Background(), ses, p, nil)
			mu.Lock()
			errs = append(errs, err)
			mu.Unlock()
		}()
		go func() {
			defer wg.Done()
			err := e.ventaDeDos(ses.UserID, menor, mayor)
			mu.Lock()
			errs = append(errs, err)
			mu.Unlock()
		}()
	}
	wg.Wait()
	if n := abrazos(errs); n > 0 {
		t.Errorf("%d operaciones murieron por abrazo mortal", n)
	}
	if r := e.num(t, `select coalesce(sum(reservado), 0)::float8 from inventory`); r != 0 {
		t.Errorf("quedó reservado %v", r)
	}
}

// Treinta remitos [mayor, menor] contra treinta ventas [menor, mayor]:
// ningún abrazo. Antes SalidaPorEntrega los tomaba en el orden del
// formulario.
func TestRemitosContraVentasSinAbrazo(t *testing.T) {
	e := armar(t)
	ses := e.sesionDe(t, "remitos@prueba.test")
	peds, rs, menor, mayor := e.pedidosConDosVariantes(t, "PED-8", 30)
	ent := entregas.Nuevo(e.pool, silencio)
	var mu sync.Mutex
	var errs []error
	var wg sync.WaitGroup
	for i, p := range peds {
		wg.Add(2)
		go func() {
			defer wg.Done()
			_, err := ent.CrearEntrega(context.Background(), ses, entregas.FormRemito{OrderID: p, Tipo: "retiro",
				Lineas: []entregas.LineaAEntregar{{OrderItemID: rs[i][0], Cantidad: 1}, {OrderItemID: rs[i][1], Cantidad: 1}}})
			mu.Lock()
			errs = append(errs, err)
			mu.Unlock()
		}()
		go func() {
			defer wg.Done()
			err := e.ventaDeDos(ses.UserID, menor, mayor)
			mu.Lock()
			errs = append(errs, err)
			mu.Unlock()
		}()
	}
	wg.Wait()
	if n := abrazos(errs); n > 0 {
		t.Errorf("%d operaciones murieron por abrazo mortal", n)
	}
}

// El ajuste rápido no deja lo disponible en negativo. Antes: 100 físicas
// con 90 reservadas, «−50» dejaba 50 con 90 reservadas.
func TestElAjusteRapidoRespetaLoReservado(t *testing.T) {
	e := armar(t)
	ses := e.sesionDe(t, "ajuste@prueba.test")
	ctx := context.Background()
	e.ventaEnAcopio(t, ses.UserID, 90)
	st := stock.Nuevo(e.pool, silencio)
	_, err := st.Ajustar(ctx, ses, e.placa, "casa-central", -50)
	var p *plataforma.Problema
	if !errors.As(err, &p) || p.Errores["cantidad"] != "En Casa Central hay 100 y 90 están reservados para clientes: se pueden sacar hasta 10." {
		t.Errorf("el ajuste de −50: %v %+v", err, p)
	}
	if q, r := e.fisicoYReservado(t); q != 100 || r != 90 {
		t.Errorf("después del ajuste rechazado: físico %v, reservado %v", q, r)
	}
	if msg, err := st.Ajustar(ctx, ses, e.placa, "casa-central", -10); err != nil || msg != "Casa Central: 100 → 90" {
		t.Errorf("sacar lo libre: %q %v", msg, err)
	}
	if _, err := st.Ajustar(ctx, ses, e.placa, "casa-central", 5); err != nil {
		t.Errorf("sumar siempre se puede: %v", err)
	}
}

// Un remito común sobre una venta directa del mostrador (ya entregada: la
// mercadería salió al cobrar) descontaba el stock otra vez. Se rechaza y
// manda al remito de constancia, que no toca el inventario.
func TestElRemitoDeUnaVentaYaEntregadaNoDescuentaDosVeces(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	ses := e.sesionDe(t, "doble@prueba.test")
	p := e.placa
	r, err := e.svc.RegistrarVenta(ctx, VentaPedida{Clave: claveDeStock(), BranchID: e.central, ContactoNombre: "CF",
		MedioPago: ventas.Transferencia,
		Lineas:    []ventas.LineaDeVenta{{VariantID: &p, Descripcion: "Fenólico", Unidad: "placa", Cantidad: 4, PrecioUnitario: 100}}}, ses.UserID)
	if err != nil || !r.Ok {
		t.Fatalf("venta: %v %+v", err, r)
	}
	ent := entregas.Nuevo(e.pool, silencio)
	_, err = ent.CrearEntrega(ctx, ses, entregas.FormRemito{OrderID: r.OrderID, Tipo: "retiro",
		Lineas: []entregas.LineaAEntregar{{OrderItemID: e.primerRenglon(t, r.OrderID), Cantidad: 4}}})
	if err == nil || !strings.Contains(err.Error(), "constancia") {
		t.Errorf("el remito común sobre una venta entregada: %v", err)
	}
	if q, _ := e.fisicoYReservado(t); q != 96 {
		t.Errorf("el físico bajó dos veces: %v", q)
	}
	if _, err := ent.RemitoDeConstancia(ctx, ses, r.OrderID, nil); err != nil {
		t.Errorf("la constancia: %v", err)
	}
	if q, _ := e.fisicoYReservado(t); q != 96 {
		t.Errorf("la constancia tocó el stock: %v", q)
	}
}
