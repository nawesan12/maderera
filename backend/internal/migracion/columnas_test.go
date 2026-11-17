package migracion

import (
	"context"
	"testing"
)

// La planilla de la carga inicial trae más que nombre y precio: color,
// material, código de barras, costo y proveedor, y el stock con decimales.
// Antes se perdían (o el stock se redondeaba: 28,8 m de zócalo quedaban
// en 29).
func TestProductosConAtributosYStockConDecimales(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	if _, err := e.pool.Exec(ctx, `INSERT INTO suppliers (nombre) VALUES ('Masisa Argentina')`); err != nil {
		t.Fatal(err)
	}
	op := Opciones{LoteID: "00000000-0000-0000-0000-000000000000"}

	prod, _ := DefinicionDe("productos")
	columnas := []string{"Código", "Descripción", "Rubro", "Medida", "Color", "Material", "Código de barras", "Costo", "Proveedor", "Cod. proveedor"}
	m := Automapear(prod, columnas)
	for _, c := range []string{"color", "material", "codigoBarras", "costo", "proveedor", "codigoProveedor"} {
		if m[c] < 0 {
			t.Fatalf("no reconoció la columna de %s: %v", c, m)
		}
	}
	filas := NormalizarFilas(prod, m, [][]string{
		{"MEL-BL-18", "Melamina", "Placas", "18 mm", "Blanco", "MDP", "7790001000018", "41.250,50", "masisa argentina", "M-0018"},
		{"MEL-NE-18", "Melamina", "Placas", "18 mm negro", "Negro", "MDP", "7790001000018", "", "", ""},
	})
	r, err := AplicarLote(ctx, e.pool, "productos", filas, op)
	if err != nil {
		t.Fatal(err)
	}
	// La segunda repite el código de barras: se rechaza sola.
	if r.Creados != 1 || len(r.Rechazos) != 1 {
		t.Fatalf("resultado: %+v", r)
	}

	var color, material, barras, codProv string
	var costo float64
	if err := e.pool.QueryRow(ctx, `
		SELECT v.color, v.material, v.codigo_barras, c.costo_promedio::float8, s.codigo
		FROM product_variants v
		JOIN variant_costs c ON c.variant_id = v.id
		JOIN supplier_variant_codes s ON s.variant_id = v.id
		WHERE v.sku = 'MEL-BL-18'`).Scan(&color, &material, &barras, &costo, &codProv); err != nil {
		t.Fatal(err)
	}
	if color != "Blanco" || material != "MDP" || barras != "7790001000018" || costo != 41250.5 || codProv != "M-0018" {
		t.Fatalf("medida: %s %s %s %v %s", color, material, barras, costo, codProv)
	}

	stock, _ := DefinicionDe("stock")
	filas = NormalizarFilas(stock, Mapeo{"sku": 0, "sucursal": 1, "cantidad": 2, "minimo": 3}, [][]string{{"MEL-BL-18", "Casa Central", "28,8", "2,5"}})
	if _, err := AplicarLote(ctx, e.pool, "stock", filas, op); err != nil {
		t.Fatal(err)
	}
	var qty, minimo float64
	if err := e.pool.QueryRow(ctx, `SELECT qty::float8, min_qty::float8 FROM inventory i JOIN product_variants v ON v.id = i.variant_id
		WHERE v.sku = 'MEL-BL-18'`).Scan(&qty, &minimo); err != nil {
		t.Fatal(err)
	}
	if qty != 28.8 || minimo != 2.5 {
		t.Fatalf("stock: %v mínimo %v", qty, minimo)
	}
}
