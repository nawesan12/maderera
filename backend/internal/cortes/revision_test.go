package cortes

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"
)

// Los defectos que encontró la revisión de cortes del 17/11: cada prueba
// falla con el defecto y pasa con el arreglo.

func planoPedido(n int, extra map[string]any) map[string]any {
	m := map[string]any{
		"piezas":     []any{map[string]any{"largoMm": 100, "anchoMm": 100, "cantidad": n, "respetaVeta": 0}},
		"placaLargo": 2750, "placaAncho": 1830,
	}
	for k, v := range extra {
		m[k] = v
	}
	return m
}

// El plano del sitio es anónimo: sin sesión, el tope del sitio y un freno por
// IP; el panel sigue con el tope de un corte.
func TestPlanoAnonimoConTopeYFreno(t *testing.T) {
	e := armar(t)
	u := e.srv.URL + "/api/v1/cortes/plano"
	ip := func(s string) []string { return []string{"X-Forwarded-For", s} }

	if code, b := pedir(t, http.DefaultClient, "POST", u, planoPedido(MaximoDePiezas+1, nil), ip("10.0.0.1")...); code != 422 || !strings.Contains(b, "demasiadas piezas") {
		t.Errorf("sin sesión, %d piezas: %d %s", MaximoDePiezas+1, code, b)
	}
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	if code, b := pedir(t, ven, "POST", u, planoPedido(MaximoDePiezas+1, nil)); code != 200 {
		t.Errorf("el panel con %d piezas: %d %s", MaximoDePiezas+1, code, b)
	}

	// El freno: pasado el máximo, 429; otra IP sigue andando.
	for i := 0; ; i++ {
		code, b := pedir(t, http.DefaultClient, "POST", u, planoPedido(1, nil), ip("10.0.0.2")...)
		if code == 429 {
			if i < 100 {
				t.Errorf("el freno saltó a los %d pedidos", i)
			}
			break
		}
		if code != 200 {
			t.Fatalf("pedido %d: %d %s", i, code, b)
		}
		if i > 2000 {
			t.Fatal("el plano anónimo no tiene freno")
		}
	}
	if code, _ := pedir(t, http.DefaultClient, "POST", u, planoPedido(1, nil), ip("10.0.0.3")...); code != 200 {
		t.Errorf("otra IP: %d", code)
	}
}

// Una pieza fijada a una placa lejana no arma las placas del medio.
func TestPlanoSinPlacasVacias(t *testing.T) {
	piezas := []PiezaAcortar{{LargoMm: 600, AnchoMm: 400, Cantidad: 2}}
	p := CalcularPlano(DatosDelPlano{Piezas: piezas, PlacaLargo: 2750, PlacaAncho: 1830,
		Fijadas: []PiezaFijada{{Indice: 0, Unidad: 2, Placa: 4}}})
	if len(p.Placas) > 2 {
		t.Fatalf("dos piezas en %d placas", len(p.Placas))
	}
	for i, pl := range p.Placas {
		if len(pl.Piezas) == 0 || pl.Numero != i+1 {
			t.Errorf("placa %d: número %d, %d piezas", i, pl.Numero, len(pl.Piezas))
		}
	}
	if p.TotalPiezas != 2 || len(p.FijadasDescartadas) != 0 {
		t.Errorf("piezas %d, descartadas %v", p.TotalPiezas, p.FijadasDescartadas)
	}

	// Desde un acomodo guardado la placa puede ser cualquier número.
	listo := make(chan Plano, 1)
	go func() {
		listo <- CalcularPlano(DatosDelPlano{Piezas: piezas, PlacaLargo: 2750, PlacaAncho: 1830,
			Fijadas: LeerAcomodoManual(`[{"indice":0,"unidad":1,"placa":100000000}]`)})
	}()
	select {
	case p := <-listo:
		if len(p.Placas) > 2 {
			t.Errorf("con la placa 10⁸: %d placas", len(p.Placas))
		}
	case <-time.After(5 * time.Second):
		t.Fatal("una fijada a la placa 10⁸ colgó el plano")
	}

	// Por la API (el contrato deja hasta la placa 5000).
	e := armar(t)
	code, b := pedir(t, http.DefaultClient, "POST", e.srv.URL+"/api/v1/cortes/plano", map[string]any{
		"piezas":     []any{map[string]any{"largoMm": 600, "anchoMm": 400, "cantidad": 2, "respetaVeta": 0}},
		"placaLargo": 2750, "placaAncho": 1830,
		"fijadas": []any{map[string]any{"indice": 0, "unidad": 1, "placa": 5000}},
	})
	var r struct{ Plano Plano }
	_ = json.Unmarshal([]byte(b), &r)
	if code != 200 || len(r.Plano.Placas) > 2 {
		t.Errorf("fijada a la 5000: %d, %d placas", code, len(r.Plano.Placas))
	}
}

// El alta no guarda un corte que después no se puede dibujar, y uno viejo
// que pasa el tope no cuelga la ficha.
func TestAltaConTopeDePiezas(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	var piezas []any
	for i := range 6 {
		piezas = append(piezas, pieza(100+i, 100, 999))
	}
	code, b := pedir(t, ven, "POST", e.srv.URL+"/api/v1/admin/cortes", map[string]any{
		"contactoNombre": "Gómez", "materialDescripcion": "Melamina", "piezas": piezas})
	if code != 422 || !strings.Contains(b, "demasiadas piezas") {
		t.Fatalf("5994 piezas: %d %s", code, b)
	}
	var n int
	_ = e.pool.QueryRow(context.Background(), `select count(*) from cutting_orders`).Scan(&n)
	if n != 0 {
		t.Fatalf("se guardaron %d cortes", n)
	}

	// Uno viejo, de antes del tope: la ficha abre (sin plano) y la hoja avisa.
	if code, b := pedir(t, ven, "POST", e.srv.URL+"/api/v1/admin/cortes", map[string]any{
		"contactoNombre": "Gómez", "materialDescripcion": "Melamina", "placaLargoMm": "2750", "placaAnchoMm": "1830",
		"piezas": []any{pieza(100, 100, 1)}}); code != 200 {
		t.Fatalf("alta: %d %s", code, b)
	}
	var id string
	_ = e.pool.QueryRow(context.Background(), `select id::text from cutting_orders`).Scan(&id)
	if _, err := e.pool.Exec(context.Background(), `update cutting_items set cantidad = 30000 where cutting_order_id = $1`, id); err != nil {
		t.Fatal(err)
	}
	type res struct {
		code int
		b    string
	}
	listo := make(chan res, 1)
	go func() {
		c, b := pedir(t, ven, "GET", e.srv.URL+"/api/v1/admin/cortes/"+id, nil)
		listo <- res{c, b}
	}()
	select {
	case r := <-listo:
		var f Ficha
		_ = json.Unmarshal([]byte(r.b), &f)
		if r.code != 200 || len(f.Plano.Placas) != 0 {
			t.Errorf("ficha: %d, %d placas", r.code, len(f.Plano.Placas))
		}
	case <-time.After(5 * time.Second):
		t.Fatal("la ficha de un corte de 30 000 piezas se colgó")
	}
	if code, b := pedir(t, ven, "GET", e.srv.URL+"/api/v1/admin/cortes/"+id+"/hoja", nil); code != 409 || !strings.Contains(b, "demasiadas piezas") {
		t.Errorf("hoja: %d %s", code, b)
	}
	if code, b := pedir(t, ven, "PUT", e.srv.URL+"/api/v1/admin/cortes/"+id+"/sierra", map[string]any{"valor": "3"}); code != 422 || !strings.Contains(b, "demasiadas piezas") {
		t.Errorf("sierra: %d %s", code, b)
	}
}

// Una consulta es una sola orden de corte, aunque dos la pasen a la vez; un
// token que no existe es un error, no un corte suelto.
func TestConsultaUnaSolaVez(t *testing.T) {
	e := armar(t)
	code, b := pedir(t, http.DefaultClient, "POST", e.srv.URL+"/api/v1/cortes/consulta", map[string]any{"variantId": e.melamina,
		"piezas": []any{map[string]any{"largoMm": 900, "anchoMm": 600, "cantidad": 1, "respetaVeta": 0, "cantoLargo": 0, "cantoAncho": 0}}})
	if code != 200 {
		t.Fatalf("consulta: %d %s", code, b)
	}
	var r struct{ Token string }
	_ = json.Unmarshal([]byte(b), &r)
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	alta := func(token string) (int, string) {
		return pedir(t, ven, "POST", e.srv.URL+"/api/v1/admin/cortes", map[string]any{"contactoNombre": "Por WhatsApp",
			"materialDescripcion": "Melamina", "consulta": token, "piezas": []any{pieza(900, 600, 1)}})
	}

	if code, b := alta("noexiste12345678"); code != 422 || !strings.Contains(b, "No encontramos esa consulta") {
		t.Errorf("token falso: %d %s", code, b)
	}
	codigos := make([]int, 8)
	cuerpos := make([]string, 8)
	listos := make(chan struct{})
	hechos := make(chan int)
	for i := range 8 {
		go func() {
			<-listos
			codigos[i], cuerpos[i] = alta(r.Token)
			hechos <- i
		}()
	}
	close(listos)
	for range 8 {
		<-hechos
	}
	buenos := 0
	for i, c := range codigos {
		if c == 200 {
			buenos++
		} else if c != 422 || !strings.Contains(cuerpos[i], "ya se pasó a corte: es el CRT-") {
			t.Errorf("alta %d: %d %s", i, c, cuerpos[i])
		}
	}
	var n int
	_ = e.pool.QueryRow(context.Background(), `select count(*) from cutting_orders`).Scan(&n)
	if buenos != 1 || n != 1 {
		t.Fatalf("una consulta dio %d altas y %d órdenes de corte", buenos, n)
	}
	// El que falló no se llevó un número: el siguiente es CRT-2.
	if code, b := pedir(t, ven, "POST", e.srv.URL+"/api/v1/admin/cortes", map[string]any{"contactoNombre": "Otro",
		"materialDescripcion": "Melamina", "piezas": []any{pieza(900, 600, 1)}}); code != 200 || !strings.Contains(b, `"CRT-2"`) {
		t.Errorf("la numeración: %d %s", code, b)
	}
}

// Un trabajo que ya pasó por la máquina no cambia su acomodo.
func TestAcomodoDeUnCorteYaCortado(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	pedir(t, ven, "POST", e.srv.URL+"/api/v1/admin/cortes", map[string]any{"contactoNombre": "Gómez",
		"materialDescripcion": "Melamina", "piezas": []any{pieza(900, 600, 2)}})
	var id string
	_ = e.pool.QueryRow(context.Background(), `select id::text from cutting_orders`).Scan(&id)
	fijadas := map[string]any{"fijadas": []any{map[string]any{"indice": 0, "unidad": 1, "placa": 2}}}
	for _, estado := range []string{"en-proceso", "terminado", "retirado", "cancelado"} {
		_, _ = e.pool.Exec(context.Background(), `update cutting_orders set estado = $2 where id = $1`, id, estado)
		if code, b := pedir(t, ven, "PUT", e.srv.URL+"/api/v1/admin/cortes/"+id+"/acomodo", fijadas); code != 422 || !strings.Contains(b, "ya pasó por la máquina") {
			t.Errorf("%s: %d %s", estado, code, b)
		}
	}
	var acomodo *string
	_ = e.pool.QueryRow(context.Background(), `select acomodo_manual from cutting_orders where id = $1`, id).Scan(&acomodo)
	if acomodo != nil {
		t.Errorf("se guardó el acomodo: %s", *acomodo)
	}
	if code, _ := pedir(t, ven, "PUT", e.srv.URL+"/api/v1/admin/cortes/00000000-0000-4000-8000-000000000000/acomodo", fijadas); code != 404 {
		t.Errorf("un corte que no existe: %d", code)
	}
}

// El agente vuelve a bajar un corte que se corrigió después de bajarlo.
func TestAgenteVeLaCorreccion(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	pedir(t, ven, "POST", e.srv.URL+"/api/v1/admin/cortes", map[string]any{"contactoNombre": "Gómez",
		"materialDescripcion": "Melamina", "piezas": []any{pieza(900, 600, 2)}})
	var id string
	_ = e.pool.QueryRow(context.Background(), `select id::text from cutting_orders`).Scan(&id)
	_, _ = e.pool.Exec(context.Background(), `update cutting_orders set created_at = created_at - interval '1 day', updated_at = updated_at - interval '1 day'`)
	actualizado := func() string {
		_, b := pedir(t, http.DefaultClient, "GET", e.srv.URL+"/api/cortes/pendientes", nil, "Authorization", "Bearer "+tokenAgente)
		var r struct {
			Cortes []struct{ Actualizado string }
		}
		_ = json.Unmarshal([]byte(b), &r)
		if len(r.Cortes) != 1 {
			t.Fatalf("pendientes: %s", b)
		}
		return r.Cortes[0].Actualizado
	}
	antes := actualizado()
	cambios := []struct {
		que, metodo, ruta string
		cuerpo            any
	}{
		{"acomodo", "PUT", "/acomodo", map[string]any{"fijadas": []any{map[string]any{"indice": 0, "unidad": 1, "placa": 2}}}},
		{"sierra", "PUT", "/sierra", map[string]any{"valor": "3,2"}},
	}
	for _, c := range cambios {
		if code, b := pedir(t, ven, c.metodo, e.srv.URL+"/api/v1/admin/cortes/"+id+c.ruta, c.cuerpo); code != 200 {
			t.Fatalf("%s: %d %s", c.que, code, b)
		}
		ahora := actualizado()
		if ahora == antes {
			t.Errorf("después de cambiar %s, «actualizado» sigue en %s", c.que, ahora)
		}
		antes = ahora
		time.Sleep(5 * time.Millisecond)
	}
}

// La lista de piezas es una planilla: ningún texto llega a Excel como fórmula.
func TestListaSinFormulas(t *testing.T) {
	etiqueta := "=HYPERLINK(\"http://x\";\"y\")"
	c := CorteParaExportar{Numero: "CRT-1", Cliente: "@SUM(A1)", Material: "+Melamina",
		Piezas: []PiezaParaExportar{{LargoMm: 600, AnchoMm: 400, Cantidad: 1, Etiqueta: &etiqueta}}}
	p := PerfilGenerico()
	p.Columnas = append(p.Columnas, ColumnaConfigurada{"cliente", "Cliente"})
	archivo := ArmarArchivoDeCorte(c, p)
	for _, celda := range []string{`"'=HYPERLINK(""http://x"";""y"")"`, "'@SUM(A1)", "'+Melamina"} {
		if !strings.Contains(archivo, celda) {
			t.Errorf("falta %s en %q", celda, archivo)
		}
	}

	// De punta a punta: la etiqueta que se tipeó en el alta.
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	pedir(t, ven, "POST", e.srv.URL+"/api/v1/admin/cortes", map[string]any{"contactoNombre": "Gómez",
		"materialDescripcion": "-Melamina", "piezas": []any{pieza(900, 600, 2, "etiqueta", "=1+1")}})
	var id string
	_ = e.pool.QueryRow(context.Background(), `select id::text from cutting_orders`).Scan(&id)
	_, b := pedir(t, http.DefaultClient, "GET", e.srv.URL+"/api/cortes/"+id+"/lista", nil, "Authorization", "Bearer "+tokenAgente)
	if !strings.Contains(b, ";'-Melamina;'=1+1;") {
		t.Errorf("lista: %q", b)
	}
}

// La lista con un id que no es UUID es 404, no un error del servidor.
func TestListaConIdRaro(t *testing.T) {
	e := armar(t)
	for _, id := range []string{"no-es-un-uuid", "123", "00000000-0000-4000-8000-000000000000"} {
		code, _ := pedir(t, http.DefaultClient, "GET", e.srv.URL+"/api/cortes/"+id+"/lista", nil, "Authorization", "Bearer "+tokenAgente)
		if code != 404 {
			t.Errorf("lista de %q: %d", id, code)
		}
	}
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	for _, ruta := range []string{"/api/cortes/no-es-un-uuid/ptx", "/api/cortes/no-es-un-uuid/lista?perfil=x"} {
		if code, _ := pedir(t, ven, "GET", e.srv.URL+ruta, nil); code != 404 {
			t.Errorf("%s: %d", ruta, code)
		}
	}
}

// La hoja de la máquina sale con el plano solo para el staff: es lo que baja
// el mostrador en PDF antes de cobrar.
func TestPlanoConHojaSoloParaElStaff(t *testing.T) {
	e := armar(t)
	u := e.srv.URL + "/api/v1/cortes/plano"
	cuerpo := planoPedido(3, map[string]any{"hoja": true})

	code, b := pedir(t, http.DefaultClient, "POST", u, cuerpo, "X-Forwarded-For", "10.0.9.1")
	if code != 200 || strings.Contains(b, `"hoja"`) {
		t.Errorf("sin sesión no va la hoja: %d %s", code, b)
	}
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	code, b = pedir(t, ven, "POST", u, cuerpo)
	if code != 200 || !strings.Contains(b, `"hoja"`) || !strings.Contains(b, `"superficies"`) {
		t.Errorf("el mostrador recibe la hoja: %d %s", code, b)
	}
	if code, b := pedir(t, ven, "POST", u, planoPedido(3, nil)); code != 200 || strings.Contains(b, `"hoja"`) {
		t.Errorf("sin pedirla no va: %d %s", code, b)
	}
}
