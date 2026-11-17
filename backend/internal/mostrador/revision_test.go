package mostrador

import (
	"context"
	"testing"

	"mjbj/internal/sqlc"
)

// Los errores que encontró la revisión del 16/11: cada prueba falla con el
// defecto y pasa con el arreglo.

// El descuento por forma de pago sigue a la plata que entra: con el pago
// partido en dos medios no hay, y declarar efectivo pagando con crédito no
// se lleva el de contado.
func TestEscalaSigueALosPagos(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "v@prueba.test", sqlc.StaffRoleVendedor)
	e.abrir(t, ven, e.central, 1000)
	ctx := context.Background()
	if _, err := e.pool.Exec(ctx, `insert into payment_discounts (medio, desde_monto, porcentaje, etiqueta) values ('efectivo', 0, 10, 'Contado -10%')`); err != nil {
		t.Fatal(err)
	}
	v := e.venta("efectivo", e.lineaPlaca(2)) // 90001 sin descuento
	v["pagos"] = []map[string]any{{"medio": "efectivo", "importe": 50000}, {"medio": "debito", "importe": 40001}}
	if _, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", v); m["ok"] != true {
		t.Fatalf("la venta partida en efectivo y débito se rechazó: %s", b)
	}
	v2 := e.venta("efectivo", e.lineaPlaca(2))
	v2["pagos"] = []map[string]any{{"medio": "credito", "importe": 81000.9}}
	if _, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", v2); m["ok"] == true {
		t.Fatalf("declarar efectivo y pagar con crédito se llevó el 10 %%: %s", b)
	}
}

func TestDescuentoNoDejaLaVentaEnCero(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "v@prueba.test", sqlc.StaffRoleVendedor)
	v := e.venta("transferencia", e.lineaPlaca(2))
	v["descuento"] = 999999
	if _, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", v); m["ok"] == true {
		t.Fatalf("una venta con total 0 se aceptó: %s", b)
	}
}

func TestMovimientoEnTurnoCerrado(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "v@prueba.test", sqlc.StaffRoleVendedor)
	e.abrir(t, ven, e.central, 1000)
	turno := e.txt(t, `select id::text from cash_sessions limit 1`)
	if st, m, _ := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/caja/cerrar", map[string]any{"sessionId": turno, "contado": 1000, "notas": ""}); st != 200 {
		t.Fatalf("cerrar %d %v", st, m)
	}
	if st, _, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/caja/movimiento", map[string]any{"sessionId": turno, "tipo": "ingreso", "monto": 5000, "motivo": "x"}); st == 200 {
		t.Fatalf("un ingreso entró en un turno cerrado: %s", b)
	}
}

func TestSinFilaDeInventarioElStockBaja(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "v@prueba.test", sqlc.StaffRoleVendedor)
	v := e.venta("transferencia", map[string]any{"variantId": e.tornillo, "descripcion": "Tornillo", "unidad": "unidad", "cantidad": 7, "precioUnitario": 150})
	v["branchId"] = e.otra
	if _, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", v); m["ok"] != true {
		t.Fatalf("%s", b)
	}
	if q := e.num(t, `select coalesce(sum(qty),0)::float8 from inventory where variant_id=$1 and branch_id=$2`, e.tornillo, e.otra); q != -7 {
		t.Fatalf("el físico quedó en %v y no en -7", q)
	}
}

func TestCantidadConTresDecimales(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "v@prueba.test", sqlc.StaffRoleVendedor)
	v := e.venta("transferencia", map[string]any{"variantId": nil, "descripcion": "Listón", "unidad": "m", "cantidad": 2.375, "precioUnitario": 1000})
	if _, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", v); m["ok"] == true {
		t.Fatalf("una cantidad de tres decimales se guardó con dos: %s", b)
	}
}

func TestCorteDemasiadoGrande(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "v@prueba.test", sqlc.StaffRoleVendedor)
	v := e.venta("transferencia", e.lineaPlaca(1))
	v["corte"] = map[string]any{"variantId": e.placa, "materialDescripcion": "Placa", "placas": 1, "pasadas": 2,
		"piezas": []map[string]any{{"largoMm": 100, "anchoMm": 100, "cantidad": 6000, "respetaVeta": 0, "cantoLargo": 0, "cantoAncho": 0}}}
	if _, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", v); m["ok"] == true {
		t.Fatalf("un corte de 6000 piezas llegó al taller: %s", b)
	}
}

// El vendedor, desde el mostrador: el cheque de una venta no acredita otro
// recibo, y una «retención» sin certificado no baja deuda.
func TestCobroDeCuentaDesdeMostrador(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "v@prueba.test", sqlc.StaffRoleVendedor)
	v := e.venta("cheque", e.lineaPlaca(1))
	v["customerId"] = e.cliente
	v["pagos"] = []map[string]any{{"medio": "cheque", "importe": 45000.5, "cheque": map[string]any{"numero": "11112222", "banco": "Galicia", "fechaPago": "2026-12-01"}}}
	if _, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", v); m["ok"] != true {
		t.Fatalf("%s", b)
	}
	ch := e.txt(t, `select id::text from cheques limit 1`)
	partes := `[{"medio":"cheque","importe":"45000.50","chequeId":"` + ch + `"}]`
	if st, _, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/clientes/"+e.mayor+"/cobro", map[string]any{"branchId": e.central, "partes": partes}); st == 200 {
		t.Fatalf("el cheque de la venta acreditó a otro cliente: %s", b)
	}
	if st, _, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/clientes/"+e.cliente+"/cobro", map[string]any{"branchId": e.central, "partes": `[{"medio":"retencion","importe":"30000"}]`}); st == 200 {
		t.Fatalf("una retención sin certificado bajó deuda: %s", b)
	}
}

// El corte del mostrador sin disco elegido toma el configurado, como el alta
// del panel, y no el de 5 mm del código (revisión de cortes del 17/11).
func TestCorteConLaSierraConfigurada(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "v@prueba.test", sqlc.StaffRoleVendedor)
	if _, err := e.pool.Exec(context.Background(), `insert into calculator_settings (ancho_sierra_mm) values (3.2)`); err != nil {
		t.Fatal(err)
	}
	v := e.venta("transferencia", e.lineaPlaca(1))
	v["corte"] = map[string]any{"variantId": e.placa, "materialDescripcion": "Placa", "placas": 1, "pasadas": 2,
		"cantoDescripcion": nil, "placaLargoMm": nil, "placaAnchoMm": nil, "mitad": nil, "acomodoManual": nil,
		"piezas": []map[string]any{{"largoMm": 600, "anchoMm": 400, "cantidad": 2, "respetaVeta": 0, "cantoLargo": 0, "cantoAncho": 0,
			"etiqueta": nil, "aclaracion": nil}}}
	if _, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", v); m["ok"] != true {
		t.Fatalf("%s", b)
	}
	if s := e.num(t, `select ancho_sierra_mm::float8 from cutting_orders`); s != 3.2 {
		t.Fatalf("el corte nació con disco de %v mm y no con el configurado (3,2)", s)
	}
}
