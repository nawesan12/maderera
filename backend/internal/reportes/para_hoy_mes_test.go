package reportes

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"mjbj/internal/pruebas"
)

// pendientesDe pide los pendientes de un cliente y los indexa por clave.
func pendientesDelInicio(t *testing.T, c *http.Client, url string) (map[string]Pendiente, []Pendiente) {
	t.Helper()
	_, cuerpo, _ := pedir(t, c, url)
	var lista []Pendiente
	if err := json.Unmarshal([]byte(cuerpo), &lista); err != nil {
		t.Fatal(cuerpo)
	}
	por := map[string]Pendiente{}
	for _, p := range lista {
		por[p.Clave] = p
	}
	return por, lista
}

// Lo que el mes simulado encontró en el inicio (H102, H323, H358, H379,
// H067, H201, H141, H285, H298, H396): cada cifra igual a la de la pantalla
// a la que lleva, lo que faltaba (compras, cheques, transferencias, CAE,
// presupuestos, PIN) y la urgencia según quién mira.
func TestParaHoyDelMesSimulado(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	dep := e.staff(t, "deposito@prueba.test", "deposito")
	placa, _ := e.catalogo(t)
	ahora := ahoraDePrueba

	// Pedidos: uno listo y uno en camino. El chip cuenta solo el listo.
	e.pedido(t, "L-1", e.central, "listo", "mostrador", ahora.Add(-time.Hour), nil)
	e.pedido(t, "L-2", e.central, "en-camino", "mostrador", ahora.Add(-time.Hour), nil)

	// Stock: la placa tiene una fila bajo el mínimo en Central (10 de 20) y
	// otra en el Aserradero en 0 con mínimo: una sola medida para reponer,
	// como Stock (antes contaba filas por sucursal).
	e.exec(t, `update inventory set min_qty = 3 where variant_id = $1 and branch_id = $2`, placa, e.aserradero)
	e.exec(t, `update inventory set qty = 0 where variant_id = $1 and branch_id = $2`, placa, e.aserradero)

	// Cheques: uno rechazado hoy, uno informado por el cliente.
	ch := e.id(t, `insert into cheques (sentido, numero, fecha_pago, importe, estado) values ('recibido', '9', '2026-10-10T15:00:00Z', 400, 'depositado') returning id`)
	e.exec(t, `update cheques set estado = 'rechazado' where id = $1`, ch)
	e.exec(t, `update cheque_estados set at = '2026-10-15T13:00:00Z' where cheque_id = $1`, ch)
	e.exec(t, `insert into cheques (sentido, numero, fecha_pago, importe, estado) values ('recibido', '10', '2026-10-20T15:00:00Z', 100, 'informado')`)

	// Una transferencia a verificar.
	e.exec(t, `insert into payments (tipo, proveedor, medio, monto, estado) values ('deuda', 'transferencia', 'transferencia', 500, 'en_revision')`)

	// Compras: la OC atrasada, la que llega mañana y una completa (no).
	prov := e.id(t, `insert into suppliers (nombre) values ('Herrajes') returning id`)
	e.exec(t, `insert into purchase_orders (numero, supplier_id, branch_id, estado, fecha_prometida) values
		('OC-1', $1, $2, 'enviada', '2026-10-13T15:00:00Z'), ('OC-2', $1, $2, 'parcial', '2026-10-16T15:00:00Z'),
		('OC-3', $1, $2, 'completa', '2026-10-01T15:00:00Z')`, prov, e.central)
	// Una recepción confirmada sin factura.
	e.exec(t, `insert into goods_receipts (supplier_id, branch_id, estado) values ($1, $2, 'confirmada')`, prov, e.central)
	// Una factura vencida de un proveedor al que una nota de crédito dejó
	// sin deuda: no es vencida para «Debo», tampoco acá.
	e.exec(t, `insert into purchase_invoices (supplier_id, tipo, punto_venta, numero, neto, iva21, iva105, iva27, percepciones, total, fecha_emision, fecha_vencimiento)
		values ($1, 'factura_a', 1, 1, 1000, 0, 0, 0, 0, 1000, '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z')`, prov)
	e.exec(t, `insert into supplier_movements (supplier_id, tipo, monto) values ($1, 'factura', 1000), ($1, 'nota_credito', -1000)`, prov)

	// Un comprobante sin CAE.
	e.exec(t, `insert into invoices (tipo, punto_venta, numero, estado, receptor_nombre, neto, total) values ('factura_b', 1, 1, 'emitida', 'A', 100, 121)`)

	// Presupuestos: uno enviado vigente y uno aceptado sin pedido.
	e.exec(t, `insert into quotes (numero, contacto_nombre, estado, valido_hasta) values ('P-1', 'X', 'enviado', '2026-11-30T15:00:00Z'),
		('P-2', 'Y', 'aceptado', null)`)

	// WhatsApp derivado por el bot y sin nadie.
	e.exec(t, `insert into whatsapp_conversaciones (wa_jid, bot_estado) values ('1@s', 'derivada'), ('2@s', 'activo')`)

	// Cortes: uno en la cola y uno para retirar hoy.
	e.exec(t, `insert into cutting_orders (numero, contacto_nombre, material_descripcion, estado, retira_el) values
		('C-1', 'X', 'MDF', 'en-cola', null), ('C-2', 'Y', 'MDF', 'terminado', '2026-10-15')`)

	// Una medida sin foto (tienda apagada): va al final aunque sean muchas.
	pruebas.TiendaApagada(t, e.pool)

	por, lista := pendientesDelInicio(t, adm, e.u+"inicio/pendientes")
	quiere := map[string]int{"entregar": 1, "reponer": 1, "cheques-rechazados": 1, "cheques-por-recibir": 1, "transferencias": 1,
		"ordenes-atrasadas": 1, "ordenes-por-llegar": 1, "recepciones-sin-factura": 1, "sin-cae": 1, "presupuestos-enviados": 1,
		"presupuestos-aceptados": 1, "whatsapp-sin-asignar": 1, "cortes": 1, "cortes-hoy": 1, "pin": 1, "avisos": 1}
	for clave, n := range quiere {
		if por[clave].Cantidad != n {
			t.Errorf("%s: quiere %d, hay %+v", clave, n, por[clave])
		}
	}
	if _, hay := por["compras-vencidas"]; hay {
		t.Errorf("la factura cubierta por la nota de crédito no está vencida: %+v", por["compras-vencidas"])
	}
	if por["reponer"].Href != "/admin/stock?estado=reponer" {
		t.Errorf("reponer lleva al grupo de Stock: %s", por["reponer"].Href)
	}
	if !por["cheques-rechazados"].Vencido || !por["ordenes-atrasadas"].Vencido || !por["pin"].Urgente {
		t.Errorf("urgencias: %+v", lista)
	}
	// El catálogo, al final de lo que no apura.
	ultimo := lista[len(lista)-1]
	if len(ultimo.Clave) < 9 || ultimo.Clave[:9] != "catalogo-" {
		t.Errorf("el catálogo va al final: %+v", lista)
	}

	// Quien atiende: los presupuestos que esperan respuesta son de hoy; la
	// cola del taller, no. No ve compras, cheques ni el PIN.
	por, _ = pendientesDelInicio(t, ven, e.u+"inicio/pendientes")
	if !por["presupuestos-enviados"].Urgente || por["cortes"].Urgente || !por["cortes-hoy"].Urgente {
		t.Errorf("vendedor: %+v", por)
	}
	// El cheque rechazado sí lo ve, para reclamarlo desde el seguimiento
	// del cliente (M2S4-026).
	if por["cheques-rechazados"].Href != "/admin/clientes/seguimiento" {
		t.Errorf("rechazado del vendedor: %+v", por["cheques-rechazados"])
	}
	for _, no := range []string{"pin", "avisos", "ordenes-atrasadas", "transferencias", "sin-cae"} {
		if _, hay := por[no]; hay {
			t.Errorf("el vendedor no ve %s", no)
		}
	}
	// El depósito: entregar es lo de hoy.
	por, _ = pendientesDelInicio(t, dep, e.u+"inicio/pendientes")
	if !por["entregar"].Urgente || !por["cortes"].Urgente {
		t.Errorf("depósito: %+v", por)
	}

	// Con un PIN cargado, el pendiente se va.
	e.exec(t, `update "user" set pin_autorizacion = 'x' where email = 'admin@prueba.test'`)
	if por, _ = pendientesDelInicio(t, adm, e.u+"inicio/pendientes"); por["pin"].Cantidad != 0 {
		t.Errorf("con PIN: %+v", por["pin"])
	}
	// Con un dispositivo de un admin suscrito, el de los avisos también
	// (recorrido, M4-119).
	e.exec(t, `insert into push_subscriptions (user_id, endpoint, p256dh, auth) select id, 'https://push.test/1', 'k', 'a' from "user" where email = 'admin@prueba.test'`)
	if por, _ = pendientesDelInicio(t, adm, e.u+"inicio/pendientes"); por["avisos"].Cantidad != 0 {
		t.Errorf("con un dispositivo: %+v", por["avisos"])
	}
}
