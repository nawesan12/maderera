package mostrador

import (
	"context"
	"math"
	"strings"
	"testing"
	"time"

	"mjbj/internal/caja"
	"mjbj/internal/facturacion"
	"mjbj/internal/reportes"
	"mjbj/internal/ventas"
)

// La devolución «por afuera» de una venta del mostrador cobrada con
// tarjeta, transferencia o cheque (pendiente del 19/11): la nota de crédito
// acreditaba Deudores y el CSV del estudio no tenía el reintegro, así que
// Deudores quedaba con un saldo en contra igual a lo devuelto hasta que se
// anulaba la venta. Ahora la devolución anota el tramo en el cobro, como la
// de caja, y el cierre lo asienta.

// conCae le pone CAE a la nota de una devolución: sin CAE no está en el CSV.
func (c *conFactura) conCae(t *testing.T, d facturacion.Devolucion) {
	t.Helper()
	if d.NotaID == "" {
		return
	}
	if _, err := c.pool.Exec(context.Background(), `UPDATE invoices SET cae = '7123456789' || floor(random() * 10000)::int, estado = 'autorizada' WHERE id = $1`,
		d.NotaID); err != nil {
		t.Fatal(err)
	}
}

func (c *conFactura) afuera(t *testing.T, cantidad float64) facturacion.Devolucion {
	t.Helper()
	d, err := c.devolver(cantidad, facturacion.DevolverPorAfuera)
	if err != nil {
		t.Fatal(err)
	}
	c.conCae(t, d)
	return d
}

// asientosDeTodo son los asientos del archivo del estudio desde el principio.
func (e *entorno) asientosDeTodo(t *testing.T) []reportes.Asiento {
	t.Helper()
	a, err := reportes.Nuevo(e.pool, silencio).AsientosDelPeriodo(context.Background(), time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC),
		time.Now().AddDate(0, 1, 0))
	if err != nil {
		t.Fatal(err)
	}
	blanco := reportes.DelCircuito(a, "blanco")
	for _, x := range blanco {
		if !x.Balancea {
			t.Errorf("no balancea: %+v", x)
		}
	}
	return blanco
}

func cerca(a, b float64) bool { return math.Abs(a-b) < 0.005 }

// tramos son los de la devolución, por medio del cobro.
func (e *entorno) tramos(t *testing.T, devolucion string) map[string]float64 {
	t.Helper()
	filas, err := e.pool.Query(context.Background(), `SELECT p.medio, t.importe::float8 FROM payment_refunds t JOIN payments p ON p.id = t.payment_id
		WHERE t.devolucion_id = $1`, devolucion)
	if err != nil {
		t.Fatal(err)
	}
	defer filas.Close()
	out := map[string]float64{}
	for filas.Next() {
		var medio string
		var importe float64
		if err := filas.Scan(&medio, &importe); err != nil {
			t.Fatal(err)
		}
		out[medio] += importe
	}
	return out
}

// reintegros es lo que suman los asientos de reintegro, por la cuenta de la
// que sale la plata.
func reintegros(asientos []reportes.Asiento) map[string]float64 {
	out := map[string]float64{}
	for _, a := range asientos {
		if !strings.HasPrefix(a.Concepto, "Reintegro ") {
			continue
		}
		for _, r := range a.Renglones {
			out[r.Cuenta] += r.Haber
		}
	}
	return out
}

func (e *entorno) pendientes(t *testing.T) []string {
	t.Helper()
	ahora := time.Now()
	desde := time.Date(ahora.Year(), ahora.Month(), 1, 0, 0, 0, 0, caja.Argentina)
	p, err := reportes.Nuevo(e.pool, silencio).PendientesDelCierre(context.Background(), desde, desde.AddDate(0, 1, 0))
	if err != nil {
		t.Fatal(err)
	}
	var claves []string
	for _, x := range p {
		claves = append(claves, x.Clave)
	}
	return claves
}

func contiene(l []string, s string) bool {
	for _, x := range l {
		if x == s {
			return true
		}
	}
	return false
}

// Débito de 1210, se devuelven 242 por afuera: el reintegro va de Deudores
// a Banco, Deudores queda en cero y el listado de deudores da el mayor.
// Después se anula el resto: el reintegro total es 1210, no 1210 + 242, y
// el cajero ve que por afuera vuelven 968.
func TestLaDevolucionPorAfueraConTarjetaTieneReintegro(t *testing.T) {
	e := armar(t)
	c := e.vendidaYFacturada(t, "afuera-tarjeta@prueba.test", VentaPedida{MedioPago: ventas.Debito, ContactoNombre: "Ernesto Afuera",
		Lineas: placas(e, 10, 121)})
	d := c.afuera(t, 2)
	if d.Importe != 242 {
		t.Fatalf("devolución %+v", d)
	}
	if tr := e.tramos(t, d.ID); len(tr) != 1 || tr[ventas.Debito] != 242 {
		t.Errorf("tramos: %v", tr)
	}

	asientos := e.asientosDeTodo(t)
	var reintegro *reportes.Asiento
	for i, a := range asientos {
		if strings.HasPrefix(a.Concepto, "Reintegro parcial Factura") {
			reintegro = &asientos[i]
		}
	}
	if reintegro == nil || len(reintegro.Renglones) != 2 || reintegro.Renglones[0].Cuenta != reportes.Cuentas.Deudores ||
		reintegro.Renglones[0].Debe != 242 || reintegro.Renglones[1].Cuenta != reportes.Cuentas.TarjetasAAcreditar || reintegro.Renglones[1].Haber != 242 {
		t.Fatalf("reintegro: %+v", reintegro)
	}
	if s := reportes.SaldoDeCuenta(asientos, reportes.Cuentas.Deudores); !cerca(s, 0) {
		t.Errorf("Deudores queda en %v (venta − cobro − nota + reintegro)", s)
	}
	if p := e.pendientes(t); contiene(p, "deudores-mayor") || contiene(p, "deudores") {
		t.Errorf("pendientes: %v", p)
	}
	csv, err := reportes.Nuevo(e.pool, silencio).CsvDeudores(context.Background(), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(csv, "Ernesto Afuera") {
		t.Errorf("el cliente figura como deudor: %s", csv)
	}

	an, err := e.svc.Anular(context.Background(), comoAdmin(c.usuario), c.pedido, PedidoDeAnulacion{Motivo: "no la quiso", VolvioLaMercaderia: true})
	if err != nil || !an.Ok {
		t.Fatalf("anular: %v %+v", err, an)
	}
	if an.PorAfuera != 968 {
		t.Errorf("por afuera vuelven %v, quería 968", an.PorAfuera)
	}
	asientos = e.asientosDeTodo(t)
	if r := reintegros(asientos); !cerca(r[reportes.Cuentas.TarjetasAAcreditar], 1210) {
		t.Errorf("reintegros de la tarjeta: %v, quería 1210", r)
	}
	// La anulación no toca la factura: hasta la nota de crédito del resto,
	// Deudores tiene los 968 y el cierre avisa la factura viva.
	if s := reportes.SaldoDeCuenta(asientos, reportes.Cuentas.Deudores); !cerca(s, 968) {
		t.Errorf("Deudores queda en %v, quería 968", s)
	}
	if p := e.pendientes(t); !contiene(p, "facturas-vivas") {
		t.Errorf("pendientes: %v", p)
	}
}

// La mixta: una devolución por caja y otra por afuera dejan un tramo cada
// una, sobre el cobro que corresponde.
func TestLaDevolucionDeUnaMixtaTocaCadaCobro(t *testing.T) {
	e := armar(t)
	c := e.vendidaYFacturada(t, "afuera-mixta2@prueba.test", VentaPedida{MedioPago: ventas.Efectivo, Lineas: placas(e, 10, 10),
		Pagos: []ventas.PagoDeVenta{{Medio: ventas.Debito, Importe: 60}, {Medio: ventas.Efectivo, Importe: 40}}})
	porCaja, err := c.devolver(2, facturacion.DevolverPorCaja)
	if err != nil {
		t.Fatal(err)
	}
	c.conCae(t, porCaja)
	porAfuera := c.afuera(t, 3)
	if tr := e.tramos(t, porCaja.ID); len(tr) != 1 || tr[ventas.Efectivo] != 20 {
		t.Errorf("tramos de la devolución por caja: %v", tr)
	}
	if tr := e.tramos(t, porAfuera.ID); len(tr) != 1 || tr[ventas.Debito] != 30 {
		t.Errorf("tramos de la devolución por afuera: %v", tr)
	}
	asientos := e.asientosDeTodo(t)
	// Lo de la tarjeta vuelve de Tarjetas a acreditar (M2S1-058).
	if r := reintegros(asientos); !cerca(r[reportes.Cuentas.Caja], 20) || !cerca(r[reportes.Cuentas.TarjetasAAcreditar], 30) {
		t.Errorf("reintegros: %v", r)
	}
	if s := reportes.SaldoDeCuenta(asientos, reportes.Cuentas.Deudores); !cerca(s, 0) {
		t.Errorf("Deudores queda en %v", s)
	}
}

// La mixta con la parte a cuenta corriente cobrada después desde
// Facturación (con recibo): el cobro con tarjeta de la venta no desaparece
// del CSV y Deudores cierra.
func TestLaMixtaCobradaDespuesDesdeFacturacion(t *testing.T) {
	e := armar(t)
	cliente := e.cliente
	c := e.vendidaYFacturada(t, "mixta-cc@prueba.test", VentaPedida{MedioPago: ventas.Debito, CustomerID: &cliente, ContactoNombre: "Ana Gómez",
		Lineas: placas(e, 10, 10), Pagos: []ventas.PagoDeVenta{{Medio: ventas.Debito, Importe: 60}, {Medio: ventas.CuentaCorriente, Importe: 40}}})
	if _, err := c.fac.Cobrar(context.Background(), comoAdmin(c.usuario), c.factura, "recibo", "", `[{"medio":"transferencia","importe":"40"}]`); err != nil {
		t.Fatal(err)
	}
	asientos := e.asientosDeTodo(t)
	cobrosConTarjeta := 0.0
	for _, a := range asientos {
		if strings.HasPrefix(a.Concepto, "Cobro Factura") {
			cobrosConTarjeta += a.Renglones[0].Debe
		}
	}
	if cobrosConTarjeta != 60 {
		t.Errorf("el cobro con tarjeta de la venta: %v", cobrosConTarjeta)
	}
	if s := reportes.SaldoDeCuenta(asientos, reportes.Cuentas.Deudores); !cerca(s, 0) {
		t.Errorf("Deudores queda en %v", s)
	}
	d := c.afuera(t, 2)
	if tr := e.tramos(t, d.ID); tr[ventas.Debito] != 20 {
		t.Errorf("tramos: %v", tr)
	}
	if s := reportes.SaldoDeCuenta(e.asientosDeTodo(t), reportes.Cuentas.Deudores); !cerca(s, 0) {
		t.Errorf("Deudores después de la devolución: %v", s)
	}
}

func chequeDePago(numero string) *ventas.ChequeDePago {
	return &ventas.ChequeDePago{Tipo: "fisico", Numero: numero, Banco: "Nación", FechaPago: time.Now().In(caja.Argentina).AddDate(0, 0, 10).Format("2006-01-02")}
}

// Débito y cheque: la devolución chica sale del débito y no toca el cheque;
// la que llega al cheque vuelve por el banco (el cheque sigue en Valores a
// depositar). Anular con el cheque tocado se rechaza: le devolvería además
// el cheque entero. Lo que cierra es devolver el resto por afuera.
func TestLaDevolucionPorAfueraConCheque(t *testing.T) {
	e := armar(t)
	c := e.vendidaYFacturada(t, "afuera-cheque@prueba.test", VentaPedida{MedioPago: ventas.Debito, Lineas: placas(e, 10, 100),
		Pagos: []ventas.PagoDeVenta{{Medio: ventas.Debito, Importe: 500}, {Medio: ventas.Cheque, Importe: 500, Cheque: chequeDePago("12345678")}}})
	chica := c.afuera(t, 1)
	if tr := e.tramos(t, chica.ID); len(tr) != 1 || tr[ventas.Debito] != 100 {
		t.Errorf("la devolución chica: %v", tr)
	}
	grande := c.afuera(t, 5)
	if tr := e.tramos(t, grande.ID); len(tr) != 2 || tr[ventas.Debito] != 400 || tr[ventas.Cheque] != 100 {
		t.Errorf("la que llega al cheque: %v", tr)
	}
	asientos := e.asientosDeTodo(t)
	// Lo de la tarjeta vuelve de Tarjetas a acreditar (M2S1-058) y lo del
	// cheque por el banco.
	if r := reintegros(asientos); !cerca(r[reportes.Cuentas.TarjetasAAcreditar], 500) || !cerca(r[reportes.Cuentas.Banco], 100) ||
		r[reportes.Cuentas.ValoresADepositar] != 0 {
		t.Errorf("reintegros: %v", r)
	}

	an, err := e.svc.Anular(context.Background(), comoAdmin(c.usuario), c.pedido, PedidoDeAnulacion{Motivo: "no la quiso", VolvioLaMercaderia: true})
	if err != nil || an.Ok || !strings.Contains(an.Error, "devolvé el resto desde la factura") {
		t.Fatalf("anular con el cheque tocado: %v %+v", err, an)
	}
	if estado := e.txt(t, `select estado::text from orders where id = $1`, c.pedido); estado == "cancelado" {
		t.Error("la venta quedó anulada")
	}

	resto := c.afuera(t, 4)
	if tr := e.tramos(t, resto.ID); len(tr) != 1 || tr[ventas.Cheque] != 400 {
		t.Errorf("el resto: %v", tr)
	}
	asientos = e.asientosDeTodo(t)
	if s := reportes.SaldoDeCuenta(asientos, reportes.Cuentas.Deudores); !cerca(s, 0) {
		t.Errorf("Deudores queda en %v", s)
	}
	// El cheque se cobró y sigue en cartera: hasta depositarlo está en
	// Valores a depositar.
	if s := reportes.SaldoDeCuenta(asientos, reportes.Cuentas.ValoresADepositar); !cerca(s, 500) {
		t.Errorf("Valores a depositar queda en %v", s)
	}
}

// El cheque rechazado ya no es plata cobrada: su nota de débito le volvió a
// cargar el importe al cliente, así que no se devuelve por afuera.
func TestNoSeDevuelvePorAfueraUnChequeRechazado(t *testing.T) {
	e := armar(t)
	c := e.vendidaYFacturada(t, "afuera-rechazado@prueba.test", VentaPedida{MedioPago: ventas.Debito, Lineas: placas(e, 10, 100),
		Pagos: []ventas.PagoDeVenta{{Medio: ventas.Debito, Importe: 500}, {Medio: ventas.Cheque, Importe: 500, Cheque: chequeDePago("87654321")}}})
	if _, err := e.pool.Exec(context.Background(), `UPDATE cheques SET estado = 'rechazado' WHERE numero = '87654321'`); err != nil {
		t.Fatal(err)
	}
	if _, err := c.devolver(6, facturacion.DevolverPorAfuera); err == nil || !strings.Contains(facturacion.Mensaje(err), "hasta") {
		t.Fatalf("600 por afuera con 500 cobrados de verdad: %v", err)
	}
	c.afuera(t, 5)
}

// La venta con un CAE de prueba (para el estudio, sin factura): la
// devolución anota su tramo, pero nada entra al archivo.
func TestLaDevolucionPorAfueraDeUnaVentaSinFacturaNoAsienta(t *testing.T) {
	e := armar(t)
	c := e.vendidaYFacturada(t, "afuera-b@prueba.test", VentaPedida{MedioPago: ventas.Debito, Lineas: placas(e, 10, 100)})
	if _, err := e.pool.Exec(context.Background(), `UPDATE invoices SET cae_ambiente = 'homologacion' WHERE id = $1`, c.factura); err != nil {
		t.Fatal(err)
	}
	c.afuera(t, 2)
	for _, a := range e.asientosDeTodo(t) {
		if strings.Contains(a.Concepto, c.numero) || strings.HasPrefix(a.Concepto, "Reintegro") || strings.HasPrefix(a.Concepto, "Cobro") {
			t.Errorf("asiento de una venta sin factura: %+v", a)
		}
	}
}

// El reintegro cae en el mes de la devolución en hora argentina: la del 1/11
// a las 00:30 es de noviembre, aunque la venta sea del 31/10; la del 31/10 a
// las 23:30 (ya 1/11 en UTC) es de octubre.
func TestElReintegroCaeEnSuMes(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	venta := time.Date(2026, 10, 31, 15, 0, 0, 0, caja.Argentina)
	periodo := func(p string) (time.Time, time.Time) {
		x := reportes.PeriodoDelCierre(p, venta)
		return x.Desde, x.Hasta
	}
	reintegroDe := func(desde, hasta time.Time, numero string) float64 {
		t.Helper()
		a, err := reportes.Nuevo(e.pool, silencio).AsientosDelPeriodo(ctx, desde, hasta)
		if err != nil {
			t.Fatal(err)
		}
		s := 0.0
		for _, x := range a {
			if strings.HasPrefix(x.Concepto, "Reintegro parcial") && strings.Contains(x.Concepto, numero) {
				s += x.Renglones[0].Debe
			}
		}
		return s
	}
	for _, caso := range []struct {
		devuelta      time.Time
		octubre, nov  float64
		correo, clave string
	}{
		{time.Date(2026, 11, 1, 0, 30, 0, 0, caja.Argentina), 0, 200, "mes-1@prueba.test", "nov"},
		{time.Date(2026, 10, 31, 23, 30, 0, 0, caja.Argentina), 200, 0, "mes-2@prueba.test", "oct"},
	} {
		c := e.vendidaYFacturada(t, caso.correo, VentaPedida{MedioPago: ventas.Debito, Lineas: placas(e, 10, 100)})
		for _, q := range []string{
			`UPDATE orders SET created_at = $2, cobrada_at = $2 WHERE id = $1`,
			`UPDATE payments SET created_at = $2, conciliado_at = $2 WHERE order_id = $1`,
			`UPDATE invoices SET fecha_emision = $2 WHERE order_id = $1`,
		} {
			if _, err := e.pool.Exec(ctx, q, c.pedido, venta); err != nil {
				t.Fatal(err)
			}
		}
		d := c.afuera(t, 2)
		if _, err := e.pool.Exec(ctx, `UPDATE payment_refunds SET created_at = $2 WHERE devolucion_id = $1`, d.ID, caso.devuelta); err != nil {
			t.Fatal(err)
		}
		// La nota, autorizada en el momento: el tramo va con ella
		// (cobros.FechaDelTramo; TestElReintegroVaConLaNotaDeCredito).
		if _, err := e.pool.Exec(ctx, `UPDATE invoices SET fecha_emision = $2 WHERE id = $1`, d.NotaID, caso.devuelta); err != nil {
			t.Fatal(err)
		}
		pedido := e.txt(t, `select numero from orders where id = $1`, c.pedido)
		od, oh := periodo("2026-10")
		nd, nh := periodo("2026-11")
		if got := reintegroDe(od, oh, pedido); got != caso.octubre {
			t.Errorf("%s: octubre tiene %v de reintegro, quería %v", caso.clave, got, caso.octubre)
		}
		if got := reintegroDe(nd, nh, pedido); got != caso.nov {
			t.Errorf("%s: noviembre tiene %v de reintegro, quería %v", caso.clave, got, caso.nov)
		}
	}
}
