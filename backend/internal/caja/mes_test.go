package caja

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"
)

// Lo que encontró el mes simulado en la caja del panel:
//
//   - H238: el turno cerrado trae la cuenta del efectivo (fondo, ventas,
//     otros ingresos, retiros, gastos), y suma «Tendría que haber».
//   - H356: dice desde qué puesto se abrió.
//   - H176 y H259: el cobro de cuenta por banco y con cheque tomado en el
//     mostrador figura en el cierre Z del turno.
//   - H157: el recibo cobrado en efectivo desde el panel y el gasto en
//     efectivo sin caja se ven como efectivo fuera de caja.
//   - H243: la caja que se usó para un turno no dice «nunca se vinculó».
func TestLaCajaDelMesSimulado(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	adm, admID := e.staff(t, "admin@prueba.test", "admin")
	abre := time.Now().Add(-5 * time.Hour)
	cierra := time.Now().Add(-1 * time.Hour)
	puesto := e.id(t, `insert into pos_devices (codigo, branch_id, secreto) values ('CAJA2', $1, 's') returning id`, e.central)
	turno := e.id(t, `insert into cash_sessions (branch_id, abierta_por, abierta_at, cerrada_at, estado, contado, pos_device_id)
		values ($1, $2, $3, $4, 'cerrada', 193166, $5) returning id`, e.central, admID, abre, cierra, puesto)
	for _, m := range []struct {
		tipo  string
		monto float64
	}{{"apertura", 50000}, {"venta", 243166}, {"ingreso", 200000}, {"retiro", -300000}, {"gasto", 0}} {
		if m.monto == 0 {
			continue
		}
		e.id(t, `insert into cash_movements (session_id, tipo, monto, created_at) values ($1, $2, $3, $4) returning id`, turno, m.tipo, m.monto, abre.Add(time.Hour))
	}
	// Un recibo de cuenta tomado en el mostrador en ese turno: transferencia
	// y cheque.
	cliente := e.id(t, `insert into customers (nombre) values ('Constructora del Sur') returning id`)
	rec := e.id(t, `insert into receipts (numero, customer_id, recibido_de, branch_id, total, origen, created_at)
		values ('REC-0006', $1, 'Constructora del Sur', $2, 1200000, 'mostrador', $3) returning id`, cliente, e.central, abre.Add(2*time.Hour))
	e.id(t, `insert into receipt_parts (receipt_id, medio, importe) values ($1, 'transferencia', 800000) returning id`, rec)
	e.id(t, `insert into receipt_parts (receipt_id, medio, importe, orden) values ($1, 'cheque', 400000, 1) returning id`, rec)
	// Un recibo en efectivo desde el panel, que nunca pasó por una caja, y
	// un gasto en efectivo sin turno.
	panel := e.id(t, `insert into receipts (numero, customer_id, recibido_de, branch_id, total, origen, created_at)
		values ('REC-0002', $1, 'Constructora del Sur', $2, 300000, 'panel', now() - interval '3 hours') returning id`, cliente, e.central)
	e.id(t, `insert into receipt_parts (receipt_id, medio, importe) values ($1, 'efectivo', 300000) returning id`, panel)
	e.id(t, `insert into expenses (fecha, categoria, descripcion, importe, medio, circuito, branch_id) values (now() - interval '2 hours', 'flete', 'Flete Placas del Sur', 45000, 'efectivo', 'blanco', $1) returning id`, e.central)

	_, b := pedir(t, adm, "GET", e.u+"turnos-cerrados", nil)
	var pagina struct {
		Filas []TurnoCerrado `json:"filas"`
	}
	if err := json.Unmarshal([]byte(b), &pagina); err != nil || len(pagina.Filas) != 1 {
		t.Fatalf("turnos: %s", b)
	}
	tc := pagina.Filas[0]
	if tc.Fondo != 50000 || tc.Ventas != 243166 || tc.OtrosIngresos != 200000 || tc.Retiros != -300000 ||
		tc.Fondo+tc.Ventas+tc.OtrosIngresos+tc.Retiros+tc.Devoluciones+tc.Gastos != tc.Esperado || tc.Esperado != 193166 {
		t.Errorf("la cuenta del turno: %+v", tc)
	}
	if tc.Puesto == nil || *tc.Puesto != "CAJA2" {
		t.Errorf("puesto: %v", tc.Puesto)
	}
	if z := fmt.Sprint(tc.Cierre); !strings.Contains(z, "{transferencia 1 800000 false <nil> true}") || !strings.Contains(z, "{cheque 1 400000 false <nil> true}") {
		t.Errorf("el cobro de cuenta no está en el Z: %s", z)
	}
	if strings.Contains(fmt.Sprint(tc.Cierre), "efectivo 1 300000") {
		t.Errorf("el recibo del panel no es del turno: %+v", tc.Cierre)
	}

	_, b = pedir(t, adm, "GET", e.u+"fuera-de-caja", nil)
	var fuera []FueraDeCaja
	if err := json.Unmarshal([]byte(b), &fuera); err != nil || len(fuera) != 2 {
		t.Fatalf("fuera de caja: %s", b)
	}
	suma := 0.0
	for _, f := range fuera {
		suma += f.Monto
	}
	if suma != 255000 {
		t.Errorf("neto fuera de caja: %v (%s)", suma, b)
	}
	// El pago a un proveedor en efectivo sin caja también queda afuera, por
	// lo que fue en efectivo: Compras lo registra igual y avisa.
	prov := e.id(t, `insert into suppliers (nombre) values ('Placas del Sur') returning id`)
	pago := e.id(t, `insert into supplier_payments (supplier_id, fecha, total, neto, medio) values ($1, now() - interval '1 hour', 80000, 80000, 'efectivo + transferencia') returning id`, prov)
	e.id(t, `insert into supplier_payment_parts (payment_id, medio, importe) values ($1, 'efectivo', 30000) returning id`, pago)
	e.id(t, `insert into supplier_payment_parts (payment_id, medio, importe) values ($1, 'transferencia', 50000) returning id`, pago)
	_, b = pedir(t, adm, "GET", e.u+"fuera-de-caja", nil)
	if err := json.Unmarshal([]byte(b), &fuera); err != nil || len(fuera) != 3 {
		t.Fatalf("fuera de caja con el pago: %s", b)
	}
	if !strings.Contains(b, `"tipo":"pago"`) || !strings.Contains(b, `"monto":-30000`) || !strings.Contains(b, "Placas del Sur") {
		t.Errorf("el pago en efectivo sin caja: %s", b)
	}
	e.id(t, `insert into cash_movements (session_id, tipo, monto, motivo, supplier_payment_id) values ($1, 'gasto', -30000, 'Pago a Placas del Sur', $2) returning id`, turno, pago)
	_, b = pedir(t, adm, "GET", e.u+"fuera-de-caja", nil)
	if strings.Contains(b, `"tipo":"pago"`) {
		t.Errorf("el pago que salió de un turno sigue afuera: %s", b)
	}

	// Un recibo cuyo efectivo sí entró a un turno no aparece.
	e.id(t, `insert into cash_movements (session_id, tipo, monto, motivo) values ($1, 'ingreso', 300000, 'Recibo REC-0002 — Constructora del Sur') returning id`, turno)
	_, b = pedir(t, adm, "GET", e.u+"fuera-de-caja", nil)
	if strings.Contains(b, "REC-0002") {
		t.Errorf("el recibo que entró a la caja sigue afuera: %s", b)
	}

	// La caja que abrió un turno dice cuándo, aunque se haya desvinculado.
	if _, err := e.pool.Exec(ctx, `update pos_devices set ultima_vez_at = null`); err != nil {
		t.Fatal(err)
	}
	cajas, err := NuevoPanel(e.pool, silencio).ListarCajasFisicas(ctx)
	if err != nil || len(cajas) != 1 || cajas[0].UltimoTurnoAt == nil {
		t.Errorf("cajas: %+v %v", cajas, err)
	}
	if uno, err := TurnoCerradoPorID(ctx, e.pool, turno); err != nil || uno == nil || uno.Esperado != 193166 {
		t.Errorf("un turno: %+v %v", uno, err)
	}
}
