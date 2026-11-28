package catalogo

// Qué medida hay que reponer, dicho una sola vez (mes simulado, H004, H062,
// H102 y H358): el inicio contaba filas de inventario por sucursal con el
// físico, Stock contaba medidas con el total y Sucursales con el físico de
// cada una. Tres números distintos para la misma pregunta.
//
// Una sucursal pide reposición cuando lo disponible (físico − reservado)
// llegó a su mínimo —con un mínimo puesto— o quedó en negativo: se vendió
// más de lo que hay (H218), y ese faltante hay que comprarlo aunque nadie
// le haya puesto mínimo. Una sucursal en cero con mínimo también cuenta:
// la chapa sin stock en el Aserradero, mínimo 50, es reposición aunque Casa
// Central tenga.
//
// Una medida es «para reponer» si alguna sucursal activa lo pide. Es la que
// cuentan el inicio y la pestaña de Stock; Sucursales cuenta por sucursal
// con la misma regla.

// ReponerEnFila es la condición sobre una fila de inventory con alias `i`.
//
// Con la regla reponer_por_sucursal en «las_que_la_manejan», el mínimo de
// una sucursal que nunca tuvo esa medida no la pide (M4-079: 38 de 40
// medidas para reponer por mínimos en el Aserradero, que no vende laca).
const ReponerEnFila = `((i.min_qty > 0 AND i.qty - i.reservado <= i.min_qty AND (` + laManeja + `)) OR i.qty - i.reservado < 0)`

const laManeja = `coalesce((SELECT r.valor FROM site_settings r WHERE r.clave = 'reponer_por_sucursal'), 'con_minimo') <> 'las_que_la_manejan'
	OR i.qty > 0 OR EXISTS (SELECT 1 FROM inventory_movements im WHERE im.variant_id = i.variant_id AND im.branch_id = i.branch_id)`

// MedidaParaReponer es la condición sobre una medida con alias `v`.
const MedidaParaReponer = `EXISTS (SELECT 1 FROM inventory i JOIN branches b ON b.id = i.branch_id AND b.active
	WHERE i.variant_id = v.id AND ` + ReponerEnFila + `)`

// MedidaConDisponible: alguna sucursal activa tiene algo para vender.
const MedidaConDisponible = `EXISTS (SELECT 1 FROM inventory i JOIN branches b ON b.id = i.branch_id AND b.active
	WHERE i.variant_id = v.id AND i.qty - i.reservado > 0)`
