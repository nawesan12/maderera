package mostrador

import (
	"context"
	"testing"

	"mjbj/internal/ventas"
)

// Mes simulado, H218: vender más de lo que hay se puede —se vende a
// pedido—, pero la venta lo dice para que alguien lo pida.
func TestLaVentaAvisaLoVendidoDeMas(t *testing.T) {
	e := armar(t)
	ses := e.sesionDe(t, "demas@prueba.test")
	inicial, _ := e.fisicoYReservado(t)
	p := e.placa
	vender := func(cantidad float64) ResultadoVenta {
		t.Helper()
		r, err := e.svc.RegistrarVenta(context.Background(), VentaPedida{Clave: claveDeStock(), BranchID: e.central, ContactoNombre: "Constructora",
			MedioPago: ventas.Transferencia, Acopio: true,
			Lineas: []ventas.LineaDeVenta{{VariantID: &p, Descripcion: "Fenólico", Unidad: "placa", Cantidad: cantidad, PrecioUnitario: 100}}}, comoAdmin(ses.UserID), ses.UserID)
		if err != nil || !r.Ok {
			t.Fatalf("venta: %v %+v", err, r)
		}
		return r
	}
	if r := vender(inicial - 5); r.AvisoStock != "" {
		t.Errorf("con stock, avisó: %q", r.AvisoStock)
	}
	// Con lo que queda en el estante y para quién está apartado (M3S1-064).
	if r := vender(12); r.AvisoStock != "Se vendió más de lo que hay: Fenólico 18 mm (faltan 7; quedan 100 apartadas para PED-1000)." {
		t.Errorf("vendido de más: %q", r.AvisoStock)
	}
}
