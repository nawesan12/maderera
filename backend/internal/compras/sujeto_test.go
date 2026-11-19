package compras

import (
	"context"
	"strings"
	"testing"
)

// A quién se le retiene qué (revisión del comité, hallazgo 16): antes
// «inscripto» era tener CUIT, y nada impedía retenerle a un monotributista.
func TestSujetoARetencion(t *testing.T) {
	s := func(v string) *string { return &v }
	ri, mono, exento := "responsable_inscripto", "monotributista", "exento"
	casos := []struct {
		nombre            string
		impuesto          string
		p                 ProveedorParaRetener
		aplica, inscripto bool
		motivo            string
	}{
		{"monotributista", "ganancias", ProveedorParaRetener{CondicionIva: mono}, false, false, "monotributista"},
		// La ficha pasó de RI a monotributo: lo guardado de Ganancias no cuenta.
		{"ex RI con condición guardada", "ganancias", ProveedorParaRetener{CondicionIva: mono, CondicionGanancias: s("inscripto")}, false, false, "monotributista"},
		{"RI sin condición", "ganancias", ProveedorParaRetener{CondicionIva: ri, Cuit: s("30712345679")}, false, false, "Cargá la condición"},
		{"inscripto", "ganancias", ProveedorParaRetener{CondicionIva: ri, CondicionGanancias: s("inscripto")}, true, true, ""},
		{"no inscripto", "ganancias", ProveedorParaRetener{CondicionIva: exento, CondicionGanancias: s("no_inscripto")}, true, false, ""},
		{"exento vigente", "ganancias", ProveedorParaRetener{CondicionIva: ri, CondicionGanancias: s("exento"), ExentoHasta: s("2026-12-31")}, false, false, "31/12/2026"},
		{"exento el último día", "ganancias", ProveedorParaRetener{CondicionIva: ri, CondicionGanancias: s("exento"), ExentoHasta: s("2026-11-18")}, false, false, "exento"},
		{"exento vencido", "ganancias", ProveedorParaRetener{CondicionIva: ri, CondicionGanancias: s("exento"), ExentoHasta: s("2026-11-17")}, true, true, ""},
		{"IVA al RI", "iva", ProveedorParaRetener{CondicionIva: ri}, true, true, ""},
		{"IVA al monotributista", "iva", ProveedorParaRetener{CondicionIva: mono}, false, false, "responsable inscripto"},
		{"IIBB con CUIT", "iibb", ProveedorParaRetener{CondicionIva: mono, Cuit: s("20123456786")}, true, true, ""},
		{"SUSS sin CUIT", "suss", ProveedorParaRetener{CondicionIva: ri}, true, false, ""},
	}
	for _, c := range casos {
		aplica, inscripto, motivo := SujetoARetencion(c.impuesto, c.p, "2026-11-18")
		if aplica != c.aplica || inscripto != c.inscripto || !strings.Contains(motivo, c.motivo) {
			t.Errorf("%s: aplica %v, inscripto %v, %q", c.nombre, aplica, inscripto, motivo)
		}
	}
}

// Un pago a un monotributista con Ganancias pedido se rechaza entero: ni
// base, ni certificado, ni pago.
func TestRetenerleGananciasAUnMonotributista(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	ctx := context.Background()
	gan := e.regimen(t, "78", "ganancias", 2)
	if _, err := e.pool.Exec(ctx, `update suppliers set condicion_iva = 'monotributista', condicion_ganancias = 'inscripto' where id = $1`, e.proveedor); err != nil {
		t.Fatal(err)
	}
	c, b := pedir(t, adm, "POST", e.u+"compras/pagos", map[string]any{"supplierId": e.proveedor, "total": 300000, "medio": "transferencia",
		"retenciones": []any{map[string]any{"regimenId": gan, "base": 300000}},
		"partes":      []any{map[string]any{"medio": "transferencia", "importe": 300000}}})
	if c != 422 || !strings.Contains(b, "monotributista") {
		t.Fatalf("pago: %d %s", c, b)
	}
	var bases, certificados, pagos int
	if err := e.pool.QueryRow(ctx, `select (select count(*) from bases_de_retencion)::int, (select count(*) from retenciones_practicadas)::int,
		(select count(*) from supplier_payments)::int`).Scan(&bases, &certificados, &pagos); err != nil {
		t.Fatal(err)
	}
	if bases+certificados+pagos != 0 {
		t.Errorf("quedaron %d bases, %d certificados y %d pagos", bases, certificados, pagos)
	}
}
