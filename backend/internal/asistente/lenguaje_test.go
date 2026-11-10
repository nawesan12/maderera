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
	if d == nil || !reflect.DeepEqual(d.Piezas, []Pieza{{600, 400, 4, 2, 0}}) || d.Material != "melamina blanca" {
		t.Errorf("simple: %+v", d)
	}
	d = LeerDespiece("cortame 2 piezas de 400 x 900 y 300x200 x 6, canto en los 4 lados")
	if d == nil || !reflect.DeepEqual(d.Piezas, []Pieza{{900, 400, 2, 2, 2}, {300, 200, 6, 2, 2}}) {
		t.Errorf("varias: %+v", d)
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
	got := EnlaceDelDespiece(Despiece{Piezas: []Pieza{{600, 400, 4, 2, 0}}, Material: "melamina blanca"})
	if got != "/corte#piezas=600x400x4c20&material=melamina+blanca" {
		t.Errorf("enlace: %s", got)
	}
}
