package facturacion

import (
	"context"
	"strings"
	"testing"

	"mjbj/internal/fiscal"
	"mjbj/internal/reglas"
	"mjbj/internal/sqlc"
)

// La regla factura_al_monotributista (H207): de arranque el inscripto le
// hace A (RG 5003/2021, pide CUIT); con «b», le hace B y no hace falta el
// CUIT. El mostrador avisa la misma letra que va a salir.
func TestFacturaAlMonotributistaSegunLaRegla(t *testing.T) {
	e := armar(t, false)
	ctx := context.Background()
	admin := e.staff(t, "admin@mjbj.test", sqlc.StaffRoleAdmin)
	emitir := func(campos map[string]string) (int, string) {
		st, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes", manual(campos, [4]string{"Fenólico", "1", "12100", "21"}))
		return st, string(b)
	}
	tipoDe := func(b string) string {
		var tipo string
		e.uno(t, `SELECT tipo::text FROM invoices WHERE id = '`+leerJSON[map[string]string](t, []byte(b))["invoiceId"]+`'`, &tipo)
		return tipo
	}
	mono := map[string]string{"receptorNombre": "Paredes", "receptorCuit": "20-12345678-6", "receptorCondicionIva": "monotributista"}

	st, b := emitir(mono)
	if st != 200 || tipoDe(b) != "factura_a" {
		t.Fatalf("de arranque, A: %d %s", st, b)
	}
	if err := reglas.Fijar(ctx, e.pool, reglas.FacturaAlMonotributista, "b"); err != nil {
		t.Fatal(err)
	}
	st, b = emitir(mono)
	if st != 200 || tipoDe(b) != "factura_b" {
		t.Fatalf("con la regla en b: %d %s", st, b)
	}
	sinCuit := map[string]string{"receptorNombre": "Paredes", "receptorCondicionIva": "monotributista"}
	if st, b := emitir(sinCuit); st != 200 || strings.Contains(b, "CUIT") {
		t.Fatalf("la B no pide CUIT: %d %s", st, b)
	}
	// Un inscripto sigue siendo A.
	if l := fiscal.LetraConRegla(fiscal.ResponsableInscripto, fiscal.ResponsableInscripto, "b"); l != "A" {
		t.Errorf("inscripto con b: %s", l)
	}
	var cliente string
	e.uno(t, `INSERT INTO customers (nombre, condicion_iva, cuit) VALUES ('Paredes', 'monotributista', '20123456786') RETURNING id::text`, &cliente)
	if l, _, err := e.s.LetraQueSaldria(ctx, &cliente, nil); err != nil || l != "B" {
		t.Fatalf("el mostrador avisa %q %v", l, err)
	}
	_ = reglas.Fijar(ctx, e.pool, reglas.FacturaAlMonotributista, "a")
	if l, _, _ := e.s.LetraQueSaldria(ctx, &cliente, nil); l != "A" {
		t.Fatalf("de vuelta en a: %q", l)
	}
}
