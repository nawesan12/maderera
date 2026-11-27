package cortes

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

// Las pruebas del mes simulado 2–3 (rama mes23-cortes-taller).

// M3S1-015 y M2S1-014: el agente pide los de su taller, y el que está en la
// máquina viene aparte para que su archivo no salga de la carpeta.
func TestPendientesDelTaller(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	var aserradero string
	if err := e.pool.QueryRow(context.Background(), `insert into branches (slug, name, sort_order) values ('aserradero', 'Aserradero', 2) returning id::text`).Scan(&aserradero); err != nil {
		t.Fatal(err)
	}
	central := alta(t, e, ven, melamina(e, "branchId", e.central))
	enAserradero := alta(t, e, ven, melamina(e, "branchId", aserradero))
	u := e.srv.URL + "/api/cortes/pendientes"
	ver := func(q string) (int, string) {
		return pedir(t, http.DefaultClient, "GET", u+q, nil, "Authorization", "Bearer "+tokenAgente)
	}
	if code, b := ver("?sucursal=aserradero"); code != 200 || !strings.Contains(b, enAserradero) || strings.Contains(b, central) {
		t.Errorf("aserradero: %d %s", code, b)
	}
	if code, b := ver("?sucursal=" + e.central); code != 200 || strings.Contains(b, enAserradero) || !strings.Contains(b, central) {
		t.Errorf("casa central: %d %s", code, b)
	}
	if code, _ := ver("?sucursal=Otra"); code != 400 {
		t.Errorf("sucursal que no existe: %d", code)
	}
	if code, b := pedir(t, ven, "POST", e.srv.URL+"/api/v1/admin/cortes/"+enAserradero+"/avanzar?desde=en-cola", nil); code != 200 {
		t.Fatalf("empezar: %d %s", code, b)
	}
	code, b := ver("?sucursal=Aserradero")
	if code != 200 || !strings.Contains(b, `"enLaMaquina":[{"id":"`+enAserradero) || strings.Contains(b, `"cortes":[{`) {
		t.Errorf("en la máquina: %d %s", code, b)
	}
}

// M2S1-064 y M2S2-106: el espesor del PTX es el del tablero, no la primera
// medida con «mm».
func TestEspesorConLaMedidaDeLaPlaca(t *testing.T) {
	casos := map[string]float64{
		"Fenólico — 1220 x 2440mm — 15mm":        15,
		"Fenólico — 2440 × 1220 mm — 12mm":       12,
		"MDF — 1830 x 2600mm — 3mm":              3,
		"Melamina Blanca — 1830 x 2600mm — 18mm": 18,
	}
	for m, quiere := range casos {
		if got, ok := EspesorDelMaterial(m); !ok || got != quiere {
			t.Errorf("%q: %v %v", m, got, ok)
		}
	}
}

// M2S1-063: la misma placa sale con un solo nombre, la cargue el panel o el
// sitio.
func TestMaterialEnOrden(t *testing.T) {
	l, a := int32(2600), int32(1830)
	if got := MaterialEnOrden("Melamina Blanca — 1830 x 2600mm — 18mm", &l, &a); got != "Melamina Blanca — 2600 × 1830 mm — 18mm" {
		t.Errorf("del panel: %q", got)
	}
	if got := MaterialEnOrden("Melamina Blanca — 2600 × 1830 mm — 18mm", &l, &a); got != "Melamina Blanca — 2600 × 1830 mm — 18mm" {
		t.Errorf("del sitio: %q", got)
	}
	if got := MaterialEnOrden("MDF que trae el cliente", nil, nil); got != "MDF que trae el cliente" {
		t.Errorf("a mano: %q", got)
	}
}

// M2S1-065, M3S1-041 y M2S3-067: el archivo de una media placa dice de qué
// tablero parte, los cantos van en número y la pieza sin etiqueta lleva su
// medida.
func TestArchivoDeLaMediaPlaca(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	id := alta(t, e, ven, map[string]any{"contactoNombre": "Gómez", "materialDescripcion": "Fenólico — 1220 x 2440mm — 15mm",
		"variantId": e.fenolico, "mitad": "largo",
		"piezas": []any{pieza(600, 300, 2, "cantoLargo", 1), pieza(500, 200, 1, "etiqueta", "Tapa")}})
	code, b := pedir(t, ven, "GET", e.srv.URL+"/api/cortes/"+id+"/lista", nil)
	if code != 200 {
		t.Fatalf("lista: %d %s", code, b)
	}
	if !strings.Contains(b, "Fenólico — 2440 × 1220 mm — 15mm — media placa 2440 × ") {
		t.Errorf("sin la media: %q", b)
	}
	if !strings.Contains(b, ";600 x 300;No;1;0\r\n") || !strings.Contains(b, ";Tapa;No;0;0\r\n") {
		t.Errorf("cantos o etiqueta: %q", b)
	}
}
