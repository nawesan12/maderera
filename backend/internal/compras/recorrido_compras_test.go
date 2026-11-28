package compras

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// Las pruebas del grupo de compras del recorrido M4.

// M4-036: «Sube $ 150.000» y después «Baja $ 150.000» aplicado al primero:
// el saldo queda en cero y el ajuste ya no figura para pagarse.
func TestAjusteQueBajaSeAplicaAlQueSubio(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	mov := func(extra map[string]any) (int, string) {
		cuerpo := map[string]any{"supplierId": e.proveedor, "tipo": "ajuste", "monto": 150000, "detalle": "Saldo inicial"}
		for k, v := range extra {
			cuerpo[k] = v
		}
		return pedir(t, adm, "POST", e.u+"proveedores/"+e.proveedor+"/movimientos", cuerpo)
	}
	if c, b := mov(map[string]any{"sentido": "sube", "referencia": "SIM-SI-0001"}); c != 200 {
		t.Fatalf("sube: %d %s", c, b)
	}
	_, b := pedir(t, adm, "GET", e.u+"proveedores/"+e.proveedor+"/facturas-con-saldo", nil)
	var fs []FacturaConSaldo
	_ = json.Unmarshal([]byte(b), &fs)
	if len(fs) != 1 || fs[0].Tipo != "ajuste" {
		t.Fatalf("el ajuste abierto: %s", b)
	}
	if c, b := mov(map[string]any{"sentido": "baja", "monto": 200000, "aplicaA": fs[0].ID}); c != 422 || !strings.Contains(b, "le quedan") {
		t.Errorf("uno mayor que el abierto: %d %s", c, b)
	}
	if c, b := mov(map[string]any{"sentido": "baja", "aplicaA": fs[0].ID, "detalle": "Se compensa"}); c != 200 {
		t.Fatalf("baja: %d %s", c, b)
	}
	if _, b := pedir(t, adm, "GET", e.u+"proveedores/"+e.proveedor+"/facturas-con-saldo", nil); b != "[]\n" {
		t.Errorf("el ajuste compensado sigue por pagar: %s", b)
	}
	if s := e.saldo(t); s != 0 {
		t.Errorf("saldo: %v", s)
	}
	// Pagarlo igual no se puede: ya no se le debe.
	c, b := pedir(t, adm, "POST", e.u+"compras/pagos", map[string]any{"supplierId": e.proveedor, "total": 150000, "medio": "transferencia",
		"retenciones": []any{}, "ajustes": []any{map[string]any{"movimientoId": fs[0].ID, "importe": 150000}}})
	if c != 422 {
		t.Errorf("se pagó un ajuste compensado: %d %s", c, b)
	}
	_, b = pedir(t, adm, "GET", e.u+"proveedores/"+e.proveedor, nil)
	if !strings.Contains(b, `"aplicaA":"ajuste SIM-SI-0001"`) {
		t.Errorf("el renglón no dice a qué se aplicó: %s", b)
	}
}

// M4-003, M4-037: al monotributista (factura C) la recepción no le suma el
// 21 %: la deuda queda en lo que dice el remito. Y la segunda recepción de
// la orden se lee contra lo que faltaba, no contra el total (M4-042, M4-082).
func TestRecepcionDeUnMonotributistaSinIva(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	ctx := context.Background()
	if _, err := e.pool.Exec(ctx, `update suppliers set condicion_iva = 'monotributista' where id = $1`, e.proveedor); err != nil {
		t.Fatal(err)
	}
	linea := map[string]any{"variantId": e.placa, "descripcion": "Fenólico 18 mm", "cantidad": 6, "costoUnitario": 1000, "alicuotaIva": 21}
	c, b := pedir(t, adm, "POST", e.u+"compras/ordenes", map[string]any{"supplierId": e.proveedor, "branchId": e.central, "lineas": []any{linea}})
	if c != 200 {
		t.Fatalf("orden: %d %s", c, b)
	}
	orden := idDe(t, b)
	if c, b := pedir(t, adm, "POST", e.u+"compras/ordenes/"+orden+"/enviada", nil); c != 200 {
		t.Fatalf("enviar: %d %s", c, b)
	}
	recibir := func(remito string, vinieron int) string {
		t.Helper()
		c, b := pedir(t, adm, "POST", e.u+"compras/ordenes/"+orden+"/recibir", map[string]string{"numeroRemito": remito})
		if c != 200 {
			t.Fatalf("recibir: %d %s", c, b)
		}
		r := idDe(t, b)
		_, _ = e.pool.Exec(ctx, `update goods_receipt_items set cantidad = $2 where receipt_id = $1`, r, vinieron)
		if c, b := pedir(t, adm, "POST", e.u+"recepciones/"+r+"/confirmar", nil); c != 200 {
			t.Fatalf("confirmar: %d %s", c, b)
		}
		return r
	}
	primera := recibir("R-1", 4)
	if s := e.saldo(t); s != 4000 {
		t.Errorf("la deuda con un monotributista lleva IVA: %v", s)
	}
	if _, b := pedir(t, adm, "GET", e.u+"recepciones/"+primera, nil); !strings.Contains(b, `"alicuotaIva":"0.00"`) || !strings.Contains(b, `"yaRecibido":"0.0000"`) {
		t.Errorf("la primera: %s", b)
	}
	segunda := recibir("R-2", 2)
	if s := e.saldo(t); s != 6000 {
		t.Errorf("deuda tras la segunda: %v", s)
	}
	// La segunda llega cuando ya habían venido 4: «2 de 2», no «2 de 6».
	if _, b := pedir(t, adm, "GET", e.u+"recepciones/"+segunda, nil); !strings.Contains(b, `"yaRecibido":"4.0000"`) {
		t.Errorf("la segunda: %s", b)
	}
	// Y la primera sigue contra lo que faltaba cuando llegó.
	if _, b := pedir(t, adm, "GET", e.u+"recepciones/"+primera, nil); !strings.Contains(b, `"yaRecibido":"0.0000"`) {
		t.Errorf("la primera, después de la segunda: %s", b)
	}
}

// M4-007: la factura que coincide con el remito y trae una percepción de
// IIBB carga la percepción con su nombre, no como «diferencia con la
// recepción».
func TestPercepcionDeLaFacturaConSuNombre(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	c, b := pedir(t, adm, "POST", e.u+"recepciones", map[string]any{"supplierId": e.proveedor, "branchId": e.central, "numeroRemito": "R-1",
		"lineas": []any{map[string]any{"variantId": e.tornillo, "cantidad": 100, "costoUnitario": 10, "alicuotaIva": 21}}})
	if c != 200 {
		t.Fatalf("crear: %d %s", c, b)
	}
	r := idDe(t, b)
	if c, b := pedir(t, adm, "POST", e.u+"recepciones/"+r+"/confirmar", nil); c != 200 {
		t.Fatalf("confirmar: %d %s", c, b)
	}
	e.facturaDeCompra(t, adm, 5501, map[string]any{"neto": 1000, "iva21": 210, "receiptId": r, "percepcionIva": 0, "percepcionIibb": 30})
	var detalle string
	var monto float64
	if err := e.pool.QueryRow(context.Background(), `select detalle, monto::float8 from supplier_movements where purchase_invoice_id is not null`).Scan(&detalle, &monto); err != nil {
		t.Fatal(err)
	}
	if detalle != "Percepción IIBB" || monto != 30 {
		t.Errorf("el renglón de la percepción: %q %v", detalle, monto)
	}
}

// M4-040: lo devolvible trae el costo que factura el proveedor (sin el
// flete) y la factura que cubre su recepción.
func TestDevolvibleConCostoFacturadoYFactura(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	c, b := pedir(t, adm, "POST", e.u+"recepciones", map[string]any{"supplierId": e.proveedor, "branchId": e.central, "numeroRemito": "R-7",
		"gastos": 100, "lineas": []any{map[string]any{"variantId": e.tornillo, "cantidad": 100, "costoUnitario": 10, "alicuotaIva": 21}}})
	if c != 200 {
		t.Fatalf("crear: %d %s", c, b)
	}
	r := idDe(t, b)
	if c, b := pedir(t, adm, "POST", e.u+"recepciones/"+r+"/confirmar", nil); c != 200 {
		t.Fatalf("confirmar: %d %s", c, b)
	}
	f := e.facturaDeCompra(t, adm, 5588, map[string]any{"neto": 1100, "iva21": 231, "receiptId": r})
	_, b = pedir(t, adm, "GET", e.u+"compras/devolucion?proveedor="+e.proveedor, nil)
	var filas []RenglonDevolvible
	_ = json.Unmarshal([]byte(b), &filas)
	if len(filas) != 1 || filas[0].CostoFacturado != 10 || filas[0].CostoUnitario != 11 || filas[0].FacturaID == nil || *filas[0].FacturaID != f {
		t.Errorf("devolvibles: %s", b)
	}
}

// M4-044: con el circuito elegido, las categorías suman solo los de ese, y
// el corte por sucursal reparte lo mismo.
func TestGastosPorCategoriaSiguenElCircuito(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	if _, err := e.pool.Exec(ctx, `insert into expenses (fecha, categoria, descripcion, importe, medio, circuito, branch_id) values
		(now(), 'mantenimiento', 'Con factura', 96800, 'transferencia', 'blanco', $1),
		(now(), 'mantenimiento', 'Sin factura', 140000, 'efectivo', 'negro', $1),
		(now(), 'combustible', 'Nafta', 18500, 'efectivo', 'negro', $2)`, e.central, e.aserradero); err != nil {
		t.Fatal(err)
	}
	s := Nuevo(e.pool, silencio)
	desde, hasta := time.Now().Add(-time.Hour), time.Now().Add(time.Hour)
	negro, err := s.GastosPorCategoria(ctx, desde, hasta, "negro", false)
	if err != nil {
		t.Fatal(err)
	}
	if len(negro) != 2 || negro[0].Clave != "mantenimiento" || negro[0].Total != "140000.00" {
		t.Errorf("categorías del B: %+v", negro)
	}
	suc, err := s.GastosPorCategoria(ctx, desde, hasta, "", true)
	if err != nil {
		t.Fatal(err)
	}
	if len(suc) != 2 || suc[0].Clave != "Casa Central" || suc[0].Total != "236800.00" {
		t.Errorf("por sucursal: %+v", suc)
	}
}
