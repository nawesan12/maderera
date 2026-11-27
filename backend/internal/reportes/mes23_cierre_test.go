package reportes

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"mjbj/internal/reglas"
)

// El cierre que encontró el mes simulado (tanda 23): lo que salía de la caja
// sin asiento, el libro diario desordenado, la factura manual fuera de lo
// vendido y los avisos que no decían cuáles eran.

// M2S3-003 y M3S2-004: el retiro «otro» y el cheque sin cobro van a
// Movimientos a imputar, y el cierre lo avisa.
func TestLoQueNoSeSabeContraQueVaAImputar(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	sesion := e.id(t, `insert into cash_sessions (branch_id, abierta_por, estado) select $1, id, 'abierta' from "user" limit 1 returning id`, e.central)
	e.exec(t, `insert into cash_movements (session_id, tipo, monto, motivo, destino, created_at) values
		($1, 'retiro', -20000, 'Sim pago al flete', 'otro', '2026-10-10T15:00:00Z')`, sesion)
	e.exec(t, `insert into cheques (sentido, numero, banco, fecha_pago, importe, estado, created_at) values ('recibido', '99901', 'Ciudad', '2026-10-12', 50000, 'cartera', '2026-10-11T15:00:00Z')`)
	a := DelCircuito(e.asientosDe(t, "2026-10"), "")
	if x := buscarAsiento(a, "Retiro de la caja de Casa Central · Sim pago al flete"); x == nil || cuenta([]Asiento{*x}, Cuentas.Caja) != -20000 ||
		cuenta([]Asiento{*x}, Cuentas.MovimientosAImputar) != 20000 {
		t.Errorf("el retiro: %+v", x)
	}
	if x := buscarAsiento(a, "Cheque N° 99901 · Ciudad recibido sin cobro"); x == nil || cuenta([]Asiento{*x}, Cuentas.ValoresADepositar) != 50000 {
		t.Errorf("el cheque: %+v", x)
	}
	_, cuerpo, _ := pedir(t, adm, e.u+"cierre/pendientes?periodo=2026-10")
	if p, ok := pendientesDe(t, cuerpo)["a-imputar"]; !ok || p.Cantidad != 2 {
		t.Errorf("el aviso: %s", cuerpo)
	}
}

// M3S1-009: el libro diario va por día: la factura de compra del 27 (a las
// 0 UTC) no queda entre los asientos del 26 a la noche.
func TestElDiarioVaPorDia(t *testing.T) {
	asientos := []Asiento{
		{Fecha: time.Date(2026, 11, 27, 0, 0, 0, 0, time.UTC), Concepto: "compra del 27"},
		{Fecha: time.Date(2026, 11, 26, 23, 0, 0, 0, Argentina), Concepto: "recibo del 26", Instante: true},
		{Fecha: time.Date(2026, 11, 27, 10, 0, 0, 0, Argentina), Concepto: "venta del 27", Instante: true},
		{Fecha: time.Date(2026, 11, 26, 0, 0, 0, 0, time.UTC), Concepto: "gasto del 26"},
	}
	OrdenarAsientos(asientos)
	var orden []string
	for _, a := range asientos {
		orden = append(orden, a.Concepto)
	}
	if strings.Join(orden, ", ") != "gasto del 26, recibo del 26, compra del 27, venta del 27" {
		t.Errorf("%v", orden)
	}
}

// M2S1-009, M2S1-055 y M2S2-003: la factura manual es venta; la tarjeta de
// gastos es la del estudio, con el B aparte; las compras no cuentan la
// factura de un gasto y el resultado no cuenta como gasto el IVA que es
// crédito fiscal.
func TestElResumenDelMesCuentaCadaCosaUnaVez(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	e.exec(t, `insert into invoices (tipo, punto_venta, numero, receptor_nombre, neto, iva21, iva105, iva27, tributos, total, estado,
		fecha_emision, created_at) values ('factura_b', 15, 5, 'Jorge Benítez', 20661.16, 4338.84, 0, 0, 0, 25000, 'emitida',
		'2026-10-10T15:00:00Z', '2026-10-10T15:00:00Z')`)
	prov := e.id(t, `insert into suppliers (nombre) values ('Inmobiliaria') returning id`)
	fac := e.id(t, `insert into purchase_invoices (supplier_id, tipo, punto_venta, numero, fecha_emision, neto, iva21, total)
		values ($1, 'factura_a', 2, 345, '2026-10-05', 371900.83, 78099.17, 450000) returning id`, prov)
	e.exec(t, `insert into expenses (fecha, categoria, descripcion, importe, medio, purchase_invoice_id) values ('2026-10-05', 'alquiler', 'Alquiler', 450000, 'transferencia', $1)`, fac)
	e.exec(t, `insert into expenses (fecha, categoria, descripcion, importe, medio, circuito) values ('2026-10-06', 'mantenimiento', 'Arreglo de la sierra', 30000, 'efectivo', 'negro')`)
	_, cuerpo, _ := pedir(t, adm, e.u+"cierre/resumen?periodo=2026-10")
	var r ResumenDelMes
	if err := json.Unmarshal([]byte(cuerpo), &r); err != nil {
		t.Fatal(err)
	}
	if r.Vendido.SinCae.Total != 20661.16 || r.Vendido.SinCae.Cantidad != 1 || r.Resultado.Actual.VentasNetas != 20661.16 {
		t.Errorf("la factura manual es venta: %+v %+v", r.Vendido, r.Resultado.Actual)
	}
	if r.Gastos.Total != 450000 || r.Gastos.Cantidad != 1 || r.GastosB.Total != 30000 || r.GastosB.Cantidad != 1 {
		t.Errorf("gastos: %+v B %+v", r.Gastos, r.GastosB)
	}
	if r.Compras.Neto != 0 || r.Compras.Cantidad != 0 || r.Compras.Iva != 78099.17 {
		t.Errorf("compras: %+v", r.Compras)
	}
	if r.Resultado.Actual.Gastos != 401900.83 {
		t.Errorf("el resultado resta el alquiler sin su IVA y el arreglo: %+v", r.Resultado.Actual)
	}
	if r.PrimerMes != "2026-10" {
		t.Errorf("el primer mes con datos: %q", r.PrimerMes)
	}
}

// M3S3-002: la deuda cargada a mano, con las dos salidas de la regla: al B
// (su cobro es venta sin factura) o al estudio contra Saldos iniciales (su
// cobro la cancela en Deudores).
func TestLaDeudaSinComprobanteSegunLaRegla(t *testing.T) {
	for _, regla := range []string{"circuito_b", "saldo_inicial"} {
		t.Run(regla, func(t *testing.T) {
			e := armar(t)
			if err := reglas.Fijar(context.Background(), e.pool, reglas.DeudaSinComprobante, regla); err != nil {
				t.Fatal(err)
			}
			cli := e.id(t, `insert into customers (nombre) values ('Herrería') returning id`)
			e.exec(t, `insert into account_movements (customer_id, tipo, monto, detalle, created_at) values ($1, 'nota_debito', 180000, 'Saldo del sistema viejo', '2026-10-02T15:00:00Z')`, cli)
			_, rep := e.reciboDe(t, &cli, nil, "REC-0090", "2026-10-05T15:00:00Z", [2]any{"transferencia", 100000.0})
			a := e.asientosDe(t, "2026-10")
			if regla == "circuito_b" {
				if rep.B != 100000 || cuenta(DelCircuito(a, CircuitoNegro), Cuentas.VentasSinFactura) != -100000 {
					t.Errorf("al B: %+v", rep)
				}
				return
			}
			blanco := DelCircuito(a, "")
			if rep.Deudores != 100000 || rep.B != 0 {
				t.Errorf("cancela la deuda de arranque: %+v", rep)
			}
			if cuenta(blanco, Cuentas.SaldosIniciales) != -180000 || cuenta(blanco, Cuentas.Deudores) != 80000 {
				t.Errorf("el saldo en el estudio: %v %v", cuenta(blanco, Cuentas.SaldosIniciales), cuenta(blanco, Cuentas.Deudores))
			}
			if len(DelCircuito(a, CircuitoNegro)) != 0 {
				t.Errorf("nada al B")
			}
		})
	}
}

// M3S1-019 y M3S2-042: el saldo inicial de un proveedor tiene asiento, el
// cierre avisa si un libro no da el mayor, y las recepciones sin factura
// van una por una.
func TestProveedoresContraElMayor(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	prov := e.id(t, `insert into suppliers (nombre) values ('Tableros Costa') returning id`)
	e.exec(t, `insert into supplier_movements (supplier_id, tipo, monto, detalle, referencia, created_at) values ($1, 'ajuste', 85000, 'Saldo inicial migrado del sistema anterior', 'SALDO-INICIAL-PROV', '2026-10-01T15:00:00Z')`, prov)
	a := DelCircuito(e.asientosDe(t, "2026-10"), "")
	if x := buscarAsiento(a, "Saldo inicial migrado del sistema anterior · Tableros Costa"); x == nil || cuenta([]Asiento{*x}, Cuentas.Proveedores) != -85000 {
		t.Errorf("el saldo inicial: %+v", x)
	}
	_, cuerpo, _ := pedir(t, adm, e.u+"cierre/pendientes?periodo=2026-10")
	if _, ok := pendientesDe(t, cuerpo)["proveedores-mayor"]; ok {
		t.Errorf("con su asiento, el libro da el mayor: %s", cuerpo)
	}
	// Un pago en negro de una factura en blanco: el libro baja y el mayor no.
	e.exec(t, `insert into purchase_invoices (supplier_id, tipo, punto_venta, numero, fecha_emision, neto, iva21, total) values ($1, 'factura_a', 7, 1120, '2026-10-03', 100000, 21000, 121000)`, prov)
	e.exec(t, `insert into supplier_movements (supplier_id, tipo, monto, purchase_invoice_id) select $1, 'factura', 121000, id from purchase_invoices where supplier_id = $1`, prov)
	e.exec(t, `insert into supplier_payments (supplier_id, fecha, total, neto, medio, circuito) values ($1, '2026-10-04T15:00:00Z', 121000, 121000, 'efectivo', 'negro')`, prov)
	e.exec(t, `insert into supplier_movements (supplier_id, tipo, monto) values ($1, 'pago', -121000)`, prov)
	e.exec(t, `update supplier_movements set supplier_payment_id = (select id from supplier_payments where supplier_id = $1) where tipo = 'pago' and supplier_id = $1`, prov)
	_, cuerpo, _ = pedir(t, adm, e.u+"cierre/pendientes?periodo=2026-10")
	p, ok := pendientesDe(t, cuerpo)["proveedores-mayor"]
	if !ok || len(p.Casos) != 1 || p.Casos[0].Nombre != "Tableros Costa" || *p.Casos[0].Importe != -121000 || p.Donde != "/admin/proveedores/"+prov {
		t.Errorf("el aviso con su proveedor: %s", cuerpo)
	}
}

func TestElArchivoLlevaElDiaArgentino(t *testing.T) {
	if n := ArchivoDelDia("deudores", time.Date(2026, 11, 27, 2, 49, 0, 0, time.UTC)); n != "deudores-2026-11-26.csv" {
		t.Error(n)
	}
}

// M2S4-030, M3S3-039 y M2S1-045: el total con IVA es el mismo en todos los
// cortes (lo que los renglones no llevan va en «Envíos y descuentos») y la
// compra de un cliente en la tienda va a «Tienda web», no con su nombre.
func TestLosCortesDanElMismoTotal(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	placa, _ := e.catalogo(t)
	e.exec(t, `insert into "user" (id, name, email, email_verified, created_at, updated_at) values ('u-ignacio', 'Ignacio Ebanista', 'ignacio@prueba.test', true, now(), now())`)
	web := e.pedido(t, "PED-1238", e.central, "entregado", "tienda", time.Date(2026, 10, 10, 12, 0, 0, 0, Argentina), nil, [4]any{placa, 1.0, 17280.0, 9000.0})
	e.exec(t, `update orders set created_by_user_id = 'u-ignacio', costo_envio = 1210, total = 18490 where id = $1`, web)
	e.pedido(t, "PED-1239", e.central, "entregado", "mostrador", time.Date(2026, 10, 11, 12, 0, 0, 0, Argentina), nil, [4]any{placa, 1.0, 1210.0, 500.0})
	var totales []float64
	for _, corte := range []string{"producto", "rubro", "vendedor", "canal"} {
		_, b, _ := pedir(t, adm, e.u+"reportes/ventas?corte="+corte+"&periodo=mes")
		var rep ReporteDeVentas
		_ = json.Unmarshal([]byte(b), &rep)
		totales = append(totales, rep.Totales.Total)
		if corte == "vendedor" && (len(rep.Filas) == 0 || rep.Filas[0].Etiqueta != "Tienda web") {
			t.Errorf("la compra en la tienda: %s", b)
		}
		if corte == "producto" && rep.Totales.Renglones != 18490 {
			t.Errorf("lo que suman los renglones: %+v", rep.Totales)
		}
	}
	for _, x := range totales {
		if x != 19700 {
			t.Errorf("el total con IVA cambia según el corte: %v", totales)
			break
		}
	}
	csv := CsvReporteDeVentas("producto", nil, TotalesDelReporte{Total: 19700, Renglones: 18490})
	if !strings.Contains(csv, `"Envíos y descuentos";"";"";1210,00`) {
		t.Errorf("el CSV: %s", csv)
	}
}

// M3S1-002: si Caja queda en negativo en el archivo del estudio, el cierre lo
// avisa con la cuenta y el saldo.
func TestElCierreAvisaLaCajaEnNegativo(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	sesion := e.id(t, `insert into cash_sessions (branch_id, abierta_por, estado) select $1, id, 'abierta' from "user" limit 1 returning id`, e.central)
	e.exec(t, `insert into cash_movements (session_id, tipo, monto, motivo, destino, created_at) values
		($1, 'retiro', -1000, 'Depósito', 'banco', '2026-10-10T15:00:00Z')`, sesion)
	_, cuerpo, _ := pedir(t, adm, e.u+"cierre/pendientes?periodo=2026-10")
	p, ok := pendientesDe(t, cuerpo)["fondos-negativos"]
	if !ok || len(p.Casos) != 1 || !strings.HasPrefix(p.Casos[0].Nombre, "1.1.01") || *p.Casos[0].Importe != -1000 {
		t.Errorf("el aviso: %s", cuerpo)
	}
}

// M2S1-058: lo cobrado con tarjeta va a Tarjetas a acreditar y pasa al Banco,
// neto de la comisión, cuando la tarjeta liquida.
func TestLaTarjetaPasaAlBancoAlLiquidar(t *testing.T) {
	e := armar(t)
	placa, _ := e.catalogo(t)
	pedido := e.pedido(t, "PED-1001", e.central, "entregado", "mostrador", time.Date(2026, 10, 3, 12, 0, 0, 0, Argentina), nil, [4]any{placa, 1.0, 97200.0, 0.0})
	e.exec(t, `insert into payments (order_id, tipo, proveedor, medio, monto, estado, created_at)
		values ($1, 'pedido', 'mostrador', 'tarjeta', 97200, 'aprobado', '2026-10-03T15:00:00Z')`, pedido)
	e.facturaConCae(t, nil, 1, 97200, "2026-10-03T15:00:00Z", &pedido)
	if err := e.s.CargarLiquidacion(context.Background(), Liquidacion{Fecha: time.Date(2026, 10, 6, 12, 0, 0, 0, Argentina), Bruto: 97200, Comision: 1944}, ""); err != nil {
		t.Fatal(err)
	}
	a := DelCircuito(e.asientosDe(t, "2026-10"), "")
	if n := cuenta(a, Cuentas.TarjetasAAcreditar); n != 0 {
		t.Errorf("Tarjetas a acreditar después de liquidar: %v", n)
	}
	if n := cuenta(a, Cuentas.Banco); n != 95256 {
		t.Errorf("Banco, neto de la comisión: %v", n)
	}
	if n := cuenta(a, Cuentas.Comisiones); n != 1944 {
		t.Errorf("comisión: %v", n)
	}
	if v, err := e.s.TarjetasSinLiquidar(context.Background(), time.Date(2026, 10, 31, 23, 0, 0, 0, Argentina)); err != nil || v != 0 {
		t.Errorf("sin liquidar: %v %v", v, err)
	}
}
