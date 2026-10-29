package whatsapp

import (
	_ "embed"
	"encoding/json"
	"regexp"
	"strings"
)

// PlantillaBase es una de las plantillas que MJBJ necesita aprobadas en Meta
// (lib/whatsapp/plantillas-base.ts): el texto exacto a cargar, el catálogo
// de la bandeja en demostración y lo que dice qué va en cada variable.
type PlantillaBase struct {
	Nombre      string `json:"nombre"`
	Idioma      string `json:"idioma"`
	Categoria   string `json:"categoria"`
	Uso         string `json:"uso"`
	Componentes []any  `json:"componentes"`
}

// plantillas_base.json lo escribe scripts/golden/whatsapp.ts desde
// lib/whatsapp/plantillas-base.ts, que sigue siendo la fuente: lo usan la
// configuración y el simulador. El golden comprueba que estén iguales.
//
//go:embed plantillas_base.json
var plantillasBaseJSON []byte

// PlantillasBase es el catálogo.
var PlantillasBase = func() []PlantillaBase {
	var l []PlantillaBase
	if err := json.Unmarshal(plantillasBaseJSON, &l); err != nil {
		panic("plantillas_base.json: " + err.Error())
	}
	return l
}()

// PlantillaDeBase es una por nombre, o nil.
func PlantillaDeBase(nombre string) *PlantillaBase {
	for i := range PlantillasBase {
		if PlantillasBase[i].Nombre == nombre {
			return &PlantillasBase[i]
		}
	}
	return nil
}

// Leida es la plantilla base leída como las de Meta.
func (b PlantillaBase) Leida() Plantilla {
	return leerPlantilla(b.Nombre, b.Idioma, &b.Categoria, ptr("APPROVED"), ptr("NAMED"), b.Componentes)
}

// AvisoManual es uno de los avisos que se mandan a mano (AVISOS_MANUALES).
type AvisoManual struct {
	Plantilla string `json:"plantilla"`
	Titulo    string `json:"titulo"`
}

// AvisosManuales: la clave es el mismo evento del aviso automático, cuando lo
// hay, para que el automático sepa que ya se avisó a mano.
var AvisosManuales = map[string]AvisoManual{
	"pedido_recibido":    {"pedido_recibido", "Pedido recibido"},
	"preparando":         {"pedido_preparando", "Pedido en preparación"},
	"listo":              {"pedido_listo", "Pedido listo para retirar"},
	"en-camino":          {"pedido_en_camino", "Pedido en camino"},
	"entregado":          {"pedido_entregado", "Pedido entregado"},
	"corte_listo":        {"corte_listo", "Corte terminado"},
	"presupuesto_listo":  {"presupuesto_enviado", "Presupuesto"},
	"recibo_emitido":     {"recibo_emitido", "Recibo"},
	"cheque_rechazado":   {"cheque_rechazado", "Cheque rechazado"},
	"recordatorio_saldo": {"recordatorio_saldo", "Recordatorio de saldo"},
	"documento":          {"documento_adjunto", "Documento"},
}

// CuerpoDePlantilla es el cuerpo de una plantilla base, tal cual se carga en Meta.
func CuerpoDePlantilla(nombre string) *string {
	b := PlantillaDeBase(nombre)
	if b == nil {
		return nil
	}
	for _, c := range b.Componentes {
		if co := comoObj(c); co["type"] == "BODY" {
			return punteroTexto(co["text"])
		}
	}
	return nil
}

var reOracion = regexp.MustCompile(`[^.!?]+[.!?]+[` + claseEspacioJS + `]*|[^.!?]+$`)

// sinOracionesVacias saca la oración que depende de un dato que no hay.
func sinOracionesVacias(texto string, valores map[string]string) string {
	faltan := []string{}
	for _, m := range Marcadores(texto) {
		if trimJS(valores[m]) == "" {
			faltan = append(faltan, m)
		}
	}
	if len(faltan) == 0 {
		return texto
	}
	oraciones := reOracion.FindAllString(texto, -1)
	if oraciones == nil {
		oraciones = []string{texto}
	}
	var b strings.Builder
	for _, o := range oraciones {
		queda := true
		for _, m := range faltan {
			if strings.Contains(o, "{{"+m+"}}") {
				queda = false
				break
			}
		}
		if queda {
			b.WriteString(o)
		}
	}
	return trimJS(b.String())
}

// PrimerNombre es el primer nombre para el saludo; «qué tal» si no hay.
func PrimerNombre(nombre string) string {
	if p := primeraPalabraJS(nombre); p != "" {
		return p
	}
	return "qué tal"
}

// Enlace es un enlace público que va al final del texto.
type Enlace struct {
	Texto string `json:"texto"`
	URL   string `json:"url"`
}

// AvisoManualArmado es el texto y el enlace de wa.me que lo abre.
type AvisoManualArmado struct {
	Texto    string  `json:"texto"`
	Href     *string `json:"href"`
	Motivo   *string `json:"motivo"`
	Telefono *string `json:"telefono"`
}

// EnlaceWaMe es la dirección de wa.me para un número, con el texto opcional.
func EnlaceWaMe(telefono, texto string) string {
	if telefono == "" {
		return ""
	}
	w := AWaId(telefono)
	if w == "" {
		return ""
	}
	if texto != "" {
		return "https://wa.me/" + w + "?text=" + encodeURIComponent(texto)
	}
	return "https://wa.me/" + w
}

// ArmarAvisoManual arma el texto del aviso (el de la plantilla, rellenado) y
// el enlace de wa.me.
func ArmarAvisoManual(evento string, nombre *string, telefono *string, valores map[string]string, enlace *Enlace) AvisoManualArmado {
	cuerpo := "Hola {{nombre}}, te escribimos de la maderera."
	if c := CuerpoDePlantilla(AvisosManuales[evento].Plantilla); c != nil {
		cuerpo = *c
	}
	v := map[string]string{}
	for k, x := range valores {
		v[k] = x
	}
	n := ""
	if nombre != nil {
		n = *nombre
	}
	v["nombre"] = PrimerNombre(n)
	texto := Completar(sinOracionesVacias(cuerpo, v), v)
	if enlace != nil {
		texto += "\n\n" + enlace.Texto + ": " + enlace.URL
	}
	tel := ""
	if telefono != nil {
		tel = trimJS(*telefono)
	}
	if tel == "" {
		return AvisoManualArmado{Texto: texto, Motivo: ptr("El cliente no tiene teléfono cargado.")}
	}
	w := AWaId(tel)
	if w == "" {
		return AvisoManualArmado{Texto: texto, Motivo: ptr("El teléfono «" + tel + "» no parece un número de WhatsApp."), Telefono: &tel}
	}
	return AvisoManualArmado{Texto: texto, Href: ptr(EnlaceWaMe(tel, texto)), Telefono: ptr(NumeroLegible(w))}
}
