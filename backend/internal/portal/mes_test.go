package portal

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

// Lo que encontró el mes simulado en producción (noviembre de 2026).

func TestImputarALaDeudaMasVieja(t *testing.T) {
	// H208: la empresa compró dos pedidos a cuenta y pagó casi todo; los
	// dos decían «Pago pendiente».
	debe := Imputar([]Asiento{
		{870400, "PED-1004"},
		{4113000, "PED-1006"},
		{-3483400, "REC-0001"},
	})
	if debe["PED-1004"] != 0 || debe["PED-1006"] != 1500000 {
		t.Errorf("FIFO: %v", debe)
	}
	// La nota de crédito de un faltante baja su pedido, no el más viejo.
	debe = Imputar([]Asiento{
		{1000, "PED-1"},
		{2000, "PED-2"},
		{-500, "PED-2"},
		{-1000, "REC-1"},
	})
	if debe["PED-1"] != 0 || debe["PED-2"] != 1500 {
		t.Errorf("nota de crédito con referencia: %v", debe)
	}
	// Un ajuste suelto ocupa su lugar en la fila y no aparece.
	debe = Imputar([]Asiento{
		{300, ""},
		{1000, "PED-1"},
		{-800, "REC-1"},
	})
	if debe["PED-1"] != 500 || len(debe) != 1 {
		t.Errorf("ajuste suelto: %v", debe)
	}
	// Pagar de más no deja negativos.
	if debe = Imputar([]Asiento{{100, "PED-1"}, {-300, "REC-1"}}); debe["PED-1"] != 0 {
		t.Errorf("a favor: %v", debe)
	}
}

func TestMisDatosFiscales(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	juan, idJuan := e.web(t, "juan@prueba.test")
	u := e.srv.URL + "/api/v1/cuenta/"

	// H078: el dígito verificador.
	if c, b := pedir(t, juan, "PUT", u+"datos", map[string]string{"nombre": "Juan", "cuit": "23-33555013-8", "condicionIva": "monotributista"}); c != 422 ||
		!strings.Contains(b, "El CUIT no es válido") {
		t.Errorf("CUIT con verificador mal: %d %s", c, b)
	}
	if c, b := pedir(t, juan, "PUT", u+"datos", map[string]string{"nombre": "Juan", "cuit": "23-33555013-7", "condicionIva": "monotributista"}); c != 200 {
		t.Fatalf("CUIT bien: %d %s", c, b)
	}
	// Sin facturas ni cuenta, cambiarlo queda en la bitácora.
	var anotado int
	_ = e.pool.QueryRow(ctx, `select count(*) from audit_log where entidad = 'cliente' and entidad_id = $1`, idJuan).Scan(&anotado)
	if anotado != 1 {
		t.Errorf("bitácora: %d", anotado)
	}

	// H079: con cuenta corriente, lo fiscal ya no se cambia desde acá.
	if _, err := e.pool.Exec(ctx, `insert into account_movements (customer_id, tipo, monto, referencia) values ($1, 'compra', 1000, 'PED-1')`, idJuan); err != nil {
		t.Fatal(err)
	}
	if _, b := pedir(t, juan, "GET", u+"ficha", nil); !strings.Contains(b, `"datosFiscalesFijos":true`) {
		t.Errorf("ficha: %s", b)
	}
	if c, b := pedir(t, juan, "PUT", u+"datos", map[string]string{"nombre": "Juan", "cuit": "", "condicionIva": "consumidor_final"}); c != 422 ||
		!strings.Contains(b, "desde el local") {
		t.Errorf("pasarse a consumidor final: %d %s", c, b)
	}
	// El nombre y el teléfono sí; lo fiscal se queda como estaba.
	if c, b := pedir(t, juan, "PUT", u+"datos", map[string]string{"nombre": "Juan Pérez", "telefono": "223 555"}); c != 200 {
		t.Fatalf("nombre: %d %s", c, b)
	}
	_, b := pedir(t, juan, "GET", u+"ficha", nil)
	if !strings.Contains(b, `"nombre":"Juan Pérez"`) || !strings.Contains(b, `"cuit":"23335550137"`) || !strings.Contains(b, `"condicionIva":"monotributista"`) {
		t.Errorf("ficha después: %s", b)
	}
}

func TestPedidosParaElCliente(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	juan, idJuan := e.web(t, "juan@prueba.test")
	u := e.srv.URL + "/api/v1/cuenta/"
	pedido := func(numero, estado, origen, medio, notas string, total float64) {
		if _, err := e.pool.Exec(ctx, `insert into orders (numero, contacto_nombre, customer_id, total, subtotal, estado, origen, medio_pago, notas)
			values ($1, 'Juan', $2, $3, $3, $4::estado_pedido, $5::origen_pedido, $6::medio_pago, nullif($7, ''))`,
			numero, idJuan, total, estado, origen, medio, notas); err != nil {
			t.Fatal(err)
		}
	}
	pedido("PED-1004", "entregado", "mostrador", "cuenta_corriente", "Pidió por WhatsApp. Ojo, paga tarde", 870400)
	pedido("PED-1006", "pendiente", "mostrador", "cuenta_corriente", "", 4113000)
	pedido("PED-1121", "cancelado", "mostrador", "cuenta_corriente", "Anulada: se cargó a la Mueblería y era de la Constructora", 100)
	pedido("PED-1200", "cancelado", "tienda", "transferencia", "Tocar timbre\nAnulada: sin stock", 100)
	for _, m := range []struct {
		tipo  string
		monto float64
		ref   string
	}{{"compra", 870400, "PED-1004"}, {"compra", 4113000, "PED-1006"}, {"pago", -3483400, "REC-0001"}} {
		if _, err := e.pool.Exec(ctx, `insert into account_movements (customer_id, tipo, monto, referencia) values ($1, $2::tipo_movimiento_cuenta, $3, $4)`,
			idJuan, m.tipo, m.monto, m.ref); err != nil {
			t.Fatal(err)
		}
	}

	_, b := pedir(t, juan, "GET", u+"pedidos", nil)
	var lista []Pedido
	_ = json.Unmarshal([]byte(b), &lista)
	porNumero := map[string]Pedido{}
	for _, p := range lista {
		porNumero[p.Numero] = p
	}
	// H386: la venta del mostrador anulada sin remito ni factura no se lista.
	if _, ok := porNumero["PED-1121"]; ok {
		t.Errorf("la venta anulada del cliente equivocado sigue en la lista: %s", b)
	}
	if _, ok := porNumero["PED-1200"]; !ok {
		t.Errorf("el pedido de la tienda cancelado tiene que seguir: %s", b)
	}
	// H208: lo que falta de cada pedido a cuenta.
	if p := porNumero["PED-1004"]; p.DebeEnCuenta == nil || *p.DebeEnCuenta != 0 {
		t.Errorf("PED-1004: %+v", p)
	}
	if p := porNumero["PED-1006"]; p.DebeEnCuenta == nil || *p.DebeEnCuenta != 1500000 {
		t.Errorf("PED-1006: %+v", p)
	}
	if p := porNumero["PED-1200"]; p.DebeEnCuenta != nil {
		t.Errorf("un pedido sin cuenta no debe nada en la cuenta: %+v", p)
	}

	// H084: las notas del vendedor no le llegan como «Tu nota».
	if _, b := pedir(t, juan, "GET", u+"pedidos/PED-1004", nil); strings.Contains(b, "paga tarde") || !strings.Contains(b, `"debeEnCuenta":0`) {
		t.Errorf("notas del vendedor: %s", b)
	}
	// H310/H386: la del cliente queda, el motivo de la anulación no.
	if _, b := pedir(t, juan, "GET", u+"pedidos/PED-1200", nil); !strings.Contains(b, `"notas":"Tocar timbre"`) || strings.Contains(b, "sin stock") {
		t.Errorf("notas de la tienda: %s", b)
	}
	// El detalle de la anulada se sigue abriendo por número.
	if c, b := pedir(t, juan, "GET", u+"pedidos/PED-1121", nil); c != 200 || strings.Contains(b, "Mueblería") {
		t.Errorf("detalle de la anulada: %d %s", c, b)
	}
}

func TestPresupuestoConSuPedido(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	juan, idJuan := e.web(t, "juan@prueba.test")
	var q string
	if err := e.pool.QueryRow(ctx, `insert into quotes (numero, customer_id, contacto_nombre, estado, subtotal, total)
		values ('P-2026-0013', $1, 'Juan', 'aceptado', 1000, 1000) returning id`, idJuan).Scan(&q); err != nil {
		t.Fatal(err)
	}
	if _, b := pedir(t, juan, "GET", e.srv.URL+"/api/v1/cuenta/presupuestos/P-2026-0013", nil); strings.Contains(b, `"pedido":"`) {
		t.Errorf("sin pedido todavía: %s", b)
	}
	if _, err := e.pool.Exec(ctx, `insert into orders (numero, contacto_nombre, customer_id, quote_id, total, subtotal)
		values ('PED-1300', 'Juan', $1, $2, 1000, 1000)`, idJuan, q); err != nil {
		t.Fatal(err)
	}
	if _, b := pedir(t, juan, "GET", e.srv.URL+"/api/v1/cuenta/presupuestos/P-2026-0013", nil); !strings.Contains(b, `"pedido":"PED-1300"`) {
		t.Errorf("H215, el pedido del presupuesto: %s", b)
	}
}

// H210: el cliente ve su corte atado al pedido, con el estado y el despiece.
func TestPedidoConSuCorte(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	juan, idJuan := e.web(t, "juan@prueba.test")
	var pedido, corte string
	if err := e.pool.QueryRow(ctx, `insert into orders (numero, contacto_nombre, customer_id, total, subtotal)
		values ('PED-1005', 'Juan', $1, 1000, 1000) returning id`, idJuan).Scan(&pedido); err != nil {
		t.Fatal(err)
	}
	if err := e.pool.QueryRow(ctx, `insert into cutting_orders (numero, contacto_nombre, customer_id, order_id, material_descripcion, placas, estado)
		values ('CRT-1', 'Juan', $1, $2, 'Melamina blanca 18 mm', 2, 'terminado') returning id`, idJuan, pedido).Scan(&corte); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(ctx, `insert into cutting_items (cutting_order_id, largo_mm, ancho_mm, cantidad, orden) values ($1, 600, 400, 4, 0)`, corte); err != nil {
		t.Fatal(err)
	}
	_, b := pedir(t, juan, "GET", e.srv.URL+"/api/v1/cuenta/pedidos/PED-1005", nil)
	if !strings.Contains(b, `"numero":"CRT-1"`) || !strings.Contains(b, `"estado":"terminado"`) || !strings.Contains(b, `"largoMm":600`) {
		t.Errorf("el corte del pedido: %s", b)
	}
}

// H302: la nota de crédito de un faltante aparece en su pedido y baja lo que
// falta pagar de ese pedido, no del más viejo.
func TestPedidoConSuNotaDeCredito(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	juan, idJuan := e.web(t, "juan@prueba.test")
	if _, err := e.pool.Exec(ctx, `insert into orders (numero, contacto_nombre, customer_id, total, subtotal, medio_pago)
		values ('PED-1004', 'Juan', $1, 1000, 1000, 'cuenta_corriente'), ('PED-1006', 'Juan', $1, 4113000, 4113000, 'cuenta_corriente')`, idJuan); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(ctx, `insert into account_movements (customer_id, tipo, monto, referencia, detalle, created_at) values
		($1, 'compra', 1000, 'PED-1004', null, now() - interval '3 day'),
		($1, 'compra', 4113000, 'PED-1006', null, now() - interval '2 day'),
		($1, 'nota_credito', -187000, 'PED-1006', 'Faltante en REM-0002: 10 machimbres', now() - interval '1 day')`, idJuan); err != nil {
		t.Fatal(err)
	}
	_, b := pedir(t, juan, "GET", e.srv.URL+"/api/v1/cuenta/pedidos/PED-1006", nil)
	if !strings.Contains(b, `"monto":-187000`) || !strings.Contains(b, "Faltante en REM-0002") || !strings.Contains(b, `"debeEnCuenta":3926000`) {
		t.Errorf("la nota de crédito del faltante: %s", b)
	}
	if _, b := pedir(t, juan, "GET", e.srv.URL+"/api/v1/cuenta/pedidos/PED-1004", nil); !strings.Contains(b, `"debeEnCuenta":1000`) {
		t.Errorf("la del faltante no es del pedido más viejo: %s", b)
	}
}
