package whatsapp

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

// Los golden de scripts/golden/whatsapp.ts: la lógica pura del TS, corrida
// sobre los casos de vitest y miles al azar. Go tiene que dar lo mismo.

func leerGolden(t *testing.T, nombre string, destino any) {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "testdata", "golden", "whatsapp", nombre))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(b, destino); err != nil {
		t.Fatal(err)
	}
}

// normal pasa un valor por JSON y de vuelta: así se comparan las formas,
// no los tipos de Go.
func normal(v any) any {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	var out any
	_ = json.Unmarshal(b, &out)
	return out
}

func igual(t *testing.T, que string, esperado, obtenido any) bool {
	t.Helper()
	e, o := normal(esperado), normal(obtenido)
	if !reflect.DeepEqual(e, o) {
		be, _ := json.Marshal(e)
		bo, _ := json.Marshal(o)
		t.Errorf("%s\n  TS: %s\n  Go: %s", que, recorte(string(be)), recorte(string(bo)))
		return false
	}
	return true
}

func recorte(s string) string {
	if len(s) > 1500 {
		return s[:1500] + "…"
	}
	return s
}

func nilSiVacioTexto(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func TestGoldenNumeros(t *testing.T) {
	var casos []struct {
		T, Nacional, WaID, DeMeta, Jid, DeJid, Legible, Destino, Con any
		Bsuid, SinNumero, Mismo                                      bool
	}
	leerGolden(t, "numeros.json", &casos)
	for _, c := range casos {
		tel := c.T.(string)
		igual(t, "numeros «"+tel+"»", map[string]any{
			"nacional": c.Nacional, "waId": c.WaID, "deMeta": c.DeMeta, "jid": c.Jid, "deJid": c.DeJid, "legible": c.Legible,
			"bsuid": c.Bsuid, "destino": c.Destino, "sinNumero": c.SinNumero, "mismo": c.Mismo,
		}, map[string]any{
			"nacional": nilSiVacioTexto(NumeroNacional(tel)), "waId": nilSiVacioTexto(AWaId(tel)), "deMeta": WaIdDeMeta(tel),
			"jid": JidDeWaId(tel), "deJid": WaIdDeJid(tel), "legible": NumeroLegible(tel), "bsuid": EsBsuid(tel),
			"destino": DestinoDeJid(tel), "sinNumero": SinNumero(tel), "mismo": MismoNumero(tel, c.Con.(string)),
		})
	}
}

func fecha(s *string) *time.Time {
	if s == nil {
		return nil
	}
	f, err := time.Parse(time.RFC3339Nano, *s)
	if err != nil {
		panic(err)
	}
	return &f
}

func TestGoldenVentana(t *testing.T) {
	var casos []struct {
		Ultimo, Ahora, Cierre *string
		Abierta               bool
		Restante              *string
	}
	leerGolden(t, "ventana.json", &casos)
	for _, c := range casos {
		ahora := *fecha(c.Ahora)
		u := fecha(c.Ultimo)
		var cierre *string
		if ci := CierreDeVentana(u, ahora); ci != nil {
			cierre = ptr(ci.UTC().Format("2006-01-02T15:04:05.000Z"))
		}
		igual(t, fmt.Sprintf("ventana %v", c.Ultimo),
			map[string]any{"abierta": c.Abierta, "cierre": c.Cierre, "restante": c.Restante},
			map[string]any{"abierta": VentanaAbierta(u, ahora), "cierre": cierre, "restante": nilSiVacioTexto(RestanteLegible(u, ahora))})
	}

	var bajas struct {
		Decisiones []struct {
			Activo, Baja, VentanaAbierta, HayTextoLibre, HayPlantilla bool
			Decision                                                  any
		}
		Textos []struct {
			T          string
			Baja, Alta bool
		}
	}
	leerGolden(t, "bajas.json", &bajas)
	for _, d := range bajas.Decisiones {
		igual(t, fmt.Sprintf("decidirEnvio %+v", d), d.Decision, DecidirEnvio(d.Activo, d.Baja, d.VentanaAbierta, d.HayTextoLibre, d.HayPlantilla))
	}
	for _, x := range bajas.Textos {
		igual(t, "baja «"+x.T+"»", []bool{x.Baja, x.Alta}, []bool{EsPedidoDeBaja(x.T), EsPedidoDeAlta(x.T)})
	}
}

func TestGoldenFirma(t *testing.T) {
	var casos []struct {
		Cuerpo, Secreto, Cabecera string
		Valida                    bool
		Firma                     *string
	}
	leerGolden(t, "firma.json", &casos)
	for _, c := range casos {
		if FirmaValida([]byte(c.Cuerpo), c.Cabecera, c.Secreto) != c.Valida {
			t.Errorf("firma %q con %q: TS %v", c.Cabecera, c.Secreto, c.Valida)
		}
		if c.Firma != nil && Firmar([]byte(c.Cuerpo), c.Secreto) != *c.Firma {
			t.Errorf("firmar %q", c.Cuerpo)
		}
	}
	if len(casos) < 500 {
		t.Fatal("pocos casos")
	}
}

func TestGoldenCostos(t *testing.T) {
	var g struct {
		Gastos []struct {
			Filas   []FilaDeGasto
			Tarifas map[string]float64
			Gasto   any
			Tope    float64
			Estado  any
			Pasados []int
		}
		CategoriasDeTarifa []struct {
			C *string
			T *string
		}
		Efectivas []struct {
			G map[string]any
			T any
		}
		Fechas   []struct{ F, Mes, Inicio, Siguiente string }
		Importes []struct {
			N                       float64
			Dolares, Tarifa, Moneda string
		}
	}
	leerGolden(t, "costos.json", &g)
	for i, c := range g.Gastos {
		gasto := CalcularGasto(c.Filas, c.Tarifas)
		igual(t, fmt.Sprintf("gasto %d", i), c.Gasto, gasto)
		igual(t, fmt.Sprintf("estado del tope %d", i), c.Estado, EstadoDeTope(gasto.USD, c.Tope))
		igual(t, fmt.Sprintf("umbrales %d", i), c.Pasados, UmbralesPasados(gasto.USD, c.Tope))
	}
	for _, c := range g.CategoriasDeTarifa {
		igual(t, fmt.Sprintf("categoría %v", c.C), c.T, nilSiVacioTexto(CategoriaDeTarifa(c.C)))
	}
	for _, c := range g.Efectivas {
		igual(t, fmt.Sprintf("tarifas %v", c.G), c.T, TarifasEfectivas(c.G))
	}
	for _, c := range g.Fechas {
		f, _ := time.Parse(time.RFC3339Nano, c.F)
		igual(t, "mes "+c.F, []string{c.Mes, c.Inicio, c.Siguiente}, []string{MesArgentino(f),
			InicioDelMesArgentino(f).Format("2006-01-02T15:04:05.000Z"), InicioDelMesSiguienteArgentino(f).Format("2006-01-02T15:04:05.000Z")})
	}
	for _, c := range g.Importes {
		igual(t, fmt.Sprintf("importe %v", c.N), []string{c.Dolares, c.Tarifa, c.Moneda}, []string{Dolares(c.N), TarifaLegible(c.N), Moneda(c.N)})
	}
}

func TestGoldenErrores(t *testing.T) {
	var casos []struct {
		C     *float64
		D     *string
		E     any
		Fuera bool
	}
	leerGolden(t, "errores.json", &casos)
	for _, c := range casos {
		d := ""
		if c.D != nil {
			d = *c.D
		}
		igual(t, fmt.Sprintf("error %v %q", c.C, d), c.E, ExplicarError(c.C, d))
		if EsFueraDeVentana(c.C) != c.Fuera {
			t.Errorf("fuera de ventana %v", c.C)
		}
	}
}

func TestGoldenPlantillas(t *testing.T) {
	var g struct {
		Plantillas []struct {
			Entrada struct {
				Nombre, Idioma             string
				Categoria, Estado, Formato *string
				Componentes                any
			}
			Valores, Conocidos map[string]string
			Media              map[string]string
			Leida, Componentes any
			Vista              string
			Faltan             []string
			Sugeridos          map[string]string
			Legible            string
			Marcadores         []string
		}
		Sueltos []struct {
			Texto, Extra string
			Valores      map[string]string
			Completo     string
			Marcadores   []string
			Meta         string
		}
	}
	leerGolden(t, "plantillas.json", &g)
	for i, c := range g.Plantillas {
		e := c.Entrada
		lista, _ := e.Componentes.([]any)
		p := leerPlantilla(e.Nombre, e.Idioma, e.Categoria, e.Estado, e.Formato, lista)
		que := fmt.Sprintf("plantilla %s #%d", e.Nombre, i)
		if !igual(t, que+" leída", c.Leida, p) {
			continue
		}
		var media *MediaEncabezado
		if c.Media != nil {
			media = &MediaEncabezado{ID: c.Media["id"], Link: c.Media["link"], Nombre: c.Media["nombre"]}
		}
		faltan := []string{}
		for _, f := range CamposFaltantes(p, c.Valores) {
			faltan = append(faltan, f.Clave)
		}
		igual(t, que+" vista", c.Vista, VistaPrevia(p, c.Valores))
		igual(t, que+" faltan", c.Faltan, faltan)
		igual(t, que+" componentes", c.Componentes, ArmarComponentes(p, c.Valores, media))
		igual(t, que+" sugeridos", c.Sugeridos, SugerirValores(p, c.Conocidos, nil))
		igual(t, que+" legible", c.Legible, NombreLegible(p.Nombre))
		igual(t, que+" marcadores", c.Marcadores, Marcadores(p.Cuerpo))
	}
	for _, s := range g.Sueltos {
		igual(t, "completar «"+s.Texto+"»", []any{s.Completo, s.Marcadores, s.Meta},
			[]any{Completar(s.Texto, s.Valores), Marcadores(s.Texto), ValorParaMeta(s.Texto + s.Extra)})
	}
}

func TestGoldenSalientes(t *testing.T) {
	var g struct {
		Salientes []struct {
			Destino string
			Mensaje Saliente
			Cuerpo  any
		}
		Textos []struct{ T, Tipo, Limpio, Resumen string }
	}
	leerGolden(t, "salientes.json", &g)
	for i, s := range g.Salientes {
		igual(t, fmt.Sprintf("cuerpo del mensaje %d", i), s.Cuerpo, CuerpoDelMensaje(s.Destino, s.Mensaje))
	}
	for i, x := range g.Textos {
		igual(t, fmt.Sprintf("limpiar/resumen %d", i), []string{x.Limpio, x.Resumen}, []string{Limpiar(x.T), Resumen(x.T, x.Tipo)})
	}
}

func TestGoldenPayloads(t *testing.T) {
	var casos []struct {
		Entrada any
		Eventos any
	}
	leerGolden(t, "payloads.json", &casos)
	fallas := 0
	for i, c := range casos {
		eventos := []any{}
		for _, e := range LeerPayload(c.Entrada) {
			eventos = append(eventos, e.JSON())
		}
		if !igual(t, fmt.Sprintf("payload %d", i), c.Eventos, eventos) {
			if fallas++; fallas > 5 {
				t.Fatal("demasiadas diferencias")
			}
		}
	}
}

func TestGoldenAvisoManual(t *testing.T) {
	var g struct {
		Avisos []struct {
			Datos struct {
				Evento           string
				Nombre, Telefono *string
				Valores          map[string]string
				Enlace           *Enlace
			}
			Armado       any
			PrimerNombre string
		}
		Enlaces []struct {
			T, Tx *string
			E     *string
		}
		Cuerpos []struct {
			N string
			C *string
		}
		Manuales any
	}
	leerGolden(t, "aviso-manual.json", &g)
	for i, a := range g.Avisos {
		d := a.Datos
		igual(t, fmt.Sprintf("aviso manual %d", i), a.Armado, ArmarAvisoManual(d.Evento, d.Nombre, d.Telefono, d.Valores, d.Enlace))
		n := ""
		if d.Nombre != nil {
			n = *d.Nombre
		}
		igual(t, "primer nombre", a.PrimerNombre, PrimerNombre(n))
	}
	for _, e := range g.Enlaces {
		tel, tx := "", ""
		if e.T != nil {
			tel = *e.T
		}
		if e.Tx != nil {
			tx = *e.Tx
		}
		igual(t, "enlace wa.me", e.E, nilSiVacioTexto(EnlaceWaMe(tel, tx)))
	}
	for _, c := range g.Cuerpos {
		igual(t, "cuerpo de "+c.N, c.C, CuerpoDePlantilla(c.N))
	}
	igual(t, "avisos manuales", g.Manuales, AvisosManuales)

	var eventos []EventoAviso
	leerGolden(t, "eventos.json", &eventos)
	igual(t, "eventos", eventos, EventosWhatsapp)
}
