package checkout

import (
	"context"
	"strings"
	"testing"

	"mjbj/internal/reglas"
	"mjbj/internal/ventas"
)

// Lo que encontró el mes simulado en la tienda (tanda 23).

// M3S2-013 y M3S3-020: las reglas de /admin/reglas que cambian la compra.
func TestPoliticaDeLaCompra(t *testing.T) {
	escalas := []ventas.EscalaDePago{{Medio: "transferencia", DesdeMonto: 0, Porcentaje: 10, Etiqueta: "10% por transferencia"}}
	zona := &Zona{Nombre: "Sim Zona", Costo: 12222}
	// Sin regla: el 10 % sobre la mercadería; con «alcanza al flete», sobre
	// la mercadería y el envío (17.880 + 12.222 = 30.102 → −3.010,20).
	cu, _ := CuentasDeLaCompraCon([]float64{17880}, nil, zona, "transferencia", false, escalas, Politica{})
	if cu.Descuento != 1788 || cu.Total != 28314 {
		t.Fatalf("sin la regla: %+v", cu)
	}
	cu, _ = CuentasDeLaCompraCon([]float64{17880}, nil, zona, "transferencia", false, escalas, Politica{AlFlete: true})
	if cu.Descuento != 3010.2 || cu.Total != 27091.8 {
		t.Fatalf("con el flete: %+v", cu)
	}
	if cu.MotivoDescuento == nil || *cu.MotivoDescuento != "10% por transferencia" {
		t.Fatalf("el motivo del descuento: %+v", cu.MotivoDescuento)
	}
	// La lista del profesional: suma la escala, salvo con la regla en «no».
	cu, _ = CuentasDeLaCompraCon([]float64{26520}, nil, nil, "transferencia", true, escalas, Politica{})
	if cu.Descuento != 2652 {
		t.Fatalf("lista con escala: %+v", cu)
	}
	cu, _ = CuentasDeLaCompraCon([]float64{26520}, nil, nil, "transferencia", true, escalas, Politica{SinEscalaConLista: true})
	if cu.Descuento != 0 || cu.Total != 26520 || cu.MotivoDescuento != nil {
		t.Fatalf("lista sin escala: %+v", cu)
	}
	// La regla de la lista no toca a quien compra con la general.
	cu, _ = CuentasDeLaCompraCon([]float64{26520}, nil, nil, "transferencia", false, escalas, Politica{SinEscalaConLista: true})
	if cu.Descuento != 2652 {
		t.Fatalf("general con la regla de la lista: %+v", cu)
	}
}

// M2S2-002 y M3S1-016: Mercado Pago sin con qué cobrar y la transferencia
// sin a dónde transferir no crean un pedido que no se puede pagar. Y la
// regla del flete llega a la compra de verdad, con su motivo guardado.
func TestMediosSinConQueCobrar(t *testing.T) {
	e := armar(t)
	c := e.anonimo()
	u := e.srv.URL + "/api/v1/carrito"
	pedir(t, c, "POST", u+"/items", map[string]any{"variantId": e.tirante, "descripcion": "Tirante", "cantidad": 10})

	e.s.PagoOnline = func() bool { return false }
	if code, b := pedir(t, c, "POST", u+"/confirmar", e.compra(map[string]any{"medioPago": "mercado_pago"})); code != 422 || !strings.Contains(b, MsjSinPagoOnline) {
		t.Fatalf("Mercado Pago apagado: %d %s", code, b)
	}
	e.exec(t, `delete from datos_bancarios`)
	if code, b := pedir(t, c, "POST", u+"/confirmar", e.compra(nil)); code != 422 || !strings.Contains(b, MsjSinDatosBancarios) {
		t.Fatalf("transferencia sin datos: %d %s", code, b)
	}
	if n := e.numero(t, `select count(*) from orders`); n != 0 {
		t.Fatalf("se crearon %v pedidos", n)
	}

	e.exec(t, `insert into datos_bancarios (cbu) values ('0110000000000000000000')`)
	e.exec(t, `insert into payment_discounts (medio, desde_monto, porcentaje, etiqueta) values ('transferencia', 0, 10, '10% por transferencia')`)
	zona := e.id(t, `insert into shipping_zones (nombre, costo, activa) values ('Sim Zona', 12222, true) returning id`)
	if err := reglas.Fijar(context.Background(), e.pool, reglas.DescuentoAlFlete, "si"); err != nil {
		t.Fatal(err)
	}
	code, b := pedir(t, c, "POST", u+"/confirmar", e.compra(map[string]any{"entrega": "envio", "zonaId": zona, "direccion": "Av. Colón 3200"}))
	if code != 200 {
		t.Fatalf("confirmar: %d %s", code, b)
	}
	// 10 × 1.200,50 = 12.005 + 12.222 de flete = 24.227 → −2.422,70.
	var descuento, total, motivo string
	if err := e.pool.QueryRow(context.Background(), `select descuento::text, total::text, coalesce(descuento_motivo, '') from orders`).
		Scan(&descuento, &total, &motivo); err != nil {
		t.Fatal(err)
	}
	if descuento != "2422.70" || total != "21804.30" || motivo != "10% por transferencia" {
		t.Fatalf("con la regla del flete: %s %s %q", descuento, total, motivo)
	}
}
