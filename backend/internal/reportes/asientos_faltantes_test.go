package reportes

import (
	"context"
	"testing"
	"time"

	"mjbj/internal/reglas"
)

// Los asientos que faltaban (H160): el costo de lo vendido, la extracción
// del banco a la caja y la diferencia del arqueo.
func TestCostoYCajaEnLosAsientos(t *testing.T) {
	e := armar(t)
	e.staff(t, "caja@prueba.test", "vendedor")
	placa, _ := e.catalogo(t)
	octubre := time.Date(2026, 10, 5, 12, 0, 0, 0, Argentina)

	// Facturada con CAE en octubre: costo en el archivo del estudio.
	conFactura := e.pedido(t, "V-1", e.central, "entregado", "mostrador", octubre, nil, [4]any{placa, 2.0, 2420.0, 600.0})
	e.facturaConCae(t, nil, 1, 2420, "2026-10-05T15:00:00Z", &conFactura)
	// Entregada sin factura: costo en el B. Cancelada en el mes, vuelve.
	sinFactura := e.pedido(t, "V-2", e.central, "entregado", "mostrador", octubre, nil, [4]any{placa, 1.0, 1210.0, 500.0})
	e.pedido(t, "V-3", e.central, "entregado", "mostrador", octubre, nil, [4]any{placa, 1.0, 1210.0, 400.0})
	e.exec(t, `update orders set estado = 'cancelado', cancelado_at = '2026-10-20T15:00:00Z' where numero = 'V-3'`)

	sesion := e.id(t, `insert into cash_sessions (branch_id, abierta_por, estado, contado, cerrada_at)
		select $1, id, 'cerrada', 10950, '2026-10-10T23:00:00Z' from "user" limit 1 returning id`, e.central)
	e.exec(t, `insert into cash_movements (session_id, tipo, monto, motivo, created_at) values
		($1, 'apertura', 1000, null, '2026-10-10T12:00:00Z'),
		($1, 'ingreso', 10000, 'Extracción del banco para cambio', '2026-10-10T13:00:00Z')`, sesion)

	a := e.asientosDe(t, "2026-10")
	blanco, b := DelCircuito(a, ""), DelCircuito(a, CircuitoNegro)
	if n := cuenta(blanco, Cuentas.CostoDeVentas); n != 1200 {
		t.Errorf("costo en el archivo del estudio: %v", n)
	}
	if n := cuenta(b, Cuentas.CostoDeVentas); n != 500 {
		t.Errorf("costo en el B (vendida 400 y vuelta 400, más 500): %v", n)
	}
	if x := buscarAsiento(b, "Costo de lo vendido · vuelve V-3"); x == nil || cuenta([]Asiento{*x}, Cuentas.Mercaderias) != 400 {
		t.Errorf("la cancelación devuelve el costo: %+v", x)
	}
	if x := buscarAsiento(blanco, "Extracción del banco a la caja de Casa Central"); x == nil || cuenta([]Asiento{*x}, Cuentas.Banco) != -10000 {
		t.Errorf("extracción: %+v", x)
	}
	if x := buscarAsiento(blanco, "Faltante del arqueo de Casa Central"); x == nil || cuenta([]Asiento{*x}, Cuentas.DiferenciasDeCaja) != 50 ||
		cuenta([]Asiento{*x}, Cuentas.Caja) != -50 {
		t.Errorf("faltante: %+v", x)
	}
	_ = sinFactura
}

// El cobro del mostrador de una venta que espera el CAE, con las dos salidas
// de «asiento_sin_cae», y el de un pedido sin factura con las dos de
// «cobro_antes_de_facturar» (H160, H374).
func TestElCobroDelMostradorSinCae(t *testing.T) {
	for _, caso := range []struct{ sinCae, antes string }{{"al_cae", "circuito_b"}, {"transitoria", "anticipos"}} {
		t.Run(caso.sinCae+"-"+caso.antes, func(t *testing.T) {
			e := armar(t)
			ctx := context.Background()
			_ = reglas.Fijar(ctx, e.pool, reglas.AsientoSinCAE, caso.sinCae)
			_ = reglas.Fijar(ctx, e.pool, reglas.CobroAntesDeFacturar, caso.antes)
			placa, _ := e.catalogo(t)
			octubre := time.Date(2026, 10, 18, 12, 0, 0, 0, Argentina)

			// Venta fiscal del mostrador: la factura sale con la venta y el CAE
			// llega en noviembre.
			fiscal := e.pedido(t, "M-1", e.central, "entregado", "mostrador", octubre, nil, [4]any{placa, 1.0, 1210.0, 0.0})
			e.exec(t, `update orders set comprobante = 'fiscal' where id = $1`, fiscal)
			e.exec(t, `insert into payments (order_id, tipo, proveedor, medio, monto, estado, created_at)
				values ($1, 'pedido', 'mostrador', 'efectivo', 1210, 'aprobado', '2026-10-18T15:00:00Z')`, fiscal)
			factura := e.id(t, `insert into invoices (tipo, punto_venta, numero, receptor_nombre, neto, iva21, iva105, iva27, tributos, total, estado,
				fecha_emision, created_at, order_id) values ('factura_b', 3, 1, 'Consumidor', 1000, 210, 0, 0, 0, 1210, 'emitida',
				'2026-10-18T15:00:00Z', '2026-10-18T15:00:01Z', $1) returning id`, fiscal)

			// Pedido sin factura, cobrado por transferencia; se factura con CAE
			// en noviembre.
			pedido := e.pedido(t, "M-2", e.central, "entregado", "mostrador", octubre, nil, [4]any{placa, 1.0, 2420.0, 0.0})
			e.exec(t, `insert into payments (order_id, tipo, proveedor, medio, monto, estado, created_at)
				values ($1, 'pedido', 'mostrador', 'transferencia', 2420, 'aprobado', '2026-10-19T15:00:00Z')`, pedido)

			oct := e.asientosDe(t, "2026-10")
			if caso.sinCae == "al_cae" {
				if x := buscarAsiento(oct, "Cobro del pedido M-1"); x != nil {
					t.Errorf("con «al_cae» no hay asiento hasta el CAE: %+v", x)
				}
				if x := buscarAsiento(oct, "Cobro del pedido M-2"); x == nil || x.Circuito != CircuitoNegro ||
					cuenta([]Asiento{*x}, Cuentas.VentasSinFactura) != -2420 {
					t.Errorf("sin factura, al B: %+v", x)
				}
			} else {
				if x := buscarAsiento(oct, "Cobro del pedido M-1"); x == nil || x.Circuito != "" ||
					cuenta([]Asiento{*x}, Cuentas.Caja) != 1210 || cuenta([]Asiento{*x}, Cuentas.CobrosAImputar) != -1210 {
					t.Errorf("a la transitoria: %+v", x)
				}
				if x := buscarAsiento(oct, "Cobro del pedido M-2"); x == nil || x.Circuito != "" ||
					cuenta([]Asiento{*x}, Cuentas.AnticiposDeClientes) != -2420 {
					t.Errorf("a Anticipos: %+v", x)
				}
			}

			// Llega el CAE de M-1 en noviembre y M-2 se factura el 3.
			e.exec(t, `update invoices set cae = '761', estado = 'autorizada' where id = $1`, factura)
			e.exec(t, `insert into arca_log (invoice_id, operacion, ambiente, exito, created_at) values ($1, 'FECAESolicitar', 'produccion', true, '2026-11-02T12:00:00Z')`, factura)
			e.facturaConCae(t, nil, 2, 2420, "2026-11-03T15:00:00Z", &pedido)
			oct, nov := e.asientosDe(t, "2026-10"), e.asientosDe(t, "2026-11")
			if caso.sinCae == "al_cae" {
				// Como siempre: el cobro aparece en su mes cuando llega el CAE.
				if x := buscarAsiento(oct, "Cobro Factura B 0003-00000001"); x == nil || cuenta([]Asiento{*x}, Cuentas.Deudores) != -1210 {
					t.Errorf("con el CAE: %+v", x)
				}
				if x := buscarAsiento(nov, "Pasa al archivo del estudio · Factura B 0003-00000002"); x == nil || x.Circuito != CircuitoNegro {
					t.Errorf("del B al estudio: %+v", x)
				}
				if x := buscarAsiento(nov, "Cobro Factura B 0003-00000002"); x == nil || cuenta([]Asiento{*x}, Cuentas.Banco) != 2420 {
					t.Errorf("el cobro en el estudio con la factura: %+v", x)
				}
				return
			}
			if n := cuenta(DelCircuito(oct, ""), Cuentas.CobrosAImputar); n != 0 {
				t.Errorf("la transitoria se cancela en el mes de la factura: %v", n)
			}
			if x := buscarAsiento(nov, "Imputa cobro Factura B 0003-00000002"); x == nil || cuenta([]Asiento{*x}, Cuentas.AnticiposDeClientes) != 2420 ||
				cuenta([]Asiento{*x}, Cuentas.Deudores) != -2420 {
				t.Errorf("el anticipo a la factura: %+v", x)
			}
			if len(DelCircuito(append(oct, nov...), CircuitoNegro)) != 0 {
				t.Errorf("nada al B")
			}
		})
	}
}
