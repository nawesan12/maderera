package compras

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"mjbj/internal/jsmath"
)

// Las pruebas de la tanda del mes simulado 23 (compras y pagos).

func (e *entorno) vistaPrevia(t *testing.T, c *http.Client, archivo string, perfil map[string]string) VistaPreviaProveedor {
	t.Helper()
	cuerpo, tipo := multipartDe(t, archivo, perfil)
	req, _ := http.NewRequest("POST", e.u+"compras/lista-proveedor/vista-previa", cuerpo)
	req.Header.Set("Content-Type", tipo)
	resp, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var v VistaPreviaProveedor
	_ = json.NewDecoder(resp.Body).Decode(&v)
	return v
}

// M2S1-001, M2S1-003, M2S2-026, M2S2-042, M3S2-029: sin margen escrito, la
// vista previa mantiene el margen de cada variante (el costo sube 5 %, el
// precio sube 5 %), marca la baja, y aplicar deja el historial y el costo
// que después sugiere la orden.
func TestListaDelProveedorMantieneElMargenYDejaRastro(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	ctx := context.Background()
	var lista string
	_ = e.pool.QueryRow(ctx, `insert into price_lists (slug, name, is_default) values ('general', 'General', true) returning id`).Scan(&lista)
	_, _ = e.pool.Exec(ctx, `insert into price_list_items (price_list_id, variant_id, price) values ($1, $2, 28500), ($1, $3, 1000)`, lista, e.placa, e.tornillo)
	_, _ = e.pool.Exec(ctx, `insert into variant_costs (variant_id, cantidad_base, costo_promedio) values ($1, 10, 16800), ($2, 10, 500)`, e.placa, e.tornillo)

	perfil := map[string]string{"supplierId": e.proveedor, "columnaCodigo": "Código", "columnaPrecio": "Precio", "precioEsNeto": "on", "margenPorcentaje": ""}
	v := e.vistaPrevia(t, adm, "Código;Precio\nFEN18;17.640\nTOR;400\n", perfil)
	if len(v.Filas) != 2 {
		t.Fatalf("vista: %+v", v)
	}
	placa, tornillo := v.Filas[0], v.Filas[1]
	// 28.500 × 17.640 / 16.800 = 29.925: el mismo margen de hoy.
	if placa.CostoNeto != 17640 || placa.CostoAnterior == nil || *placa.CostoAnterior != 16800 || placa.PrecioSugerido != 29925 || placa.Cambio != CambioSube {
		t.Errorf("la placa: %+v", placa)
	}
	if tornillo.PrecioSugerido != 800 || tornillo.Cambio != CambioBaja {
		t.Errorf("el tornillo baja: %+v", tornillo)
	}

	// Con el margen escrito, se usa ese (como antes).
	perfil["margenPorcentaje"] = "40"
	if w := e.vistaPrevia(t, adm, "Código;Precio\nFEN18;17.640\n", perfil); w.Filas[0].PrecioSugerido != 29882.16 {
		t.Errorf("con margen 40: %+v", w.Filas[0])
	}

	perfil["margenPorcentaje"] = ""
	aplicar := map[string]string{}
	for k, x := range perfil {
		aplicar[k] = x
	}
	aplicar["filas"] = fmt.Sprintf(`[{"codigo":"FEN18","variantId":%q,"costo":21344.4,"costoNeto":17640,"precioSugerido":29925}]`, e.placa)
	c, b := pedir(t, adm, "POST", e.u+"compras/lista-proveedor/aplicar", aplicar)
	if c != 200 || !strings.Contains(b, "Listo: 1 precio actualizado.") {
		t.Fatalf("aplicar: %d %s", c, b)
	}
	if n := e.numero(t, `select count(*)::float8 from price_history where variant_id = $1 and origen = 'importacion' and precio_anterior = 28500 and precio_nuevo = 29925
		and motivo = 'Lista de Maderas del Sur'`, e.placa); n != 1 {
		t.Errorf("el historial no tiene el cambio: %v", n)
	}
	if n := e.numero(t, `select costo_neto::float8 from supplier_variant_codes where supplier_id = $1 and variant_id = $2`, e.proveedor, e.placa); n != 17640 {
		t.Errorf("costo guardado: %v", n)
	}
	// La orden al mismo proveedor sugiere el costo de su lista; sin
	// proveedor, el promedio.
	if _, b := pedir(t, adm, "GET", e.u+"compras/mercaderia?texto=fen&proveedor="+e.proveedor, nil); !strings.Contains(b, `"costoActual":"17640.0000"`) {
		t.Errorf("con proveedor: %s", b)
	}
	if _, b := pedir(t, adm, "GET", e.u+"compras/mercaderia?ids="+e.placa+"&proveedor="+e.proveedor, nil); !strings.Contains(b, `"costoActual":"17640.0000"`) {
		t.Errorf("por ids con proveedor: %s", b)
	}
	if _, b := pedir(t, adm, "GET", e.u+"compras/mercaderia?texto=fen", nil); !strings.Contains(b, `"costoActual":"16800.0000"`) {
		t.Errorf("sin proveedor: %s", b)
	}

	// Aplicar otra vez lo mismo no cambia nada ni suma historial; la vista
	// previa lo cuenta como sin cambios.
	if c, b := pedir(t, adm, "POST", e.u+"compras/lista-proveedor/aplicar", aplicar); c != 200 || !strings.Contains(b, "Listo: 0 precios actualizados y 1 costo guardado.") {
		t.Errorf("reaplicar: %d %s", c, b)
	}
	if n := e.numero(t, `select count(*)::float8 from price_history where variant_id = $1`, e.placa); n != 1 {
		t.Errorf("historial duplicado: %v", n)
	}
	if w := e.vistaPrevia(t, adm, "Código;Precio\nFEN18;17.640\n", perfil); w.SinCambios != 1 || w.Filas[0].Cambio != CambioIgual {
		t.Errorf("sin cambios: %+v", w)
	}
}

// M3S2-057: buscar «laca» trae primero las lacas, no las placas.
func TestBuscarMercaderiaPrimeroLoQueEmpiezaIgual(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	ctx := context.Background()
	var cat, laca string
	_ = e.pool.QueryRow(ctx, `select category_id from products where slug = 'fenolico'`).Scan(&cat)
	_, _ = e.pool.Exec(ctx, `update products set name = 'Fenólico placa' where slug = 'fenolico'`)
	_ = e.pool.QueryRow(ctx, `insert into products (slug, name, category_id, description, unit) values ('laca', 'Laca 4 L', $1, '', 'unidad') returning id`, cat).Scan(&laca)
	_, _ = e.pool.Exec(ctx, `insert into product_variants (product_id, sku, label) values ($1, 'LAC4', '4 L')`, laca)
	_, b := pedir(t, adm, "GET", e.u+"compras/mercaderia?texto=laca", nil)
	var xs []Mercaderia
	_ = json.Unmarshal([]byte(b), &xs)
	if len(xs) < 2 || xs[0].Producto != "Laca 4 L" {
		t.Errorf("orden: %s", b)
	}
}

// M2S1-026, M2S1-036, M2S1-110: la pantalla ve la cuenta del certificado
// antes de pagar: base − mínimo = sujeto × alícuota.
func TestSimularRetencionesComoElCertificado(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	ctx := context.Background()
	gan := e.regimen(t, "78", "ganancias", 2)
	_, _ = e.pool.Exec(ctx, `update regimenes_retencion set minimo_no_imponible = 224000, minimo_retencion = 0 where id = $1`, gan)
	_, _ = e.pool.Exec(ctx, `update suppliers set cuit = '30712345679', condicion_ganancias = 'inscripto' where id = $1`, e.proveedor)
	c, b := pedir(t, adm, "POST", e.u+"compras/pagos/simular", map[string]any{"supplierId": e.proveedor,
		"retenciones": []any{map[string]any{"regimenId": gan, "base": 4352000}}})
	var v []RetencionSimulada
	_ = json.Unmarshal([]byte(b), &v)
	if c != 200 || len(v) != 1 || v[0].Minimo != 224000 || v[0].Imponible != 4128000 || v[0].Retencion != 82560 {
		t.Fatalf("simular: %d %s", c, b)
	}
	if n := e.numero(t, `select count(*)::float8 from bases_de_retencion`); n != 0 {
		t.Errorf("simular anotó %v bases", n)
	}
	// Por debajo del mínimo dice por qué.
	_, b = pedir(t, adm, "POST", e.u+"compras/pagos/simular", map[string]any{"supplierId": e.proveedor,
		"retenciones": []any{map[string]any{"regimenId": gan, "base": 1000}}})
	if !strings.Contains(b, `"retencion":0`) || !strings.Contains(b, "mínimo no imponible") {
		t.Errorf("bajo el mínimo: %s", b)
	}
}

func (e *entorno) facturaDeCompra(t *testing.T, c *http.Client, numero int, extra map[string]any) string {
	t.Helper()
	f := map[string]any{"supplierId": e.proveedor, "tipo": "factura_a", "puntoVenta": 3, "numero": numero, "fechaEmision": "2026-10-20",
		"neto": 100000, "iva21": 21000, "iva105": 0, "iva27": 0, "exento": 0, "percepciones": 0}
	for k, v := range extra {
		f[k] = v
	}
	code, b := pedir(t, c, "POST", e.u+"compras/facturas", f)
	if code != 200 {
		t.Fatalf("factura %d: %d %s", numero, code, b)
	}
	return idDe(t, b)
}

// M2S2-013: un pago con el interruptor apagado también suma su base al
// acumulado del mes, si el proveedor ya tiene base en ese régimen.
func TestPagoSinRetenerSumaAlAcumulado(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	ctx := context.Background()
	gan := e.regimen(t, "78", "ganancias", 2)
	_, _ = e.pool.Exec(ctx, `update regimenes_retencion set minimo_no_imponible = 224000, minimo_retencion = 0 where id = $1`, gan)
	_, _ = e.pool.Exec(ctx, `update suppliers set cuit = '30712345679', condicion_ganancias = 'inscripto' where id = $1`, e.proveedor)
	f1, f2 := e.facturaDeCompra(t, adm, 1, nil), e.facturaDeCompra(t, adm, 2, nil)
	c, b := pedir(t, adm, "POST", e.u+"compras/pagos", map[string]any{"supplierId": e.proveedor, "total": 121000, "medio": "transferencia",
		"retenciones":  []any{map[string]any{"regimenId": gan, "base": 100000}},
		"imputaciones": []any{map[string]any{"purchaseInvoiceId": f1, "importe": 121000}}})
	if c != 200 {
		t.Fatalf("primer pago: %d %s", c, b)
	}
	c, b = pedir(t, adm, "POST", e.u+"compras/pagos", map[string]any{"supplierId": e.proveedor, "total": 60500, "medio": "transferencia",
		"retenciones":  []any{},
		"imputaciones": []any{map[string]any{"purchaseInvoiceId": f2, "importe": 60500}}})
	if c != 200 {
		t.Fatalf("segundo pago: %d %s", c, b)
	}
	if n := e.numero(t, `select coalesce(sum(base), 0)::float8 from bases_de_retencion where supplier_id = $1`, e.proveedor); n != 150000 {
		t.Errorf("el acumulado del mes tiene que contar los dos pagos: %v", n)
	}
}

// M2S2-077: la base de una factura con una nota de crédito aplicada sale de
// sus netos, no de la proporción de la factura sola.
func TestBaseDeUnaFacturaConNotaDeCredito(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	fc := e.facturaDeCompra(t, adm, 8950, map[string]any{"neto": 2540000, "iva21": 533400, "percepciones": 76200})
	e.facturaDeCompra(t, adm, 930, map[string]any{"tipo": "nota_credito_a", "neto": 10500, "iva21": 2205, "aplicaA": fc, "fechaEmision": "2026-10-21"})
	_, b := pedir(t, adm, "GET", e.u+"proveedores/"+e.proveedor+"/facturas-con-saldo", nil)
	var fs []FacturaConSaldo
	_ = json.Unmarshal([]byte(b), &fs)
	var f *FacturaConSaldo
	for i := range fs {
		if fs[i].ID == fc {
			f = &fs[i]
		}
	}
	if f == nil {
		t.Fatalf("sin la factura: %s", b)
	}
	if base := jsmath.Redondear2(f.Saldo * f.NetoSinIva / f.Total); base != 2529500 {
		t.Errorf("base del saldo: %v (%+v)", base, *f)
	}
}

// M2S1-125: un ajuste que subió la deuda se paga como una factura y el pago
// dice qué canceló. M2S2-078: anulado, lo sigue diciendo.
func TestPagarUnAjusteYAnularlo(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	if c, b := pedir(t, adm, "POST", e.u+"proveedores/"+e.proveedor+"/movimientos", map[string]any{"supplierId": e.proveedor, "tipo": "ajuste",
		"sentido": "sube", "monto": 150000, "detalle": "Saldo inicial", "referencia": "SIM-SALDO-INI"}); c != 200 {
		t.Fatalf("ajuste: %d %s", c, b)
	}
	_, b := pedir(t, adm, "GET", e.u+"proveedores/"+e.proveedor+"/facturas-con-saldo", nil)
	var fs []FacturaConSaldo
	_ = json.Unmarshal([]byte(b), &fs)
	if len(fs) != 1 || fs[0].Tipo != "ajuste" || fs[0].Numero != "Ajuste SIM-SALDO-INI" || fs[0].Saldo != 150000 {
		t.Fatalf("el ajuste por pagar: %s", b)
	}
	c, b := pedir(t, adm, "POST", e.u+"compras/pagos", map[string]any{"supplierId": e.proveedor, "total": 150000, "medio": "transferencia",
		"retenciones": []any{}, "ajustes": []any{map[string]any{"movimientoId": fs[0].ID, "importe": 150000}}})
	if c != 200 {
		t.Fatalf("pago: %d %s", c, b)
	}
	pago := idDe(t, b)
	if _, b := pedir(t, adm, "GET", e.u+"proveedores/"+e.proveedor+"/facturas-con-saldo", nil); b != "[]\n" {
		t.Errorf("el ajuste sigue por pagar: %s", b)
	}
	ficha, _ := e.ficha(t, pago)
	if len(ficha.Facturas) != 1 || ficha.Facturas[0].Numero != "Ajuste SIM-SALDO-INI" || ficha.Facturas[0].Aplicado != 150000 {
		t.Errorf("el pago no dice qué canceló: %+v", ficha.Facturas)
	}
	if c, b := pedir(t, adm, "POST", e.u+"compras/pagos/"+pago+"/anular", map[string]string{"motivo": "Prueba"}); c != 200 {
		t.Fatalf("anular: %d %s", c, b)
	}
	ficha, _ = e.ficha(t, pago)
	if len(ficha.Facturas) != 1 || ficha.Facturas[0].Aplicado != 150000 {
		t.Errorf("el pago anulado perdió lo que cubría: %+v", ficha.Facturas)
	}
	if _, b := pedir(t, adm, "GET", e.u+"proveedores/"+e.proveedor+"/facturas-con-saldo", nil); !strings.Contains(b, `"saldo":150000`) {
		t.Errorf("anulado, el ajuste vuelve a deberse: %s", b)
	}
}

func (e *entorno) ficha(t *testing.T, pago string) (FichaDePago, string) {
	t.Helper()
	adm := e.staff(t, "otro-"+pago[:8]+"@prueba.test", "admin")
	_, b := pedir(t, adm, "GET", e.u+"compras/pagos/"+pago, nil)
	var f FichaDePago
	_ = json.Unmarshal([]byte(b), &f)
	return f, b
}

// M3S2-028: un ajuste que baja la deuda se aplica a la factura: queda
// pagada y no figura «por pagar» con la cuenta en cero.
func TestAjusteAplicadoAUnaFactura(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	fc := e.facturaDeCompra(t, adm, 7710, nil)
	if c, b := pedir(t, adm, "POST", e.u+"proveedores/"+e.proveedor+"/movimientos", map[string]any{"supplierId": e.proveedor, "tipo": "ajuste",
		"sentido": "baja", "monto": 200000, "detalle": "Bonificación 3 %", "aplicaA": fc}); c != 422 || !strings.Contains(b, "le quedan") {
		t.Errorf("un ajuste mayor que la factura: %d %s", c, b)
	}
	if c, b := pedir(t, adm, "POST", e.u+"proveedores/"+e.proveedor+"/movimientos", map[string]any{"supplierId": e.proveedor, "tipo": "ajuste",
		"sentido": "baja", "monto": 3630, "detalle": "Bonificación 3 %", "aplicaA": fc}); c != 200 {
		t.Fatalf("ajuste: %d %s", c, b)
	}
	_, b := pedir(t, adm, "GET", e.u+"proveedores/"+e.proveedor+"/facturas-con-saldo", nil)
	if !strings.Contains(b, `"saldo":117370`) {
		t.Errorf("la factura tiene que quedar con 121.000 − 3.630: %s", b)
	}
}

// M2S2-012, M2S3-001, M2S3-004: un certificado de las 22:42 del 26/11 (hora
// argentina, 01:42Z del 27) sale con fecha 26/11 en el CSV, y uno del 30 a
// la noche queda en noviembre.
func TestCsvDeRetencionesEnHoraArgentina(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	ctx := context.Background()
	gan := e.regimen(t, "78", "ganancias", 2)
	var pago string
	_ = e.pool.QueryRow(ctx, `insert into supplier_payments (supplier_id, fecha, total, neto, medio) values ($1, '2026-11-27T01:42:00Z', 1000, 980, 'transferencia') returning id`, e.proveedor).Scan(&pago)
	for _, x := range []struct{ numero, fecha string }{{"GAN-2026-000004", "2026-11-27T01:42:00Z"}, {"GAN-2026-000009", "2026-12-01T01:30:00Z"}} {
		if _, err := e.pool.Exec(ctx, `insert into retenciones_practicadas (payment_id, supplier_id, regimen_id, numero, codigo_regimen, impuesto, base, alicuota, importe, fecha)
			values ($1, $2, $3, $4, '78', 'ganancias', 1000, 2, 20, $5)`, pago, e.proveedor, gan, x.numero, x.fecha); err != nil {
			t.Fatal(err)
		}
	}
	_, b := pedir(t, adm, "GET", e.u+"compras/pagos/retenciones-csv?periodo=2026-11", nil)
	if !strings.Contains(b, `26/11/2026;"GAN-2026-000004"`) || !strings.Contains(b, `30/11/2026;"GAN-2026-000009"`) {
		t.Errorf("csv: %s", b)
	}
	if _, b := pedir(t, adm, "GET", e.u+"compras/pagos/retenciones-csv?periodo=2026-12", nil); strings.Contains(b, "GAN-2026-000009") {
		t.Errorf("el del 30 a la noche cayó en diciembre: %s", b)
	}
	// El TXT de SICORE, solo con la regla prendida.
	if c, b := pedir(t, adm, "GET", e.u+"compras/pagos/retenciones-csv?periodo=2026-11&formato=sicore", nil); c != 422 {
		t.Errorf("sicore sin la regla: %d %s", c, b)
	}
	_, _ = e.pool.Exec(ctx, `insert into site_settings (clave, valor) values ('exportar_sicore', 'si') on conflict (clave) do update set valor = 'si'`)
	_, _ = e.pool.Exec(ctx, `update suppliers set cuit = '30-71234567-9', condicion_ganancias = 'inscripto' where id = $1`, e.proveedor)
	c, b := pedir(t, adm, "GET", e.u+"compras/pagos/retenciones-csv?periodo=2026-11&formato=sicore", nil)
	lineas := strings.Split(strings.TrimSuffix(b, "\r\n"), "\r\n")
	if c != 200 || len(lineas) != 2 || !strings.HasPrefix(lineas[0], "0626/11/20260000002026000004") || len(lineas[0]) != 144 ||
		!strings.Contains(lineas[0], "2170781") || !strings.Contains(lineas[0], "8030712345679") {
		t.Errorf("sicore: %d %q", c, b)
	}
}

// M3S2-027: la regla base_retencion_iva. En «neto» (la de arranque) la base
// de IVA sin retener es el neto; en «total», lo pagado con IVA.
func TestReglaDeLaBaseDeIva(t *testing.T) {
	for _, caso := range []struct {
		regla string
		base  float64
	}{{"neto", 100000}, {"total", 121000}} {
		t.Run(caso.regla, func(t *testing.T) {
			e := armar(t)
			adm := e.staff(t, "admin@prueba.test", "admin")
			ctx := context.Background()
			iva := e.regimen(t, "IVA-B", "iva", 8.68)
			_, _ = e.pool.Exec(ctx, `update suppliers set cuit = '30712345679', condicion_iva = 'responsable_inscripto' where id = $1`, e.proveedor)
			_, _ = e.pool.Exec(ctx, `insert into site_settings (clave, valor) values ('base_retencion_iva', $1) on conflict (clave) do update set valor = $1`, caso.regla)
			f1, f2 := e.facturaDeCompra(t, adm, 1, nil), e.facturaDeCompra(t, adm, 2, nil)
			if c, b := pedir(t, adm, "POST", e.u+"compras/pagos", map[string]any{"supplierId": e.proveedor, "total": 121000, "medio": "transferencia",
				"retenciones":  []any{map[string]any{"regimenId": iva, "base": 1}},
				"imputaciones": []any{map[string]any{"purchaseInvoiceId": f1, "importe": 121000}}}); c != 200 {
				t.Fatalf("primero: %d %s", c, b)
			}
			if c, b := pedir(t, adm, "POST", e.u+"compras/pagos", map[string]any{"supplierId": e.proveedor, "total": 121000, "medio": "transferencia",
				"retenciones":  []any{},
				"imputaciones": []any{map[string]any{"purchaseInvoiceId": f2, "importe": 121000}}}); c != 200 {
				t.Fatalf("segundo: %d %s", c, b)
			}
			if n := e.numero(t, `select b.base::float8 from bases_de_retencion b join supplier_payments p on p.id = b.payment_id
				join supplier_payment_allocations a on a.payment_id = p.id where a.purchase_invoice_id = $1`, f2); n != caso.base {
				t.Errorf("base de IVA con la regla %s: %v", caso.regla, n)
			}
		})
	}
}

// M3S3-008: un segundo proveedor con el mismo CUIT (con o sin guiones) no
// se da de alta.
func TestProveedorConUnCuitQueYaExiste(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	c, b := pedir(t, adm, "POST", e.u+"proveedores", map[string]any{"nombre": "Maderas del Sur bis", "cuit": "30123456789",
		"condicionIva": "responsable_inscripto", "diasPago": 30})
	if c != 422 || !strings.Contains(b, "Ya existe Maderas del Sur con ese CUIT.") {
		t.Errorf("alta duplicada: %d %s", c, b)
	}
	// Editar el mismo proveedor con su CUIT sí.
	if c, b := pedir(t, adm, "POST", e.u+"proveedores", map[string]any{"id": e.proveedor, "nombre": "Maderas del Sur", "cuit": "30-12345678-9",
		"condicionIva": "responsable_inscripto", "diasPago": 30}); c != 200 {
		t.Errorf("editar el propio: %d %s", c, b)
	}
}

// M3S4-022: la bitácora dice qué condición se borró.
func TestBorrarCondicionDiceCual(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	ctx := context.Background()
	var id string
	if err := e.pool.QueryRow(ctx, `insert into supplier_terms (supplier_id, modalidad, plazo_dias, bonificacion_pct) values ($1, 'cheque', 60, 3) returning id`,
		e.proveedor).Scan(&id); err != nil {
		t.Fatal(err)
	}
	if c, b := pedir(t, adm, "DELETE", e.u+"proveedores/"+e.proveedor+"/condiciones/"+id, nil); c >= 300 {
		t.Fatalf("borrar: %d %s", c, b)
	}
	if n := e.numero(t, `select count(*)::float8 from audit_log where descripcion = 'Borró la condición de pago «cheque a 60 días · 3 % de bonificación»'`); n != 1 {
		t.Errorf("la bitácora no dice cuál")
	}
}

// M2S3-013, M2S1-138, M2S1-035, M3S4-020: una orden de la que llegó una
// parte no se anula, se cierra con faltante; la ficha lista sus remitos y
// el costo con que llegó, y la fecha se corrige estando enviada.
func TestOrdenCerradaConFaltante(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	linea := map[string]any{"variantId": e.placa, "descripcion": "Fenólico 18 mm", "cantidad": 28, "costoUnitario": 40400, "alicuotaIva": 21}
	_, b := pedir(t, adm, "POST", e.u+"compras/ordenes", map[string]any{"supplierId": e.proveedor, "branchId": e.central, "lineas": []any{linea}})
	orden := idDe(t, b)
	pedir(t, adm, "POST", e.u+"compras/ordenes/"+orden+"/enviada", nil)
	if c, b := pedir(t, adm, "POST", e.u+"compras/ordenes/"+orden+"/fecha", map[string]string{"fechaPrometida": "2099-12-20"}); c != 200 {
		t.Fatalf("fecha estando enviada: %d %s", c, b)
	}
	_, b = pedir(t, adm, "POST", e.u+"compras/ordenes/"+orden+"/recibir", map[string]string{"numeroRemito": "0003-00022510"})
	rec := idDe(t, b)
	ctx := context.Background()
	if _, err := e.pool.Exec(ctx, `update goods_receipt_items set cantidad = 26, costo_unitario = 41500 where receipt_id = $1`, rec); err != nil {
		t.Fatal(err)
	}
	if c, b := pedir(t, adm, "POST", e.u+"recepciones/"+rec+"/confirmar", nil); c != 200 {
		t.Fatalf("confirmar: %d %s", c, b)
	}
	if c, b := pedir(t, adm, "POST", e.u+"compras/ordenes/"+orden+"/anular", map[string]string{"motivo": "no tienen más"}); c != 422 || !strings.Contains(b, "cerrala con faltante") {
		t.Errorf("anular con mercadería recibida: %d %s", c, b)
	}
	if c, b := pedir(t, adm, "POST", e.u+"compras/ordenes/"+orden+"/cerrar", map[string]string{"motivo": "no tienen más"}); c != 200 {
		t.Fatalf("cerrar: %d %s", c, b)
	}
	_, b = pedir(t, adm, "GET", e.u+"compras/ordenes/"+orden, nil)
	var o Orden
	_ = json.Unmarshal([]byte(b), &o)
	if o.Estado != "completa" || len(o.Recepciones) != 1 || o.Items[0].CostoRecibido == nil || jsmathNum(*o.Items[0].CostoRecibido) != 41500 {
		t.Errorf("la orden cerrada: %s", b)
	}
	if o.FechaPrometida == nil || o.FechaPrometida.UTC().Format("2006-01-02") != "2099-12-20" {
		t.Errorf("fecha: %v", o.FechaPrometida)
	}
	_, b = pedir(t, adm, "GET", e.u+"compras/ordenes", nil)
	if !strings.Contains(b, `"recibido":1050400`) {
		t.Errorf("el listado no dice lo que llegó: %s", b)
	}
}

func jsmathNum(s string) float64 { return jsmath.Numero(s) }
