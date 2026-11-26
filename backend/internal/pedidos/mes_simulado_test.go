package pedidos

import (
	"strings"
	"testing"

	"mjbj/internal/sqlc"
)

// Lo que encontró el mes simulado en los presupuestos.
func TestPresupuestosDelMesSimulado(t *testing.T) {
	e := armar(t)
	ven, _ := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	u := e.srv.URL + "/api/v1/admin/"
	nuevo := func(lineas ...map[string]any) string {
		t.Helper()
		alta := e.alta("Sim Lucía", 1, nil)
		if len(lineas) > 0 {
			l := make([]any, len(lineas))
			for i := range lineas {
				l[i] = lineas[i]
			}
			alta["lineas"] = l
		}
		c, b := pedir(t, ven, "POST", u+"presupuestos", alta)
		if c != 200 {
			t.Fatalf("alta: %d %s", c, b)
		}
		return leer[Resultado](t, b).ID
	}

	// H056: un renglón a $0 no se guarda.
	escalera := map[string]any{"variantId": nil, "descripcion": "Escalera Pino a medida", "unidad": "unidad", "cantidad": 1.0, "precioUnitario": 0.0}
	if c, b := pedir(t, ven, "POST", u+"presupuestos", map[string]any{"cabecera": map[string]any{"contactoNombre": "Sim Lucía"}, "lineas": []any{escalera}}); c != 422 ||
		!strings.Contains(b, "Falta el precio de «Escalera Pino a medida»") {
		t.Errorf("renglón a $0: %d %s", c, b)
	}

	// H193: cada acción dice qué pasó, y el rechazo guarda el motivo.
	p := nuevo()
	if _, b := pedir(t, ven, "POST", u+"presupuestos/"+p+"/estado", map[string]any{"estado": "aceptado"}); !strings.Contains(b, "Presupuesto aceptado.") {
		t.Errorf("aceptar: %s", b)
	}
	if c, b := pedir(t, ven, "POST", u+"presupuestos/"+p+"/estado", map[string]any{"estado": "rechazado", "motivo": "Cualquiera"}); c != 422 {
		t.Errorf("motivo inventado: %d %s", c, b)
	}
	if _, b := pedir(t, ven, "POST", u+"presupuestos/"+p+"/estado", map[string]any{"estado": "rechazado", "motivo": "Precio"}); !strings.Contains(b, "Presupuesto rechazado.") {
		t.Errorf("rechazar: %s", b)
	}
	if m := e.texto(t, `select coalesce(motivo_rechazo, '') from quotes where id = $1`, p); m != "Precio" {
		t.Errorf("motivo guardado: %q", m)
	}

	// H040: uno pendiente se corrige y conserva el número; ya enviado, no.
	p = nuevo()
	numero := e.texto(t, `select numero from quotes where id = $1`, p)
	correccion := e.alta("Sim Lucía", 3, nil)
	if c, b := pedir(t, ven, "PUT", u+"presupuestos/"+p, correccion); c != 200 {
		t.Fatalf("corregir: %d %s", c, b)
	}
	if n, total := e.texto(t, `select numero from quotes where id = $1`, p), e.texto(t, `select total::text from quotes where id = $1`, p); n != numero || total != "265500.50" {
		t.Errorf("corregido: %s %s", n, total)
	}
	if c := e.numero(t, `select count(*)::float8 from quote_items where quote_id = $1`, p); c != 2 {
		t.Errorf("renglones después de corregir: %v", c)
	}
	e.exec(t, `update quotes set estado = 'enviado' where id = $1`, p)
	if c, b := pedir(t, ven, "PUT", u+"presupuestos/"+p, correccion); c != 422 || !strings.Contains(b, "duplicalo") {
		t.Errorf("corregir uno enviado: %d %s", c, b)
	}

	// H186: con envío, una zona inventada no pasa y sin flete tampoco; la
	// zona con costo fijo lo propone.
	e.exec(t, `insert into shipping_zones (nombre, costo, a_cotizar) values ('Mar del Plata', 0, true), ('Batán', 9000, false)`)
	p = nuevo()
	envio := func(extra map[string]any) map[string]any {
		m := map[string]any{"tipoEntrega": "envio", "direccion": "Colón 1234"}
		for k, v := range extra {
			m[k] = v
		}
		return m
	}
	if c, b := pedir(t, ven, "POST", u+"presupuestos/"+p+"/pedido", envio(map[string]any{"zona": "Centro", "costoEnvio": 5000.0})); c != 422 || !strings.Contains(b, "zona de la lista") {
		t.Errorf("zona inventada: %d %s", c, b)
	}
	if c, b := pedir(t, ven, "POST", u+"presupuestos/"+p+"/pedido", envio(map[string]any{"zona": "Mar del Plata"})); c != 422 || !strings.Contains(b, "Falta el flete") {
		t.Errorf("sin flete: %d %s", c, b)
	}
	c, b := pedir(t, ven, "POST", u+"presupuestos/"+p+"/pedido", envio(map[string]any{"zona": "Batán"}))
	if c != 200 {
		t.Fatalf("con la zona de costo fijo: %d %s", c, b)
	}
	pedido := leer[Resultado](t, b)
	if f := e.texto(t, `select costo_envio::text from orders where id = $1`, pedido.ID); f != "9000.00" {
		t.Errorf("el flete de la zona: %s", f)
	}

	// H282: cancelado el pedido, el presupuesto se vuelve a pasar a pedido.
	if c, b := pedir(t, ven, "POST", u+"pedidos/"+pedido.ID+"/cancelar", map[string]any{"motivo": "Correderas de 45"}); c != 200 {
		t.Fatalf("cancelar: %d %s", c, b)
	}
	if _, b := pedir(t, ven, "GET", u+"presupuestos/"+p, nil); !strings.Contains(b, `"pedidoId":null`) {
		t.Errorf("la ficha sigue atada al pedido cancelado: %s", b)
	}
	if c, b := pedir(t, ven, "POST", u+"presupuestos/"+p+"/pedido", envio(map[string]any{"zona": "Batán", "sinCargo": true})); c != 200 {
		t.Errorf("volver a pasarlo: %d %s", c, b)
	}

	// H284: un aceptado sin pedido va entre los abiertos, primero.
	aceptado := nuevo()
	e.exec(t, `update quotes set estado = 'aceptado' where id = $1`, aceptado)
	_, b = pedir(t, ven, "GET", u+"presupuestos?estado=abiertos", nil)
	if !strings.Contains(b, `"filas":[{"id":"`+aceptado+`"`) {
		t.Errorf("el aceptado sin pedido no encabeza los abiertos: %s", b)
	}
	if _, b := pedir(t, ven, "GET", u+"presupuestos?estado=cerrados", nil); strings.Contains(b, aceptado) {
		t.Errorf("el aceptado sin pedido sigue en cerrados")
	}

	// H039: el renglón por debajo del costo se marca (costo 40.000,50 +
	// 21 % = 48.400,61; el presupuesto lo vende a 100).
	barato := nuevo(map[string]any{"variantId": e.placa, "descripcion": "Fenólico 18 mm", "unidad": "unidad", "cantidad": 3.0, "precioUnitario": 100.0})
	_, b = pedir(t, ven, "GET", u+"presupuestos/"+barato, nil)
	if !strings.Contains(b, `"bajoCosto":true`) {
		t.Errorf("no marca el renglón bajo costo: %s", b)
	}
	// Y trae el piso, para que corregir o duplicar lo marque en el formulario.
	if !strings.Contains(b, `"piso":48400.61`) {
		t.Errorf("la ficha no trae el piso del renglón: %s", b)
	}
	_, b = pedir(t, ven, "GET", u+"presupuestos/"+aceptado, nil)
	if strings.Contains(b, `"bajoCosto":true`) {
		t.Errorf("marca bajo costo un precio que cubre el costo: %s", b)
	}
}
