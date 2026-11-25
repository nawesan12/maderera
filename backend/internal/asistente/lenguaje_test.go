package asistente

import (
	"reflect"
	"testing"
)

// Los mismos casos que tests/asistente-lenguaje.test.ts y
// tests/asistente-despiece.test.ts: son el contrato del motor en los dos
// lados. Si uno cambia, cambia el otro.

func TestNormalizar(t *testing.T) {
	casos := map[string]string{
		"Fenólico":     "fenolico",
		"MELAMÍNICA":   "melaminica",
		"  cañería   ": "caneria",
		"2440x1220":    "2440x1220",
		"18 mm.":       "18 mm.",
	}
	for entra, sale := range casos {
		if got := Normalizar(entra); got != sale {
			t.Errorf("Normalizar(%q) = %q, quería %q", entra, got, sale)
		}
	}
}

func TestConsultaLimpia(t *testing.T) {
	casos := map[string]string{
		"hola, necesito una placa de melamina": "placa melamina",
		"¿cuánto sale el fenólico?":            "fenolico",
		"tenés fenólico de 18?":                "fenolico",
		"placa 1830x2600":                      "placa",
		"machimbre 12mm":                       "machimbre",
		"hola buenas":                          "",
		"gracias!":                             "",
	}
	for entra, sale := range casos {
		if got := ConsultaLimpia(entra); got != sale {
			t.Errorf("ConsultaLimpia(%q) = %q, quería %q", entra, got, sale)
		}
	}
}

func TestEntenderIntenciones(t *testing.T) {
	casos := []struct {
		frase  string
		quiere Intencion
	}{
		{"hola", Saludo},
		{"buenas tardes", Saludo},
		{"hola, tenés melamina blanca?", Buscar},
		{"hacen envíos a Mar del Plata?", Envios},
		{"me lo mandan a domicilio?", Envios},
		{"cuánto sale el flete", Envios},
		{"a qué hora abren?", Horarios},
		{"dónde queda el local", Horarios},
		{"puedo pagar con tarjeta en cuotas?", Pagos},
		{"aceptan transferencia", Pagos},
		{"me lo cortan a medida?", Cortes},
		{"quiero mandar un despiece", Cortes},
		{"se puede tener cuenta corriente?", Cuenta},
		{"soy carpintero, tienen precios mayoristas", Cuenta},
		{"quiero hablar con una persona", Persona},
		{"cuánto material necesito para un techo", Calcular},
		{"4 de 600x400 en mdf", ArmarCorte},
		{"qué es moldava?", Moldava},
		{"tienen la ficha tecnica del fenolico", Documentacion},
		{"puedo devolver una placa?", Devoluciones},
		{"puedo dejar el material en acopio", Acopio},
		{"me hacen factura a?", Factura},
		{"hay alguna capacitacion?", Eventos},
	}
	for _, c := range casos {
		if got := Entender(c.frase).Intencion; got != c.quiere {
			t.Errorf("Entender(%q) = %s, quería %s", c.frase, got, c.quiere)
		}
	}
}

func TestEntenderDatos(t *testing.T) {
	r := Entender("cuánto sale el fenólico de 18")
	if r.Intencion != Buscar || r.Consulta != "fenolico" || r.Medida.EspesorMm != 18 {
		t.Errorf("fenólico de 18: %+v", r)
	}
	if r := Entender("tenés melamina de 18?"); r.Intencion != Buscar || r.Rubro != "placas" {
		t.Errorf("melamina de 18: %+v", r)
	}
	for frase, esp := range map[string]int{"fenólico 18mm": 18, "melamina de 15": 15, "placa de 5 mm": 5, "mdf y en 18?": 18} {
		if got := Entender(frase).Medida.EspesorMm; got != esp {
			t.Errorf("espesor de %q = %d", frase, got)
		}
	}
	if e := Entender("cuanto sale el machimbre de 3 metros"); e.Medida.EspesorMm != 0 || e.Cantidad != nil {
		t.Errorf("«de 3 metros» es el largo de la pieza: %+v", e)
	}
	if d := LeerDespiece("4 de 600x400 en melamina blanca de 18mm"); d == nil || d.EspesorMm != 18 || d.Material != "melamina blanca" {
		t.Errorf("espesor del despiece: %+v", d)
	}
	if m := Entender("necesito melamina en 15 dias").Medida; m.EspesorMm != 0 {
		t.Errorf("«en 15 días» no es un espesor: %+v", m)
	}
	if m := Entender("placa 1830 x 2600").Medida; m.LargoMm != 1830 || m.AnchoMm != 2600 || m.EspesorMm != 0 {
		t.Errorf("medida grande: %+v", m)
	}
	if c := Entender("necesito 40 m2 de piso").Cantidad; c == nil || *c != (Cantidad{40, "m2"}) {
		t.Errorf("m2: %+v", c)
	}
	if c := Entender("12 metros de zócalo").Cantidad; c == nil || *c != (Cantidad{12, "m"}) {
		t.Errorf("metros: %+v", c)
	}
	for frase, rubro := range map[string]string{"necesito durlock": "construccion-en-seco", "busco chapa para el techo": "cubiertas", "tornillos": "ferreteria"} {
		if got := Entender(frase).Rubro; got != rubro {
			t.Errorf("rubro de %q = %q", frase, got)
		}
	}
	if r := Entender("qwerty zxcv"); r.Intencion != Buscar && r.Intencion != SinIdea {
		t.Errorf("no inventa: %s", r.Intencion)
	}
	if r := Entender("   "); r.Intencion != SinIdea || r.Consulta != "" {
		t.Errorf("vacío: %+v", r)
	}
}

func TestLeerDespiece(t *testing.T) {
	d := LeerDespiece("Necesito 4 de 600x400 en melamina blanca con canto")
	if d == nil || !reflect.DeepEqual(d.Piezas, []Pieza{{600, 400, 4, 2, 0, false}}) || d.Material != "melamina blanca" {
		t.Errorf("simple: %+v", d)
	}
	d = LeerDespiece("cortame 2 piezas de 400 x 900 y 300x200 x 6, canto en los 4 lados")
	if d == nil || !reflect.DeepEqual(d.Piezas, []Pieza{{900, 400, 2, 2, 2, false}, {300, 200, 6, 2, 2, false}}) {
		t.Errorf("varias: %+v", d)
	}
	d = LeerDespiece("4 de 600x400 en roble con veta")
	if d == nil || !reflect.DeepEqual(d.Piezas, []Pieza{{600, 400, 4, 0, 0, true}}) || d.Material != "roble" {
		t.Errorf("con veta: %+v", d)
	}
	if LeerDespiece("tenés fenólico 2440x1220?") != nil || LeerDespiece("hola") != nil {
		t.Error("una placa entera no es un despiece")
	}
	if d := LeerDespiece("quiero un corte de 800x600"); d == nil || d.Piezas[0].Cantidad != 1 {
		t.Errorf("con la palabra corte: %+v", d)
	}
}

func TestConContexto(t *testing.T) {
	casos := []struct{ texto, anterior, sale string }{
		{"y en 18?", "mdf", "mdf y en 18?"},
		{"de 15mm", "melamina blanca", "melamina blanca de 15mm"},
		{"y tirantes de pino?", "mdf", "y tirantes de pino?"},
		{"hola", "", "hola"},
	}
	for _, c := range casos {
		if got := ConContexto(c.texto, c.anterior); got != c.sale {
			t.Errorf("ConContexto(%q, %q) = %q", c.texto, c.anterior, got)
		}
	}
}

func TestEnlaceDelDespiece(t *testing.T) {
	got := EnlaceDelDespiece(Despiece{Piezas: []Pieza{{600, 400, 4, 2, 0, false}}, Material: "melamina blanca"})
	if got != "/corte#piezas=600x400x4c20&material=melamina+blanca" {
		t.Errorf("enlace: %s", got)
	}
	got = EnlaceDelDespiece(Despiece{Piezas: []Pieza{{600, 400, 4, 2, 0, true}, {300, 200, 1, 0, 0, true}}})
	if got != "/corte#piezas=600x400x4c20v_300x200x1v" {
		t.Errorf("enlace con veta: %s", got)
	}
}

// Frases como llegan al WhatsApp de una maderera: sin acentos, con tipeos,
// en mayúsculas, con emojis y abreviadas (18/11/2026). Cada una es un caso
// en que el bot contestaba mal o mandaba un «no lo encontré» de más.
func TestFrasesDeClientes(t *testing.T) {
	casos := []struct {
		frase    string
		quiere   Intencion
		consulta string
		espesor  int
	}{
		{"tenes fenolico de 18?", Buscar, "fenolico", 18},
		{"precio del machimbre", Buscar, "machimbre", 0},
		{"hacen envíos a batan", Envios, "", 0},
		{"Mandan a Miramar?", Envios, "", 0},
		{"a que hora cierran el sabado", Horarios, "", 0},
		{"hasta que hora estan?", Horarios, "", 0},
		{"estan abiertos?", Horarios, "", 0},
		{"dnd estan ubicados?", Horarios, "", 0},
		{"Buenas, abren los domingos?", Horarios, "", 0},
		{"quiero hablar con alguien", Persona, "", 0},
		{"hay alguien?", Persona, "", 0},
		{"me podes llamar?", Persona, "", 0},
		{"cortan melamina?", Cortes, "", 0},
		{"TENES MDF DE 15??", Buscar, "mdf", 15},
		{"Hola buen día! tienen osb de 9mm", Buscar, "osb", 9},
		{"cuanto esta la placa de melamina blanca 18", Buscar, "placa melamina blanca", 18},
		{"me pasas precio de fenolico 18", Buscar, "fenolico", 18},
		{"fenolico 18 cuanto sale", Buscar, "fenolico", 18},
		{"q onda tienen tirantes de 3x6", Buscar, "tirantes", 0},
		{"fenolco 18", Buscar, "fenolico", 18},
		{"melanina blanca", Buscar, "melamina blanca", 0},
		{"tienen durlok?", Buscar, "durlock", 0},
		{"TIENEN MACHIMBRE??? 🙏", Buscar, "machimbre", 0},
		{"fenolico 18mm 😊", Buscar, "fenolico", 18},
		{"holaaa buenasss", Saludo, "", 0},
		{"mil gracias!!", Gracias, "", 0},
		{"graciasss", Gracias, "", 0},
		{"se puede pagar con mp?", Pagos, "", 0},
		{"hacen factura A?", Factura, "", 0},
	}
	for _, c := range casos {
		e := Entender(c.frase)
		if e.Intencion != c.quiere {
			t.Errorf("Entender(%q) = %s, quería %s", c.frase, e.Intencion, c.quiere)
		}
		if c.consulta != "" && e.Consulta != c.consulta {
			t.Errorf("consulta de %q = %q, quería %q", c.frase, e.Consulta, c.consulta)
		}
		if e.Medida.EspesorMm != c.espesor {
			t.Errorf("espesor de %q = %d, quería %d", c.frase, e.Medida.EspesorMm, c.espesor)
		}
	}
	// El número suelto no es un espesor cuando atrás viene el producto.
	if m := Entender("necesito 10 tirantes de pino").Medida; m.EspesorMm != 0 {
		t.Errorf("«10 tirantes» no es un espesor: %+v", m)
	}
}

func TestCorregir(t *testing.T) {
	casos := map[string]string{
		"holaaa":          "hola",
		"fenolco de 18?":  "fenolico de 18?",
		"q onda":          "que onda",
		"tienen durlok":   "tienen durlock",
		"llamame":         "llamame",
		"carretilla":      "carretilla",
		"melanina blanca": "melamina blanca",
	}
	for entra, sale := range casos {
		if got := Corregir(entra); got != sale {
			t.Errorf("Corregir(%q) = %q, quería %q", entra, got, sale)
		}
	}
}

// Hallazgo 24 (T7): los miles con punto, la coma y el «²». Quien pide
// machimbre escribe «1.500»; el teclado del celular, «3.75».
func TestCantidadConMilesYDecimales(t *testing.T) {
	casos := []struct {
		frase  string
		quiere *Cantidad
	}{
		{"6 m² de fenólico", &Cantidad{6, "m2"}},
		{"2,5 m2 de deck", &Cantidad{2.5, "m2"}},
		{"3.75 m de zócalo", &Cantidad{3.75, "m"}},
		{"1.000 metros de zócalo", &Cantidad{1000, "m"}},
		{"necesito 1.500 m2 de machimbre", &Cantidad{1500, "m2"}},
		{"1.234,5 metros cuadrados", &Cantidad{1234.5, "m2"}},
		// La medida no es una cantidad.
		{"fenólico 18 mm 1.830x2.600", nil},
		{"machimbre de 3 metros", nil},
	}
	for _, c := range casos {
		got := Entender(c.frase).Cantidad
		if (got == nil) != (c.quiere == nil) || (got != nil && *got != *c.quiere) {
			t.Errorf("%q: %+v, quería %+v", c.frase, got, c.quiere)
		}
	}
	if m := Entender("fenólico 1.830x2.600").Medida; m.LargoMm != 1830 || m.AnchoMm != 2600 {
		t.Errorf("la medida con punto de miles: %+v", m)
	}
	for s, quiere := range map[string]float64{"1.000": 1000, "1.500,5": 1500.5, "3.75": 3.75, "2,5": 2.5, "12": 12, "abc": 0} {
		if got := Numero(s); got != quiere {
			t.Errorf("Numero(%q) = %v, quería %v", s, got, quiere)
		}
	}
}
