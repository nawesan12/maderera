package cortes

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"mjbj/internal/reglas"
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
	if code != 200 || !strings.Contains(b, `"enLaMaquina":[{"id":"`+enAserradero) || strings.Contains(b, `"cortes":[{`) || !strings.Contains(b, `"actualizado":"`) {
		t.Errorf("en la máquina: %d %s", code, b)
	}
}

// M2S4-008: las pasadas son el precio. El depósito no las cambia, y bajarlas
// del plano lo hace un administrador.
func TestPasadasLasCambiaQuienCobra(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	dep := e.staff(t, "deposito@prueba.test", "deposito")
	adm := e.staff(t, "admin@prueba.test", "admin")
	id := alta(t, e, ven, melamina(e, "piezas", []any{pieza(600, 300, 3)}))
	u := e.srv.URL + "/api/v1/admin/cortes/" + id + "/pasadas"
	sugeridas := leerFicha(t, e, ven, id)["pasadasACobrar"].(float64)
	if sugeridas < 2 {
		t.Fatalf("el plano propone %v pasadas", sugeridas)
	}
	if code, _ := pedir(t, dep, "POST", u, map[string]any{"pasadas": sugeridas + 1}); code != 403 {
		t.Errorf("el depósito cambió las pasadas: %d", code)
	}
	if code, _ := pedir(t, ven, "POST", u, map[string]any{"pasadas": sugeridas - 1}); code != 403 {
		t.Errorf("el vendedor bajó las pasadas sin autorización: %d", code)
	}
	if code, b := pedir(t, ven, "POST", u, map[string]any{"pasadas": sugeridas + 1}); code != 204 {
		t.Errorf("el vendedor no pudo subirlas: %d %s", code, b)
	}
	if code, b := pedir(t, adm, "POST", u, map[string]any{"pasadas": 1}); code != 204 {
		t.Errorf("el admin no pudo bajarlas: %d %s", code, b)
	}
}

// M2S2-045: con el acomodo a mano guardado, las pasadas a cobrar son las del
// plano que se dibuja, si no esquiva la media placa.
func TestElAcomodoCobraSusPasadas(t *testing.T) {
	sierra := 4.0
	d := DatosDelPlano{Piezas: []PiezaAcortar{{LargoMm: 900, AnchoMm: 400, Cantidad: 2}, {LargoMm: 500, AnchoMm: 300, Cantidad: 1}},
		PlacaLargo: 2750, PlacaAncho: 1830, AnchoSierra: &sierra}
	libre := PlanoConLaHoja(d)
	d.Fijadas = []PiezaFijada{{Indice: 1, Unidad: 1, Placa: 1, Girada: ptr(true)}}
	manual := PlanoConLaHoja(d)
	c := ACobrar(d)
	if len(manual.Placas) == len(libre.Placas) && manual.PlacasEnteras == libre.PlacasEnteras && c.Pasadas != manual.PasadasCobrables {
		t.Errorf("cobra %d pasadas y el plano dice %d (libre %d)", c.Pasadas, manual.PasadasCobrables, libre.PasadasCobrables)
	}
	if !SeCobraElManual(Plano{PlacasEnteras: 1, Placas: make([]PlacaDelPlano, 2)}, Plano{PlacasEnteras: 1, Placas: make([]PlacaDelPlano, 2)}) {
		t.Error("las mismas placas: se cobra el manual")
	}
	if SeCobraElManual(Plano{PlacasEnteras: 0, Placas: make([]PlacaDelPlano, 2)}, Plano{PlacasEnteras: 1, Placas: make([]PlacaDelPlano, 1)}) {
		t.Error("esquivar la media placa cobra el manual")
	}
}

// M3S3-023, M2S2-104 y M3S4-023: la reposición sin cargo de una venta que
// cobró su corte se corrige, y el reemplazo conserva la hora del original.
func TestCorregirLaReposicion(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	pedido := e.pedido(t, "PED-1231",
		map[string]any{"variante": e.melamina, "descripcion": "Melamina Blanca", "unidad": "placa", "cantidad": 1, "precio": 84500},
		map[string]any{"descripcion": "Corte a medida · 3 piezas", "unidad": "pasada", "cantidad": 4, "precio": 1200, "delCorte": true})
	repo := alta(t, e, ven, melamina(e, "orderId", pedido, "sinCargo", true, "piezas", []any{pieza(700, 396, 1)}))
	if _, err := e.pool.Exec(ctx, `update cutting_orders set created_at = now() - interval '30 minutes' where id = $1`, repo); err != nil {
		t.Fatal(err)
	}
	nuevo := alta(t, e, ven, melamina(e, "orderId", pedido, "sinCargo", true, "reemplaza", repo,
		"piezas", []any{pieza(700, 396, 1, "etiqueta", "Puerta")}))
	var espera float64
	if err := e.pool.QueryRow(ctx, `select extract(epoch from now() - created_at) from cutting_orders where id = $1`, nuevo).Scan(&espera); err != nil {
		t.Fatal(err)
	}
	if espera < 29*60 {
		t.Errorf("el reemplazo llegó recién: espera %v s", espera)
	}
	if f := leerFicha(t, e, ven, repo); f["corte"].(map[string]any)["estado"] != "cancelado" {
		t.Errorf("la reposición corregida sigue viva: %v", f["corte"].(map[string]any)["estado"])
	}
}

// M2S2-044 y M2S2-145: un tapacanto sin ningún lado marcado no se guarda en
// el panel, y la consulta del sitio no lo nombra.
func TestTapacantoSinLados(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	code, b := pedir(t, ven, "POST", e.srv.URL+"/api/v1/admin/cortes",
		melamina(e, "cantoDescripcion", "Canto blanco 0,45 en frentes", "piezas", []any{pieza(600, 300, 3)}))
	if code != 422 || !strings.Contains(b, "en qué lados") {
		t.Errorf("tapacanto sin lados: %d %s", code, b)
	}
	alta(t, e, ven, melamina(e, "cantoDescripcion", "Canto blanco", "piezas", []any{pieza(600, 300, 3, "cantoLargo", 1)}))

	u := e.srv.URL + "/api/v1/cortes/consulta"
	code, b = pedir(t, http.DefaultClient, "POST", u, map[string]any{"variantId": e.melamina, "sucursal": "casa-central",
		"cantoDescripcion": "Blanco 22 mm", "piezas": []any{map[string]any{"largoMm": 720, "anchoMm": 560, "cantidad": 2, "respetaVeta": 0, "cantoLargo": 0, "cantoAncho": 0}}})
	if code != 200 {
		t.Fatalf("consulta: %d %s", code, b)
	}
	var r struct{ Token string }
	_ = json.Unmarshal([]byte(b), &r)
	_, b = pedir(t, http.DefaultClient, "GET", u+"/"+r.Token, nil)
	if strings.Contains(b, "Blanco 22 mm") {
		t.Errorf("la consulta nombra un tapacanto sin canto: %s", b)
	}
}

// M3S2-030: el corte suelto guarda el total con que se tomó; si la tarifa
// cambia, la ficha tiene los dos.
func TestElTotalConQueSeTomo(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	id := alta(t, e, ven, melamina(e, "piezas", []any{pieza(600, 300, 3)}))
	f := leerFicha(t, e, ven, id)
	antes := f["cuenta"].(map[string]any)["total"].(float64)
	if f["modo"] != "suelto" || f["totalTomado"] == nil || f["totalTomado"].(float64) != antes {
		t.Fatalf("sin el total tomado: %v %v", f["modo"], f["totalTomado"])
	}
	if _, err := e.pool.Exec(context.Background(), `update cutting_rates set precio_por_pasada = precio_por_pasada + 100`); err != nil {
		t.Fatal(err)
	}
	f = leerFicha(t, e, ven, id)
	if f["cuenta"].(map[string]any)["total"].(float64) == antes || f["totalTomado"].(float64) != antes {
		t.Errorf("el total de hoy %v y el tomado %v (antes %v)", f["cuenta"].(map[string]any)["total"], f["totalTomado"], antes)
	}
}

// Mes 23: cambiar las pasadas del trabajo vuelve a tomar el total; el
// tachado queda para cuando cambia la tarifa.
func TestLasPasadasVuelvenATomarElTotal(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	id := alta(t, e, ven, melamina(e, "piezas", []any{pieza(600, 300, 3)}))
	f := leerFicha(t, e, ven, id)
	if code, b := pedir(t, ven, "POST", e.srv.URL+"/api/v1/admin/cortes/"+id+"/pasadas", map[string]any{"pasadas": f["pasadasACobrar"].(float64) + 2}); code != 204 {
		t.Fatalf("pasadas: %d %s", code, b)
	}
	f = leerFicha(t, e, ven, id)
	if total := f["cuenta"].(map[string]any)["total"].(float64); f["totalTomado"] == nil || f["totalTomado"].(float64) != total {
		t.Errorf("con las pasadas cambiadas, el total %v y el tomado %v", total, f["totalTomado"])
	}
}

// M3S2-009: la placa que trae el cliente (escrita a mano) cobra sus pasadas
// con la tarifa de «Placas», y con «Placa del cliente» si se cargó.
func TestLaPlacaDelClienteCobraSusPasadas(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	id := alta(t, e, ven, map[string]any{"contactoNombre": "Rodolfo", "materialDescripcion": "MDF 18 que trae el cliente",
		"placaLargoMm": "2600", "placaAnchoMm": "1830", "piezas": []any{pieza(600, 300, 3)}})
	f := leerFicha(t, e, ven, id)
	c := f["cuenta"].(map[string]any)
	if f["modo"] != "suelto" || c["subtotalCorte"].(float64) <= 0 || c["precioPorPasada"].(float64) != 1200 {
		t.Fatalf("la placa del cliente: %v %v", f["modo"], c)
	}
	// Con una pieza de más de media placa tampoco se vende la placa: es
	// suya, y se cobran todas las pasadas (M2S1-024, M2S3-008).
	grande := alta(t, e, ven, map[string]any{"contactoNombre": "Rodolfo", "materialDescripcion": "Melamina que trae el cliente",
		"placaLargoMm": "2600", "placaAnchoMm": "1830", "piezas": []any{pieza(2000, 1500, 1)}})
	g := leerFicha(t, e, ven, grande)
	if gc := g["cuenta"].(map[string]any); gc["placasEnteras"].(float64) != 0 || gc["subtotalPlacas"].(float64) != 0 ||
		g["pasadasACobrar"].(float64) == 0 || len(gc["faltan"].([]any)) != 0 {
		t.Errorf("la placa del cliente grande: %v %v", g["pasadasACobrar"], gc)
	}
	if _, err := e.pool.Exec(context.Background(), `insert into cutting_rates (material, precio_por_pasada, precio_por_metro_canto) values ('Placa del cliente', 1500, 0)`); err != nil {
		t.Fatal(err)
	}
	if c := leerFicha(t, e, ven, id)["cuenta"].(map[string]any); c["precioPorPasada"].(float64) != 1500 {
		t.Errorf("con su tarifa: %v", c["precioPorPasada"])
	}
}

// M3S4-040: cobrar desde la ficha un corte que ya salió de la máquina da un
// pedido «listo», que se entrega con un paso. Si todavía no salió, nace
// pendiente, como siempre.
func TestElCorteTerminadoNacePedidoListo(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	nuevo := func() string {
		return alta(t, e, ven, map[string]any{"contactoNombre": "Rodolfo", "materialDescripcion": "MDF — 1830 x 2600mm — 18mm",
			"placaLargoMm": "2600", "placaAnchoMm": "1830", "piezas": []any{pieza(600, 300, 3)}})
	}
	estadoDelPedido := func(id string) string {
		code, b := pedir(t, ven, "POST", e.srv.URL+"/api/v1/admin/cortes/"+id+"/pedido", nil)
		if code != 200 {
			t.Fatalf("a pedido: %d %s", code, b)
		}
		var estado string
		if err := e.pool.QueryRow(context.Background(), `select o.estado::text from orders o join cutting_orders c on c.order_id = o.id where c.id = $1`, id).Scan(&estado); err != nil {
			t.Fatal(err)
		}
		return estado
	}
	enCola := nuevo()
	if got := estadoDelPedido(enCola); got != "pendiente" {
		t.Errorf("en cola: %s", got)
	}
	// Cobrado antes de cortarlo, pasa a listo cuando sale de la máquina:
	// no tiene nada más que preparar.
	for _, desde := range []string{"en-cola", "en-proceso"} {
		if code, b := pedir(t, ven, "POST", e.srv.URL+"/api/v1/admin/cortes/"+enCola+"/avanzar?desde="+desde, nil); code != 200 {
			t.Fatalf("avanzar desde %s: %d %s", desde, code, b)
		}
	}
	if got := e.txt(t, `select o.estado::text from orders o join cutting_orders c on c.order_id = o.id where c.id = $1`, enCola); got != "listo" {
		t.Errorf("cobrado y terminado después: %s", got)
	}
	terminado := nuevo()
	for _, desde := range []string{"en-cola", "en-proceso"} {
		if code, b := pedir(t, ven, "POST", e.srv.URL+"/api/v1/admin/cortes/"+terminado+"/avanzar?desde="+desde, nil); code != 200 {
			t.Fatalf("avanzar desde %s: %d %s", desde, code, b)
		}
	}
	if got := estadoDelPedido(terminado); got != "listo" {
		t.Errorf("terminado: %s", got)
	}
}

// M3S4-016: la regla corte_chico_stock. Con «no_mueve» (la de arranque) el
// corte chico no toca el stock; con «descuenta» la placa sale al terminarlo
// y vuelve si se devuelve a la máquina.
func TestElStockDeLaPlacaChica(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	if _, err := e.pool.Exec(ctx, `insert into inventory (variant_id, branch_id, qty, min_qty) values ($1, $2, 10, 0)`, e.melamina, e.central); err != nil {
		t.Fatal(err)
	}
	stock := func() float64 {
		var n float64
		if err := e.pool.QueryRow(ctx, `select qty::float8 from inventory where variant_id = $1 and branch_id = $2`, e.melamina, e.central).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	u := e.srv.URL + "/api/v1/admin/cortes/"
	paso := func(id, que, desde string) {
		if code, b := pedir(t, ven, "POST", u+id+"/"+que+"?desde="+desde, nil); code != 200 {
			t.Fatalf("%s desde %s: %d %s", que, desde, code, b)
		}
	}
	chico := func() string {
		return alta(t, e, ven, melamina(e, "branchId", e.central, "piezas", []any{pieza(600, 300, 3)}))
	}

	uno := chico()
	paso(uno, "avanzar", "en-cola")
	paso(uno, "avanzar", "en-proceso")
	if n := stock(); n != 10 {
		t.Errorf("no_mueve: el stock quedó en %v", n)
	}

	if err := reglas.Fijar(ctx, e.pool, reglas.CorteChicoStock, "descuenta"); err != nil {
		t.Fatal(err)
	}
	dos := chico()
	paso(dos, "avanzar", "en-cola")
	paso(dos, "avanzar", "en-proceso")
	if n := stock(); n != 9 {
		t.Errorf("descuenta: el stock quedó en %v", n)
	}
	paso(dos, "volver", "terminado")
	if n := stock(); n != 10 {
		t.Errorf("vuelto a la máquina: %v", n)
	}
	paso(dos, "avanzar", "en-proceso")
	if n := stock(); n != 9 {
		t.Errorf("terminado otra vez: %v", n)
	}
}

// M2S4-039: el relleno de la placa vendida nunca empeora el plano (no vende
// menos placas, no usa más, no cobra más pasadas) y en el banco de 200
// despieces baja las pasadas de alguno. Mide cuánto tarda.
func TestElRellenoDeLaPlacaVendida(t *testing.T) {
	no := false
	mejoraron, pasadasAntes, pasadasDespues := 0, 0, 0
	inicio := time.Now()
	for i, d := range despiecesDePrueba(200, 20261127) {
		sinRelleno := d
		sinRelleno.Relleno = &no
		base := ConLaHoja(CalcularPlano(sinRelleno))
		con := ConLaHoja(CalcularPlano(d))
		if con.PlacasEnteras < base.PlacasEnteras || len(con.Placas) > len(base.Placas) ||
			con.PasadasCobrables > base.PasadasCobrables || len(con.NoEntran) > len(base.NoEntran) || con.TotalPiezas != base.TotalPiezas {
			t.Errorf("despiece %d: el relleno empeoró: %d/%d/%d contra %d/%d/%d", i,
				con.PlacasEnteras, len(con.Placas), con.PasadasCobrables, base.PlacasEnteras, len(base.Placas), base.PasadasCobrables)
		}
		if con.PasadasCobrables < base.PasadasCobrables {
			mejoraron++
		}
		pasadasAntes += base.PasadasCobrables
		pasadasDespues += con.PasadasCobrables
	}
	t.Logf("relleno: %d de 200 cobran menos pasadas (%d → %d) en %v", mejoraron, pasadasAntes, pasadasDespues, time.Since(inicio))
	if mejoraron == 0 {
		t.Error("el relleno no mejoró ningún despiece del banco")
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
	// La trae el cliente (M2S3-067): sin variante, con la etiqueta del
	// buscador, sale igual que la del catálogo.
	if got := MaterialEnOrden("MDF — 1830 x 2600mm — 18mm", nil, nil); got != "MDF — 2600 × 1830 mm — 18mm" {
		t.Errorf("la trae el cliente: %q", got)
	}
	m, n := int32(2500), int32(1800)
	if got := MaterialEnOrden("MDF — 1830 x 2600mm — 18mm", &m, &n); got != "MDF — 2600 × 1830 mm — 18mm" {
		t.Errorf("con la medida propia distinta: %q", got)
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
