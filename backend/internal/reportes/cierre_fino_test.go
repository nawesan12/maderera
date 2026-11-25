package reportes

import (
	"context"
	"strings"
	"testing"
)

// El cierre con los comprobantes sin CAE, los CAE de prueba y las fechas en
// hora argentina (revisión del comité, T6).

func TestCierreConComprobantesSinCae(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	// Del 30/11 a las 23:30 en Argentina: en UTC ya es 1/12, y es del cierre
	// de noviembre.
	e.exec(t, `insert into invoices (tipo, punto_venta, numero, receptor_nombre, neto, iva21, iva105, iva27, tributos, total, estado, fecha_emision)
		values ('factura_b', 3, 1, 'CF', 100, 21, 0, 0, 0, 121, 'emitida', '2026-12-01T02:30:00Z')`)
	// Un borrador no se emitió: no cuenta.
	e.exec(t, `insert into invoices (tipo, punto_venta, numero, receptor_nombre, neto, iva21, iva105, iva27, tributos, total, estado, fecha_emision)
		values ('factura_b', 3, 2, 'CF', 100, 21, 0, 0, 0, 121, 'borrador', '2026-11-10T12:00:00Z')`)
	pendientes := func(periodo string) int {
		p := PeriodoDelCierre(periodo, ahoraDePrueba)
		ps, err := e.s.PendientesDelCierre(ctx, p.Desde, p.Hasta)
		if err != nil {
			t.Fatal(err)
		}
		for _, x := range ps {
			if x.Clave == "sin-cae" {
				return x.Cantidad
			}
		}
		return 0
	}
	if n := pendientes("2026-11"); n != 1 {
		t.Errorf("noviembre: %d sin CAE, quería 1", n)
	}
	if n := pendientes("2026-10"); n != 0 {
		t.Errorf("octubre: %d sin CAE, quería 0", n)
	}
}

func TestElCsvFechaLasVentasEnHoraArgentina(t *testing.T) {
	e := armar(t)
	// 31/10 a las 22 en Argentina = 1/11 01:00 UTC: es del 31, como la
	// fecha que ARCA le puso (CbteFch).
	e.facturaConCae(t, nil, 1, 1210, "2026-11-01T01:00:00Z", nil)
	// Un CAE de homologación no va al cierre.
	e.exec(t, `insert into invoices (tipo, punto_venta, numero, receptor_nombre, neto, iva21, iva105, iva27, tributos, total, estado,
		fecha_emision, cae, cae_ambiente) values ('factura_b', 3, 2, 'Prueba', 100, 21, 0, 0, 0, 121, 'autorizada', '2026-10-20T12:00:00Z', '7613', 'homologacion')`)
	asientos := e.asientosDe(t, "2026-10")
	csv := CsvAsientos(asientos, "")
	if !strings.Contains(csv, "31/10/2026") || strings.Contains(csv, "01/11/2026") {
		t.Errorf("la factura del 31 a las 22 no salió del 31:\n%s", csv)
	}
	if strings.Contains(csv, "Prueba") {
		t.Errorf("el CAE de homologación entró al CSV:\n%s", csv)
	}
	p := PeriodoDelCierre("2026-10", ahoraDePrueba)
	r, err := e.s.ResumenDelMes(context.Background(), p.Desde, p.Hasta)
	if err != nil {
		t.Fatal(err)
	}
	if r.Ventas.Cantidad != 1 || r.Ventas.Total != 1210 {
		t.Errorf("ventas del mes %+v: el CAE de prueba no cuenta", r.Ventas)
	}
}
