package cortes

// Las calculadoras de materiales (lib/calculations.ts). Los números salen
// del brief del 5/9/2026; los parámetros se editan en /admin/calculadoras y
// entran por argumento.

import (
	"math"

	"mjbj/internal/jsmath"
)

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

// Item es un renglón: cómo se lee y con qué buscarlo en el catálogo.
type Item struct {
	Descripcion string `json:"descripcion"`
	Busqueda    string `json:"busqueda"`
}

// ResultadoTecho es RoofResult.
type ResultadoTecho struct {
	Tirantes struct {
		Cantidad float64 `json:"cantidad"`
		Medida   string  `json:"medida"`
		Item
	} `json:"tirantes"`
	Machimbre struct {
		M2 float64 `json:"m2"`
		Item
	} `json:"machimbre"`
	Aislacion struct {
		Rollos float64 `json:"rollos"`
		Item
	} `json:"aislacion"`
	Membrana struct {
		Rollos float64 `json:"rollos"`
		Item
	} `json:"membrana"`
	Clavos struct {
		Kg       float64 `json:"kg"`
		Estimado bool    `json:"estimado"`
		Item
	} `json:"clavos"`
}

// CalcularTecho es calculateRoof.
func CalcularTecho(largo, ancho float64, tipo string, p ParametrosDeCalculo) ResultadoTecho {
	sup := float64(largo*ancho) * (1 + p.FactorPendiente)
	var r ResultadoTecho
	medida, nombre := `2" x 6"`, "Pino Tratado"
	if tipo != "pino" {
		medida, nombre = `3" x 6"`, "Saligna"
	}
	r.Tirantes.Cantidad = math.Ceil(ancho/p.SeparacionTechoM) + 1
	r.Tirantes.Medida = medida + " x " + jsmath.Texto(math.Ceil(largo+0.3)) + "m"
	r.Tirantes.Item = Item{"Tirante " + nombre + " " + medida, "tirante " + tipo}
	r.Machimbre.M2 = math.Ceil(sup * (1 + p.MermaMachimbre))
	r.Machimbre.Item = Item{`Machimbre Pino 1/2" x 4"`, "machimbre pino"}
	r.Aislacion.Rollos = math.Ceil(sup / p.RindeRolloAislacion)
	r.Aislacion.Item = Item{"Lana de Vidrio 50mm (rollo 1.2m x 18m)", "lana vidrio"}
	r.Membrana.Rollos = math.Ceil(sup / p.RindeRolloMembrana)
	r.Membrana.Item = Item{"Membrana Asfáltica 4mm x 1m x 10m", "membrana asfaltica"}
	r.Clavos.Kg = math.Ceil(sup * 0.15)
	r.Clavos.Estimado = true
	r.Clavos.Item = Item{"Clavos para machimbre y estructura", "clavos"}
	return r
}

// PiezaDePlaca es BoardPiece.
type PiezaDePlaca struct {
	Ancho    float64 `json:"ancho"`
	Largo    float64 `json:"largo"`
	Cantidad float64 `json:"cantidad"`
}

// ResultadoPlacas es BoardResult.
type ResultadoPlacas struct {
	PlacasNecesarias    float64        `json:"placasNecesarias"`
	PlacaDimension      string         `json:"placaDimension"`
	Piezas              []PiezaDePlaca `json:"piezas"`
	Aprovechamiento     float64        `json:"aprovechamiento"`
	Desperdicio         float64        `json:"desperdicio"`
	PerdidaPorSierraMm2 float64        `json:"perdidaPorSierraMm2"`
}

// CalcularPlacas es calculateBoards: la sierra se cobra lo suyo antes que el
// margen de seguridad.
func CalcularPlacas(piezas []PiezaDePlaca, placaAncho, placaLargo, sierra, margen float64) ResultadoPlacas {
	area := placaAncho * placaLargo
	util, conSierra := 0.0, 0.0
	for _, p := range piezas {
		util = util + float64(float64(p.Ancho*p.Largo)*p.Cantidad)
		conSierra = conSierra + float64(float64((p.Ancho+sierra)*(p.Largo+sierra))*p.Cantidad)
	}
	reales := math.Ceil((conSierra / area) * (1 + margen))
	minimo := 0.0
	if len(piezas) > 0 {
		minimo = 1
	}
	necesarias := math.Max(minimo, reales)
	aprov := 0.0
	if necesarias > 0 {
		aprov = jsmath.Round((util / float64(necesarias*area)) * 100)
	}
	if piezas == nil {
		piezas = []PiezaDePlaca{}
	}
	return ResultadoPlacas{
		PlacasNecesarias: necesarias, PlacaDimension: jsmath.Texto(placaAncho) + " x " + jsmath.Texto(placaLargo) + "mm",
		Piezas: piezas, Aprovechamiento: aprov, Desperdicio: 100 - aprov, PerdidaPorSierraMm2: jsmath.Round(conSierra - util),
	}
}

// ResultadoPiso es FloorResult.
type ResultadoPiso struct {
	PisoM2              float64 `json:"pisoM2"`
	CajasNecesarias     float64 `json:"cajasNecesarias"`
	M2PorCaja           float64 `json:"m2PorCaja"`
	Zocalos             float64 `json:"zocalos"`
	ZocaloML            float64 `json:"zocaloML"`
	UnderlayM2          float64 `json:"underlayM2"`
	TirantesDeEntrepiso float64 `json:"tirantesDeEntrepiso"`
}

// CalcularPiso es calculateFloor (perímetro 0: el del rectángulo).
func CalcularPiso(largo, ancho, perimetro, separacionPiso float64) ResultadoPiso {
	sup := largo * ancho
	piso := math.Ceil(sup * 1.1)
	porCaja := 2.39
	perim := perimetro
	if perim == 0 || math.IsNaN(perim) {
		perim = (largo + ancho) * 2
	}
	ml := math.Ceil(perim * 0.85)
	return ResultadoPiso{
		PisoM2: piso, CajasNecesarias: math.Ceil(piso / porCaja), M2PorCaja: porCaja,
		Zocalos: math.Ceil(ml / 3), ZocaloML: ml, UnderlayM2: piso,
		TirantesDeEntrepiso: math.Ceil(ancho/separacionPiso) + 1,
	}
}

// ResultadoDeck es DeckResult.
type ResultadoDeck struct {
	TablasDeck struct {
		Tablas float64 `json:"tablas"`
		M2     float64 `json:"m2"`
		Medida string  `json:"medida"`
		Item
	} `json:"tablasDeck"`
	Estructura struct {
		Tirantes float64 `json:"tirantes"`
		Medida   string  `json:"medida"`
		Item
	} `json:"estructura"`
	Tornillos struct {
		Cantidad float64 `json:"cantidad"`
		Item
	} `json:"tornillos"`
	Protector struct {
		Litros float64 `json:"litros"`
		Item
	} `json:"protector"`
}

// techoJusto es Math.ceil(Number(valor.toFixed(6))): 13.44/0.24 no es 57.
func techoJusto(v float64) float64 { return math.Ceil(jsmath.Numero(jsmath.ToFixed(v, 6))) }

// CalcularDeck es calculateDeck: se vende por tabla entera.
func CalcularDeck(largo, ancho float64, material string, tabla MedidaDeTabla, margen, separacionPiso float64) ResultadoDeck {
	sup := largo * ancho
	m2 := sup * (1 + margen)
	areaTabla := tabla.LargoM * tabla.AnchoM
	var r ResultadoDeck
	if areaTabla > 0 {
		r.TablasDeck.Tablas = techoJusto(m2 / areaTabla)
	}
	r.TablasDeck.M2 = math.Ceil(m2)
	r.TablasDeck.Medida = jsmath.Texto(tabla.LargoM) + " m x " + jsmath.Texto(jsmath.Round(tabla.AnchoM*100)) + " cm"
	if material == "grandis" {
		r.TablasDeck.Item = Item{`Tabla Deck Grandis 1" x 5"`, "deck grandis"}
	} else {
		r.TablasDeck.Item = Item{"Tabla Deck PVC 25x150mm", "deck pvc"}
	}
	r.Estructura.Tirantes = math.Ceil(largo/separacionPiso) + 1
	r.Estructura.Medida = `2" x 4" x ` + jsmath.Texto(math.Ceil(ancho+0.2)) + "m"
	r.Estructura.Item = Item{`Alfajía 2" x 4"`, "alfajia"}
	r.Tornillos.Cantidad = math.Ceil(sup * 22)
	r.Tornillos.Item = Item{"Tornillos galvanizados para deck", "tornillo deck"}
	if material == "grandis" {
		r.Protector.Litros = math.Ceil(m2 * 0.25)
		r.Protector.Item = Item{"Protector para maderas exterior", "protector madera"}
	} else {
		r.Protector.Item = Item{"No requiere (PVC)", "protector madera"}
	}
	return r
}
