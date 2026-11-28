package reportes

import (
	"context"
	"strings"
	"testing"
	"time"
)

// La campana del aserradero (mes 23, admin-atencion-Ndueña-admin-1): pedía
// lo pendiente en cada pantalla y Go contestaba 403. Ahora contesta lo suyo
// y nada de lo del admin.
func TestLaCampanaDelAserradero(t *testing.T) {
	e := armar(t)
	ase := e.staff(t, "aserradero@prueba.test", "aserradero")
	e.exec(t, `insert into quotes (numero, contacto_nombre, estado) values ('P-9', 'Y', 'aceptado')`)
	c, b, _ := pedir(t, ase, e.u+"inicio/pendientes")
	if c != 200 || strings.Contains(b, "presupuestos") {
		t.Errorf("aserradero: %d %s", c, b)
	}
}

// El remito recibido a las 21:05 del 27/11 (00:05 UTC del 28) va en Cuentas a
// pagar con su día argentino, como en /admin/recepciones
// (admin-atencion-Ndueña-admin-2).
func TestElRemitoDeLaNocheVaConSuDiaArgentino(t *testing.T) {
	e := armar(t)
	prov := e.id(t, `insert into suppliers (nombre) values ('Tableros del Sur') returning id`)
	g := e.id(t, `insert into goods_receipts (supplier_id, branch_id, numero_remito, estado, fecha) values ($1, $2, '0031-00000412', 'confirmada', '2026-11-28T00:05:00Z') returning id`,
		prov, e.central)
	e.exec(t, `insert into supplier_movements (supplier_id, tipo, monto, goods_receipt_id) values ($1, 'factura', 36300, $2)`, prov, g)
	c, err := e.s.CsvCuentasAPagar(context.Background(), time.Date(2026, 11, 27, 22, 0, 0, 0, Argentina))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(c, `"Remito 0031-00000412 sin factura";27/11/2026`) || strings.Contains(c, "28/11/2026") {
		t.Errorf("la fecha del remito:\n%s", c)
	}
}
