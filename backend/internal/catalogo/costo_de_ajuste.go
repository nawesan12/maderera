package catalogo

// CostoDeAjuste es, en SQL, el costo que se congela en un ajuste de stock
// (rotura, faltante, conteo, la placa que consume el taller) de la variante
// `variante` (un parámetro, «$1»): el costo promedio y, si todavía no hay
// (nunca se recibió con costo), el último costo neto de la lista de un
// proveedor. Un conteo del yeso RH, sin promedio, quedaba con el costo en
// NULL y sin asiento de inventario (mes simulado). Si tampoco hay lista,
// queda NULL y el cierre lo avisa (reportes.PendientesDelCierre).
func CostoDeAjuste(variante string) string {
	return `coalesce(
		(SELECT nullif(costo_promedio, 0) FROM variant_costs WHERE variant_id = ` + variante + `),
		(SELECT costo_neto FROM supplier_variant_codes WHERE variant_id = ` + variante + ` AND costo_neto > 0
		 ORDER BY costo_at DESC NULLS LAST, created_at DESC LIMIT 1))`
}
