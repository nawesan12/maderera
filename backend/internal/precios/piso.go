package precios

import (
	"context"

	"mjbj/internal/jsmath"
)

// El piso de costo (mes simulado): el Fenólico 18 mm estaba a $100 en la
// lista con un costo de $75.000 neto, y se presupuestó, se pasó a pedido y
// se vendió sin que ninguna pantalla lo dijera.
//
// El piso es el precio final (con IVA, como se vende) que apenas cubre el
// costo promedio neto: costo × (1 + alícuota). Un precio por debajo pierde
// plata. No frena nada —una liquidación puede ser a propósito—: las
// pantallas lo marcan antes de mandar el presupuesto o venderlo.

// PisoDeCosto es costo × (1 + alícuota / 100), a dos decimales; 0 si no hay
// costo cargado (no se sabe, no se marca).
func PisoDeCosto(costo, alicuota float64) float64 {
	if !(costo > 0) {
		return 0
	}
	return jsmath.Round(float64(costo*(1+alicuota/100))*100) / 100
}

// BajoCosto dice si un precio de venta final queda por debajo del piso.
// Sin costo (piso 0) o sin precio, no.
func BajoCosto(precio, piso float64) bool {
	return piso > 0 && precio > 0 && precio < piso-0.005
}

// PisosDeCosto son los pisos de unas variantes (las que no tienen costo
// cargado no aparecen).
func PisosDeCosto(ctx context.Context, q Consultador, variantes []string) (map[string]float64, error) {
	out := map[string]float64{}
	if len(variantes) == 0 {
		return out, nil
	}
	filas, err := q.Query(ctx, `
		SELECT v.id::text, c.costo_promedio::float8, coalesce(p.alicuota_iva::text, '21')::float8
		FROM product_variants v
		JOIN products p ON p.id = v.product_id
		JOIN variant_costs c ON c.variant_id = v.id
		WHERE v.id = ANY($1::uuid[]) AND c.costo_promedio > 0`, variantes)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	for filas.Next() {
		var id string
		var costo, alicuota float64
		if err := filas.Scan(&id, &costo, &alicuota); err != nil {
			return nil, err
		}
		out[id] = PisoDeCosto(costo, alicuota)
	}
	return out, filas.Err()
}
