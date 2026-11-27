package reportes

import (
	"encoding/json"
	"testing"
)

// «Plata hoy» del mes simulado (H066, H133, H333, H334, H406): el banco
// sumaba solo lo que entraba, un cheque acreditado salía de la cartera sin
// entrar al banco, lo retirado a la caja fuerte desaparecía y, con las cajas
// cerradas, el efectivo también. Ahora cada pase entre lugares deja el total
// igual y lo que sale por el banco lo baja; las tarjetas quedan afuera.
func TestPlataHoyEntraYSale(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	usuario := e.id(t, `select id from "user" limit 1`)
	hoy := "2026-10-15T14:00:00Z" // las 11 en Argentina
	ayer := "2026-10-14T14:00:00Z"

	// Casa Central abierta: 1000 de apertura, 500 de ventas, un depósito en
	// el banco de 300 y un retiro a la caja fuerte de 200. El Aserradero
	// cerró hoy contando 700 (y ayer otro turno, que no cuenta).
	abierta := e.id(t, `insert into cash_sessions (branch_id, abierta_por, abierta_at) values ($1, $2, $3) returning id`, e.central, usuario, hoy)
	e.exec(t, `insert into cash_movements (session_id, tipo, monto, motivo, created_at) values
		($1, 'apertura', 1000, null, $2), ($1, 'venta', 500, null, $2),
		($1, 'retiro', -300, 'Depósito en el banco', $2), ($1, 'retiro', -200, 'A la caja fuerte', $2)`, abierta, hoy)
	e.exec(t, `insert into cash_sessions (branch_id, abierta_por, abierta_at, cerrada_at, estado, contado) values
		($1, $2, '2026-10-15T11:00:00Z', '2026-10-15T15:00:00Z', 'cerrada', 700),
		($1, $2, '2026-10-14T11:00:00Z', '2026-10-14T20:00:00Z', 'cerrada', 9999)`, e.aserradero, usuario)

	// Entró por banco: un recibo de 1000 por transferencia. Con tarjeta,
	// 250 (no suma).
	cliente := e.id(t, `insert into customers (nombre) values ('A') returning id`)
	recibo := e.id(t, `insert into receipts (numero, customer_id, recibido_de, total, estado, origen, created_at) values ('R-1', $1, 'A', 1250, 'emitido', 'panel', $2) returning id`, cliente, hoy)
	e.exec(t, `insert into receipt_parts (receipt_id, medio, importe, orden) values ($1, 'transferencia', 1000, 0), ($1, 'tarjeta_credito', 250, 1)`, recibo)

	// Cheques: uno de 400 en cartera que hoy se deposita y se acredita (pasa
	// al banco), uno de 150 depositado sin acreditar y uno de 600 en cartera.
	acreditado := e.id(t, `insert into cheques (sentido, numero, fecha_pago, importe, estado) values ('recibido', '1', $1, 400, 'cartera') returning id`, ayer)
	e.exec(t, `insert into cheques (sentido, numero, fecha_pago, importe, estado) values ('recibido', '2', $1, 150, 'depositado'), ('recibido', '3', $1, 600, 'cartera')`, ayer)
	e.exec(t, `update cheques set estado = 'depositado' where id = $1`, acreditado)
	e.exec(t, `update cheques set estado = 'acreditado' where id = $1`, acreditado)
	e.exec(t, `update cheque_estados set at = $1 where cheque_id = $2`, hoy, acreditado)

	// Salió por banco: 2000 a un proveedor por transferencia (y uno anulado,
	// uno de ayer y uno pagado con un cheque de la cartera, que no), y una
	// luz de 100 por débito (la de efectivo sale de la caja).
	prov := e.id(t, `insert into suppliers (nombre) values ('Herrajes') returning id`)
	e.exec(t, `insert into supplier_payments (supplier_id, total, neto, medio, fecha) values ($1, 2100, 2000, 'transferencia', $2)`, prov, hoy)
	e.exec(t, `insert into supplier_payments (supplier_id, total, neto, medio, fecha, anulado_at) values ($1, 900, 900, 'transferencia', $2, $2)`, prov, hoy)
	e.exec(t, `insert into supplier_payments (supplier_id, total, neto, medio, fecha) values ($1, 800, 800, 'transferencia', $2)`, prov, ayer)
	conCheque := e.id(t, `insert into supplier_payments (supplier_id, total, neto, medio, fecha) values ($1, 500, 500, 'cheque', $2) returning id`, prov, hoy)
	e.exec(t, `insert into supplier_payment_parts (payment_id, medio, importe) values ($1, 'cheque', 500)`, conCheque)
	e.exec(t, `insert into expenses (fecha, categoria, descripcion, importe, medio) values
		('2026-10-15T00:00:00Z', 'servicios', 'Luz', 100, 'debito'), ('2026-10-15T00:00:00Z', 'flete', 'Flete', 50, 'efectivo')`)

	_, cuerpo, _ := pedir(t, adm, e.u+"inicio/dueno")
	var n NumerosDelDueno
	if err := json.Unmarshal([]byte(cuerpo), &n); err != nil {
		t.Fatal(cuerpo)
	}
	p := n.PlataHoy
	if len(p.Cajas) != 2 || p.Cajas[0].Esperado != 1000 || p.Cajas[0].Cerrada || p.Cajas[1].Esperado != 700 || !p.Cajas[1].Cerrada {
		t.Errorf("cajas: %+v", p.Cajas)
	}
	if p.CajaFuerte != 200 {
		t.Errorf("caja fuerte: %v", p.CajaFuerte)
	}
	// Entró: 1000 del recibo + 300 del depósito + 400 del cheque.
	// Salió: 2000 al proveedor + 100 de la luz.
	if p.BancoEntro != 1700 || p.BancoSalio != 2100 || p.Banco != -400 {
		t.Errorf("banco: entró %v, salió %v, neto %v", p.BancoEntro, p.BancoSalio, p.Banco)
	}
	if p.Cheques != (Monto{600, 1}) || p.ChequesDepositados != (Monto{150, 1}) || p.Tarjetas != 250 {
		t.Errorf("cheques y tarjetas: %+v", p)
	}
	// 1700 de efectivo + 200 de caja fuerte + 600 + 150 de cheques. Lo
	// movido hoy en el banco (−400) es un movimiento y no suma: sin un saldo
	// cargado, el total no es lo que hay (M2S2-100). Las tarjetas tampoco.
	if p.Total != 2650 || p.BancoSaldo != nil {
		t.Errorf("total: %v, saldo del banco %v", p.Total, p.BancoSaldo)
	}
}

// El retiro guarda a dónde va (H333, 00310): el destino manda sobre el
// motivo, «otro» no es caja fuerte ni banco, y los retiros viejos sin
// destino se siguen leyendo por el motivo.
func TestPlataHoyLeeElDestinoDelRetiro(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	usuario := e.id(t, `select id from "user" limit 1`)
	hoy := "2026-10-15T14:00:00Z"
	abierta := e.id(t, `insert into cash_sessions (branch_id, abierta_por, abierta_at) values ($1, $2, $3) returning id`, e.central, usuario, hoy)
	e.exec(t, `insert into cash_movements (session_id, tipo, monto, motivo, destino, created_at) values
		($1, 'apertura', 5000, null, null, $2),
		($1, 'retiro', -1000, 'Lo lleva Juan', 'banco', $2),
		($1, 'retiro', -700, 'Banco de la esquina, para la caja fuerte', 'caja_fuerte', $2),
		($1, 'retiro', -300, 'Pago al fletero', 'otro', $2),
		($1, 'retiro', -40, 'Depósito', null, $2),
		($1, 'retiro', -60, 'Sobre', null, $2)`, abierta, hoy)
	_, cuerpo, _ := pedir(t, adm, e.u+"inicio/dueno")
	var n NumerosDelDueno
	if err := json.Unmarshal([]byte(cuerpo), &n); err != nil {
		t.Fatal(cuerpo)
	}
	p := n.PlataHoy
	if p.CajaFuerte != 760 || p.BancoEntro != 1040 {
		t.Errorf("caja fuerte %v (760), banco %v (1040)", p.CajaFuerte, p.BancoEntro)
	}
}
