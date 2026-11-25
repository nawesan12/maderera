package cortes

// Los parámetros de cálculo: la fila de calculator_parameters.
//
// **Las calculadoras de materiales salieron del sitio el 9/11/2026** (notas
// de Nahuel: el corte a medida queda como la única herramienta). Las fórmulas
// —techo, placas, piso y deck, con los números del brief— quedan en git:
// `git show 9d507a1:backend/internal/cortes/calculadoras.go`.
//
// La fila se queda porque de ahí sale el ancho de sierra con que nace cada
// corte, y se edita en /admin/cortes/tarifas. Los otros valores siguen
// guardados tal cual: borrarlos no ganaba nada y perdía lo que cargó la
// clienta por si las calculadoras vuelven.

// Las constantes del brief (lo que vale sin fila cargada).
const (
	SeparacionTirantesTecho = 0.6
	SeparacionTirantesPiso  = 0.4
	MermaMachimbre          = 0.2
	FactorPendiente         = 0.15
	RindeRolloMembrana      = 9
	RindeRolloAislacion     = 21.6
	MargenDeSeguridad       = 0.12
)

// MedidaDeTabla es una tabla de deck, en metros.
type MedidaDeTabla struct {
	LargoM float64 `json:"largoM"`
	AnchoM float64 `json:"anchoM"`
}

// ParametrosDeCalculo son todos los parámetros de las calculadoras.
type ParametrosDeCalculo struct {
	MermaMachimbre      float64 `json:"mermaMachimbre"`
	FactorPendiente     float64 `json:"factorPendiente"`
	MargenSeguridad     float64 `json:"margenSeguridad"`
	AnchoSierraMm       float64 `json:"anchoSierraMm"`
	RindeRolloMembrana  float64 `json:"rindeRolloMembrana"`
	RindeRolloAislacion float64 `json:"rindeRolloAislacion"`
	SeparacionTechoM    float64 `json:"separacionTechoM"`
	SeparacionPisoM     float64 `json:"separacionPisoM"`
	Deck                struct {
		Grandis MedidaDeTabla `json:"grandis"`
		Pvc     MedidaDeTabla `json:"pvc"`
	} `json:"deck"`
}

// ParametrosPorDefecto son los del código (PARAMETROS_POR_DEFECTO).
func ParametrosPorDefecto() ParametrosDeCalculo {
	p := ParametrosDeCalculo{
		MermaMachimbre: MermaMachimbre, FactorPendiente: FactorPendiente, MargenSeguridad: MargenDeSeguridad,
		AnchoSierraMm: AnchoDeSierraMm, RindeRolloMembrana: RindeRolloMembrana, RindeRolloAislacion: RindeRolloAislacion,
		SeparacionTechoM: SeparacionTirantesTecho, SeparacionPisoM: SeparacionTirantesPiso,
	}
	p.Deck.Grandis = MedidaDeTabla{2.4, 0.1}
	p.Deck.Pvc = MedidaDeTabla{2.9, 0.14}
	return p
}
