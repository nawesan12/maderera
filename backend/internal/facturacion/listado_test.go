package facturacion

import (
	"fmt"
	"testing"
)

// El listado de a páginas: el total y la suma son del filtro entero (no de
// la página), la nota de crédito resta, la anulada y la rechazada no
// suman, y el filtro «de contado» se aplica antes de cortar la página (antes
// se aplicaba después del LIMIT y la lista salía corta sin avisar).
func TestListadoDeAPaginas(t *testing.T) {
	e := armar(t, false)
	admin := e.staff(t, "admin@prueba.test", "admin")
	factura := func(n int, tipo, estado string, total float64, dia int) string {
		var id string
		e.uno(t, `INSERT INTO invoices (tipo, punto_venta, numero, estado, receptor_nombre, neto, iva21, iva105, iva27, tributos, total, fecha_emision)
			VALUES ($1, 3, $2, $3, 'Cliente', 0, 0, 0, 0, 0, $4, $5) RETURNING id`, &id,
			tipo, n, estado, total, fmt.Sprintf("2026-10-%02dT15:00:00Z", dia))
		return id
	}
	contado := factura(1, "factura_b", "autorizada", 1000, 1)
	e.exec(t, `INSERT INTO invoice_payments (invoice_id, medio, monto, fecha) VALUES ($1, 'efectivo', 1000, now())`, contado)
	factura(2, "factura_b", "autorizada", 500, 2)
	factura(3, "nota_credito_b", "autorizada", 100, 3)
	factura(4, "factura_b", "anulada", 9999, 4)
	factura(5, "factura_b", "rechazada", 7777, 5)
	factura(6, "factura_b", "emitida", 200, 6)

	u := e.srv.URL + "/api/v1/admin/facturacion/comprobantes/pagina?desde=2026-10-01T00:00:00Z&hasta=2026-10-31T23:59:59Z"
	st, b := pedir(t, admin, "GET", u+"&limite=2", nil)
	p := leerJSON[PaginaDeComprobantes](t, b)
	if st != 200 || p.Total != 6 || p.Suma != 1600 || len(p.Filas) != 2 || p.Filas[0].Numero != 6 {
		t.Fatalf("primera página: %d %s", st, b)
	}
	_, b = pedir(t, admin, "GET", u+"&limite=2&desplazamiento=4", nil)
	if p := leerJSON[PaginaDeComprobantes](t, b); len(p.Filas) != 2 || p.Filas[1].Numero != 1 {
		t.Fatalf("última página: %s", b)
	}
	_, b = pedir(t, admin, "GET", u+"&limite=1&cobro=contado", nil)
	if p := leerJSON[PaginaDeComprobantes](t, b); p.Total != 1 || p.Suma != 1000 || len(p.Filas) != 1 || p.Filas[0].Numero != 1 {
		t.Fatalf("de contado, con la página de a uno: %s", b)
	}
	_, b = pedir(t, admin, "GET", u+"&cobro=cuenta", nil)
	if p := leerJSON[PaginaDeComprobantes](t, b); p.Total != 5 || p.Suma != 600 {
		t.Fatalf("a cuenta: %s", b)
	}
}
