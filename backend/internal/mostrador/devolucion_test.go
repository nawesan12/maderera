package mostrador

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"mjbj/internal/entregas"
	"mjbj/internal/facturacion"
	"mjbj/internal/reportes"
	"mjbj/internal/ventas"
)

// La devolución parcial de una venta (revisión del comité, T6): la nota, el
// stock y la plata en una sola operación, y la anulación posterior que no
// devuelve nada dos veces. Viven acá porque necesitan la venta y la
// anulación del mostrador.

var clavesDeDevolucion int64

func claveDeDevolucion() string {
	return fmt.Sprintf("devolucion-%d", atomic.AddInt64(&clavesDeDevolucion, 1))
}

type conFactura struct {
	*entorno
	fac             *facturacion.Servicio
	usuario         string
	pedido, factura string
	numero          string
	renglon         string // el primer renglón de la factura
	turno           string
}

// abrirCaja abre un turno en la sucursal.
func (e *entorno) abrirCaja(t *testing.T, sucursal string) string {
	t.Helper()
	return e.txt(t, `insert into cash_sessions (branch_id, abierta_por, abierta_at) values ($1, (select id from "user" limit 1), now() - interval '1 hour')
		returning id::text`, sucursal)
}

// vendidaYFacturada registra la venta, emite su factura y le pone un CAE
// (el proveedor interno no autoriza).
func (e *entorno) vendidaYFacturada(t *testing.T, correo string, v VentaPedida) *conFactura {
	t.Helper()
	ctx := context.Background()
	ses := e.sesionDe(t, correo)
	ses.UserID = e.txt(t, `select id from "user" where email = $1`, correo)
	c := &conFactura{entorno: e, usuario: ses.UserID, fac: facturacion.Nuevo(e.pool, silencio).ConEntorno(func(string) string { return "" })}
	if _, err := c.fac.ObtenerEmisor(ctx); err != nil {
		t.Fatal(err)
	}
	if e.num(t, `select count(*)::float8 from cash_sessions where branch_id = $1 and estado = 'abierta'`, e.central) == 0 {
		c.turno = e.abrirCaja(t, e.central)
	} else {
		c.turno = e.txt(t, `select id::text from cash_sessions where branch_id = $1 and estado = 'abierta'`, e.central)
	}
	if _, err := e.pool.Exec(ctx, `UPDATE configuracion_fiscal SET cuit = '30589445259', condicion_iva = 'responsable_inscripto'`); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(ctx, `INSERT INTO puntos_venta (numero, nombre, numero_inicial) VALUES (3, 'Mostrador', 0) ON CONFLICT DO NOTHING`); err != nil {
		t.Fatal(err)
	}
	v.Clave, v.BranchID = claveDeStock(), e.central
	if v.ContactoNombre == "" {
		v.ContactoNombre = "CF"
	}
	r, err := e.svc.RegistrarVenta(ctx, v, ses.UserID)
	if err != nil || !r.Ok {
		t.Fatalf("venta: %v %+v", err, r)
	}
	c.pedido, c.numero = r.OrderID, r.Numero
	lineas := make([]facturacion.LineaDeVenta, len(v.Lineas))
	for i, l := range v.Lineas {
		lineas[i] = facturacion.LineaDeVenta{Descripcion: l.Descripcion, Unidad: l.Unidad, Cantidad: l.Cantidad, PrecioUnitario: l.PrecioUnitario}
	}
	res, err := c.fac.EmitirParaLaVenta(ctx, facturacion.PedidoDeComprobante{OrderID: r.OrderID, CustomerID: v.CustomerID,
		ReceptorNombre: v.ContactoNombre, Lineas: lineas, UsuarioID: ses.UserID})
	if err != nil || res.InvoiceID == nil {
		t.Fatalf("factura: %v %+v", err, res)
	}
	c.factura = *res.InvoiceID
	if _, err := e.pool.Exec(ctx, `UPDATE invoices SET cae = '71234567890123', estado = 'autorizada' WHERE id = $1`, c.factura); err != nil {
		t.Fatal(err)
	}
	c.renglon = e.txt(t, `select id::text from invoice_items where invoice_id = $1 order by orden limit 1`, c.factura)
	return c
}

func placas(e *entorno, n float64, precio float64) []ventas.LineaDeVenta {
	p := e.placa
	return []ventas.LineaDeVenta{{VariantID: &p, Descripcion: "Fenólico", Unidad: "placa", Cantidad: n, PrecioUnitario: precio}}
}

func (c *conFactura) devolver(cantidad float64, destino string, mods ...func(*facturacion.PedidoDeDevolucion)) (facturacion.Devolucion, error) {
	p := facturacion.PedidoDeDevolucion{InvoiceID: c.factura, Clave: claveDeDevolucion(), Destino: destino, Motivo: "Le sobraron",
		Renglones: []facturacion.RenglonADevolver{{ItemID: c.renglon, Cantidad: cantidad, AlStock: true}}}
	for _, m := range mods {
		m(&p)
	}
	return c.fac.DevolucionParcial(context.Background(), c.usuario, p)
}

func (c *conFactura) caja(t *testing.T) float64 {
	return c.num(t, `select coalesce(sum(monto), 0)::float8 from cash_movements where session_id = $1`, c.turno)
}

// 2 de 10 placas en efectivo: la caja baja, el físico sube, la nota sale
// por lo devuelto y el CSV del estudio la asienta contra Caja.
func TestDevolucionEnEfectivo(t *testing.T) {
	e := armar(t)
	c := e.vendidaYFacturada(t, "efectivo@prueba.test", VentaPedida{MedioPago: ventas.Efectivo, Lineas: placas(e, 10, 100)})
	antes := c.caja(t)
	if q, _ := e.fisicoYReservado(t); q != 90 {
		t.Fatalf("después de la venta: %v", q)
	}
	d, err := c.devolver(2, facturacion.DevolverPorCaja)
	if err != nil {
		t.Fatal(err)
	}
	if d.Importe != 200 || d.Repetida {
		t.Fatalf("devolución %+v", d)
	}
	if got := c.caja(t); got != antes-200 {
		t.Errorf("caja %v, quería %v", got, antes-200)
	}
	if q, _ := e.fisicoYReservado(t); q != 92 {
		t.Errorf("físico %v, quería 92", q)
	}
	if n := e.num(t, `select total::float8 from invoices where id = $1`, d.NotaID); n != 200 {
		t.Errorf("nota por %v", n)
	}
	if a := e.num(t, `select acreditado::float8 from invoices where id = $1`, c.factura); a != 200 {
		t.Errorf("acreditado %v", a)
	}
	if r := e.num(t, `select coalesce(sum(importe), 0)::float8 from payment_refunds`); r != 200 {
		t.Errorf("tramos devueltos %v", r)
	}

	// El CSV del estudio: la nota contra Deudores y la plata de Deudores a
	// Caja. Deudores queda en cero y Caja baja 200.
	if _, err := e.pool.Exec(context.Background(), `UPDATE invoices SET cae = '71234567890124', estado = 'autorizada' WHERE id = $1`, d.NotaID); err != nil {
		t.Fatal(err)
	}
	rep := reportes.Nuevo(e.pool, silencio)
	ahora := time.Now()
	desde := time.Date(ahora.Year(), ahora.Month(), 1, 0, 0, 0, 0, time.UTC)
	asientos, err := rep.AsientosDelPeriodo(context.Background(), desde, desde.AddDate(0, 1, 0).Add(-time.Millisecond))
	if err != nil {
		t.Fatal(err)
	}
	saldos := map[string]float64{}
	for _, a := range reportes.DelCircuito(asientos, "") {
		if !a.Balancea {
			t.Errorf("no balancea: %+v", a)
		}
		for _, r := range a.Renglones {
			saldos[r.Cuenta] += r.Debe - r.Haber
		}
	}
	if d := saldos[reportes.Cuentas.Deudores]; d > 0.005 || d < -0.005 {
		t.Errorf("Deudores queda en %v", d)
	}
	if caja := saldos[reportes.Cuentas.Caja]; caja < 799.995 || caja > 800.005 {
		t.Errorf("Caja queda en %v, quería 800 (1000 cobrados, 200 devueltos)", caja)
	}
}

// En cuenta corriente: el saldo del cliente baja, y la caja no se ofrece.
func TestDevolucionACuentaCorriente(t *testing.T) {
	e := armar(t)
	cliente := e.cliente
	c := e.vendidaYFacturada(t, "cuenta@prueba.test", VentaPedida{MedioPago: ventas.CuentaCorriente, CustomerID: &cliente, Lineas: placas(e, 10, 100)})
	saldo := func() float64 {
		return e.num(t, `select coalesce(sum(monto), 0)::float8 from account_movements where customer_id = $1`, cliente)
	}
	if s := saldo(); s != 1000 {
		t.Fatalf("saldo después de la venta: %v", s)
	}
	if _, err := c.devolver(2, facturacion.DevolverPorCaja); err == nil || !strings.Contains(facturacion.Mensaje(err), "efectivo") {
		t.Fatalf("por caja: %v", err)
	}
	if _, err := c.devolver(2, facturacion.DevolverPorCuenta); err != nil {
		t.Fatal(err)
	}
	if s := saldo(); s != 800 {
		t.Errorf("saldo %v, quería 800", s)
	}
}

// En acopio: baja la reserva, el físico no se toca y el remito ya no
// entrega lo devuelto.
func TestDevolucionEnAcopio(t *testing.T) {
	e := armar(t)
	cliente := e.cliente
	c := e.vendidaYFacturada(t, "acopio-dev@prueba.test", VentaPedida{MedioPago: ventas.CuentaCorriente, CustomerID: &cliente, Acopio: true,
		Lineas: placas(e, 10, 100)})
	if q, r := e.fisicoYReservado(t); q != 100 || r != 10 {
		t.Fatalf("después de la venta: físico %v, reservado %v", q, r)
	}
	if _, err := c.devolver(2, facturacion.DevolverPorCuenta); err != nil {
		t.Fatal(err)
	}
	if q, r := e.fisicoYReservado(t); q != 100 || r != 8 {
		t.Errorf("físico %v, reservado %v (quería 100 y 8)", q, r)
	}
	saldo, err := entregas.SaldoDeAcopio(context.Background(), e.pool, c.pedido)
	if err != nil {
		t.Fatal(err)
	}
	if len(saldo) != 1 || saldo[0].Pendiente != 8 {
		t.Errorf("pendiente de entregar %+v, quería 8", saldo)
	}
}

// Un renglón sin variante (un flete): vuelve la plata, no el stock, y pide
// el motivo de la lista.
func TestDevolucionDeUnRenglonSinVariante(t *testing.T) {
	e := armar(t)
	c := e.vendidaYFacturada(t, "flete@prueba.test", VentaPedida{MedioPago: ventas.Efectivo,
		Lineas: []ventas.LineaDeVenta{{Descripcion: "Flete", Unidad: "unidad", Cantidad: 1, PrecioUnitario: 500}}})
	if _, err := c.devolver(1, facturacion.DevolverPorCaja); err == nil || !strings.Contains(facturacion.Mensaje(err), "no vuelve al stock") {
		t.Fatalf("al stock: %v", err)
	}
	sinStock := func(p *facturacion.PedidoDeDevolucion) { p.Renglones[0].AlStock = false }
	if _, err := c.devolver(1, facturacion.DevolverPorCaja, sinStock); err == nil || !strings.Contains(facturacion.Mensaje(err), "por qué") {
		t.Fatalf("sin motivo: %v", err)
	}
	antes := c.caja(t)
	if _, err := c.devolver(1, facturacion.DevolverPorCaja, sinStock, func(p *facturacion.PedidoDeDevolucion) { p.SinStock = "otro" }); err != nil {
		t.Fatal(err)
	}
	if got := c.caja(t); got != antes-500 {
		t.Errorf("caja %v, quería %v", got, antes-500)
	}
	if n := e.num(t, `select count(*)::float8 from inventory_movements where documento_tipo = 'devolucion'`); n != 0 {
		t.Errorf("movió stock: %v movimientos", n)
	}
}

// Con la caja cerrada no se devuelve en efectivo, y no queda nada escrito.
func TestDevolucionConLaCajaCerrada(t *testing.T) {
	e := armar(t)
	c := e.vendidaYFacturada(t, "cerrada@prueba.test", VentaPedida{MedioPago: ventas.Efectivo, Lineas: placas(e, 10, 100)})
	if _, err := e.pool.Exec(context.Background(), `UPDATE cash_sessions SET estado = 'cerrada', cerrada_at = now()`); err != nil {
		t.Fatal(err)
	}
	if _, err := c.devolver(2, facturacion.DevolverPorCaja); err == nil || !strings.Contains(facturacion.Mensaje(err), "No hay caja abierta") {
		t.Fatalf("con la caja cerrada: %v", err)
	}
	if n := e.num(t, `select count(*)::float8 from invoices where comprobante_origen_id = $1`, c.factura); n != 0 {
		t.Errorf("quedó una nota emitida")
	}
	if q, _ := e.fisicoYReservado(t); q != 90 {
		t.Errorf("físico %v", q)
	}
}

// Devolución y después anular la venta: ni el stock ni la plata vuelven dos
// veces, y la nota de la anulación cierra la factura al centavo.
func TestDevolucionYDespuesAnular(t *testing.T) {
	e := armar(t)
	c := e.vendidaYFacturada(t, "anular-dev@prueba.test", VentaPedida{MedioPago: ventas.Efectivo, Lineas: placas(e, 10, 100)})
	inicial := c.caja(t) - 1000
	if _, err := c.devolver(2, facturacion.DevolverPorCaja); err != nil {
		t.Fatal(err)
	}
	an, err := e.svc.Anular(context.Background(), c.pedido, "se arrepintió del resto", c.usuario)
	if err != nil || !an.Ok || an.FacturaPendiente == nil {
		t.Fatalf("anular: %v %+v", err, an)
	}
	if got := c.caja(t); got != inicial {
		t.Errorf("caja %v, quería %v (devolvió de más o de menos)", got, inicial)
	}
	if q, r := e.fisicoYReservado(t); q != 100 || r != 0 {
		t.Errorf("físico %v, reservado %v (quería 100 y 0)", q, r)
	}
	if _, err := c.fac.Anular(context.Background(), *an.FacturaPendiente, "Anulación de la venta", &c.usuario); err != nil {
		t.Fatal(err)
	}
	if a := e.num(t, `select acreditado::float8 from invoices where id = $1`, c.factura); a != 1000 {
		t.Errorf("acreditado %v, quería 1000", a)
	}
}

// Con otra sucursal de entrada, el stock entra ahí; anular después devuelve
// a la de la venta solo lo que falta.
func TestDevolucionPorOtraSucursal(t *testing.T) {
	e := armar(t)
	c := e.vendidaYFacturada(t, "otra@prueba.test", VentaPedida{MedioPago: ventas.CuentaCorriente, CustomerID: &e.cliente, Lineas: placas(e, 10, 100)})
	if _, err := c.devolver(2, facturacion.DevolverPorCuenta, func(p *facturacion.PedidoDeDevolucion) { p.BranchID = e.otra }); err != nil {
		t.Fatal(err)
	}
	enOtra := func() float64 {
		return e.num(t, `select coalesce(sum(qty), 0)::float8 from inventory where variant_id = $1 and branch_id = $2`, e.placa, e.otra)
	}
	if enOtra() != 2 {
		t.Errorf("en la otra sucursal hay %v", enOtra())
	}
	if an, err := e.svc.Anular(context.Background(), c.pedido, "error", c.usuario); err != nil || !an.Ok {
		t.Fatalf("anular: %v %+v", err, an)
	}
	if q, _ := e.fisicoYReservado(t); q != 98 || enOtra() != 2 {
		t.Errorf("central %v y otra %v (quería 98 y 2: salieron 10, volvieron 2 por la otra)", q, enOtra())
	}
}

// La venta mixta: de la caja sale hasta lo que entró en efectivo. Pagar
// con tarjeta y llevarse efectivo no se puede.
func TestDevolucionDeUnaVentaMixta(t *testing.T) {
	e := armar(t)
	c := e.vendidaYFacturada(t, "mixta@prueba.test", VentaPedida{MedioPago: ventas.Efectivo, Lineas: placas(e, 10, 10),
		Pagos: []ventas.PagoDeVenta{{Medio: ventas.Debito, Importe: 60}, {Medio: ventas.Efectivo, Importe: 40}}})
	if _, err := c.devolver(5, facturacion.DevolverPorCaja); err == nil || !strings.Contains(facturacion.Mensaje(err), "hasta") {
		t.Fatalf("50 de la caja con 40 en efectivo: %v", err)
	}
	if _, err := c.devolver(4, facturacion.DevolverPorCaja); err != nil {
		t.Fatal(err)
	}
	if _, err := c.devolver(1, facturacion.DevolverPorCaja); err == nil {
		t.Fatal("dejó sacar de la caja más de lo que entró en efectivo")
	}
	inicial := c.caja(t)
	if an, err := e.svc.Anular(context.Background(), c.pedido, "error", c.usuario); err != nil || !an.Ok {
		t.Fatalf("anular: %v %+v", err, an)
	}
	if got := c.caja(t); got != inicial {
		t.Errorf("la anulación sacó %v más de la caja (el efectivo ya se había devuelto)", inicial-got)
	}
}

// Una venta con tarjeta sola: nada sale de la caja.
func TestDevolucionDeUnaVentaConTarjeta(t *testing.T) {
	e := armar(t)
	c := e.vendidaYFacturada(t, "tarjeta@prueba.test", VentaPedida{MedioPago: ventas.Debito, Lineas: placas(e, 10, 100)})
	if _, err := c.devolver(1, facturacion.DevolverPorCaja); err == nil || !strings.Contains(facturacion.Mensaje(err), "no se cobró en efectivo") {
		t.Fatalf("tarjeta por caja: %v", err)
	}
	if _, err := c.devolver(1, facturacion.DevolverPorCuenta); err == nil || !strings.Contains(facturacion.Mensaje(err), "no tiene cliente") {
		t.Fatalf("tarjeta por cuenta sin cliente: %v", err)
	}
}

// El mismo pedido dos veces (doble clic, respuesta perdida): una sola
// devolución.
func TestDevolucionConLaMismaClave(t *testing.T) {
	e := armar(t)
	c := e.vendidaYFacturada(t, "doble@prueba.test", VentaPedida{MedioPago: ventas.Efectivo, Lineas: placas(e, 10, 100)})
	clave := func(p *facturacion.PedidoDeDevolucion) { p.Clave = "la-misma" }
	var wg sync.WaitGroup
	res := make([]facturacion.Devolucion, 4)
	errs := make([]error, 4)
	for i := range res {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			res[i], errs[i] = c.devolver(2, facturacion.DevolverPorCaja, clave)
		}(i)
	}
	wg.Wait()
	nuevas := 0
	for i := range res {
		if errs[i] != nil {
			t.Fatalf("%d: %v", i, errs[i])
		}
		if !res[i].Repetida {
			nuevas++
		}
		if res[i].NotaID != res[0].NotaID {
			t.Errorf("dos notas distintas para la misma clave")
		}
	}
	if nuevas != 1 || e.num(t, `select count(*)::float8 from devoluciones`) != 1 {
		t.Errorf("%d devoluciones nuevas, quería 1", nuevas)
	}
	if q, _ := e.fisicoYReservado(t); q != 92 {
		t.Errorf("físico %v, quería 92", q)
	}
}

// Dos devoluciones distintas a la vez: el tope de lo que queda se respeta.
func TestDosDevolucionesALaVez(t *testing.T) {
	e := armar(t)
	c := e.vendidaYFacturada(t, "carrera@prueba.test", VentaPedida{MedioPago: ventas.Efectivo, Lineas: placas(e, 10, 100)})
	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i := range errs {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, errs[i] = c.devolver(6, facturacion.DevolverPorCaja)
		}(i)
	}
	wg.Wait()
	if (errs[0] == nil) == (errs[1] == nil) {
		t.Fatalf("las dos dieron %v y %v: tenía que pasar una sola", errs[0], errs[1])
	}
	if q, _ := e.fisicoYReservado(t); q != 96 {
		t.Errorf("físico %v, quería 96", q)
	}
}

// Las cantidades con decimales: 2,5 de 10 metros vuelven como 2,5; una que
// en el stock da cero se rechaza en vez de sacar plata sin mover nada.
func TestDevolucionConDecimales(t *testing.T) {
	e := armar(t)
	c := e.vendidaYFacturada(t, "metros@prueba.test", VentaPedida{MedioPago: ventas.Efectivo, Lineas: placas(e, 10, 100)})
	if _, err := c.devolver(2.5, facturacion.DevolverPorCaja); err != nil {
		t.Fatal(err)
	}
	if q, _ := e.fisicoYReservado(t); q != 92.5 {
		t.Errorf("físico %v, quería 92,5", q)
	}
	if _, err := e.pool.Exec(context.Background(), `UPDATE order_items SET stock_por_unidad = 0.0001 WHERE order_id = $1`, c.pedido); err != nil {
		t.Fatal(err)
	}
	if _, err := c.devolver(0.01, facturacion.DevolverPorCaja); err == nil || !strings.Contains(facturacion.Mensaje(err), "demasiado poco") {
		t.Fatalf("lo que da cero en el stock: %v", err)
	}
}
