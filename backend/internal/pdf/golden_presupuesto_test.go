package pdf

func init() {
	registrar("presupuesto", decodificar(Presupuesto))
}
