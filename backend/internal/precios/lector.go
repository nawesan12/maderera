package precios

import "mjbj/internal/planilla"

// LeerPlanilla es lo que hacía previsualizarImportacion antes de comparar:
// leerPlanilla (CSV o XLSX, con los mismos errores) y leerFilas.
func LeerPlanilla(datos []byte) ([]FilaLeida, string) {
	p := planilla.LeerPlanilla(datos)
	if p.Error != "" {
		return nil, p.Error
	}
	leidas := planilla.LeerFilas(p.Filas)
	out := make([]FilaLeida, len(leidas))
	for i, f := range leidas {
		out[i] = FilaLeida{Linea: f.Linea, SKU: f.Sku, PrecioGeneral: f.PrecioGeneral, PrecioProfesional: f.PrecioProfesional, Error: f.Error}
	}
	return out, ""
}
