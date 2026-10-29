package pdf

func init() {
	registrar("corte", decodificar(Corte))
	registrar("hoja-de-corte", decodificar(HojaDeCortePdf))
	registrar("reporte-ventas", decodificar(ReporteDeVentas))
}
