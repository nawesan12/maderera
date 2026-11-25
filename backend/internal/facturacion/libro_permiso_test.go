package facturacion

import "testing"

// Bug de la auditoría: el libro IVA ventas (la facturación del mes con los
// CUIT de los clientes) lo leía cualquier persona del panel; el de compras ya
// pedía el admin de /admin/arca. Ahora los dos piden lo mismo.
func TestElLibroIvaVentasEsDelAdmin(t *testing.T) {
	e := armar(t, false)
	admin := e.staff(t, "admin@prueba.test", "admin")
	vendedor := e.staff(t, "vendedor@prueba.test", "vendedor")
	for _, ruta := range []string{"/api/v1/admin/facturacion/libro-iva?periodo=2026-10", "/api/v1/admin/facturacion/libro-iva/csv?periodo=2026-10"} {
		if c, b := pedir(t, vendedor, "GET", e.srv.URL+ruta, nil); c != 403 {
			t.Errorf("el vendedor lee %s: %d %s", ruta, c, b)
		}
		if c, b := pedir(t, admin, "GET", e.srv.URL+ruta, nil); c != 200 {
			t.Errorf("el admin no lee %s: %d %s", ruta, c, b)
		}
	}
}
