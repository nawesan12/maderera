package compras

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// La base de una retención es parte del pago: con el botón «Todo» se cargaba
// el total con IVA de las facturas, y una base mayor que el pago retenía de
// más. Ahora se rechaza; y las facturas con saldo traen su neto sin IVA para
// que la pantalla proponga la base.
func TestLaBaseDeLaRetencionNoPasaElPago(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	iibb := e.regimen(t, "IIBB-MI", "iibb", 1.5)
	c, b := pedir(t, adm, "POST", e.u+"compras/facturas", map[string]any{"supplierId": e.proveedor, "tipo": "factura_a", "puntoVenta": 3, "numero": 7,
		"fechaEmision": "2026-10-01", "neto": 1000, "iva21": 210, "iva105": 0, "iva27": 0, "exento": 50, "percepciones": 30})
	if c != 200 {
		t.Fatalf("factura: %d %s", c, b)
	}
	if _, b := pedir(t, adm, "GET", e.u+"proveedores/"+e.proveedor+"/facturas-con-saldo", nil); !strings.Contains(b, `"netoSinIva":1050`) {
		t.Errorf("el neto sin IVA (neto + exento, sin IVA ni percepciones): %s", b)
	}
	c, b = pedir(t, adm, "POST", e.u+"compras/pagos", map[string]any{"supplierId": e.proveedor, "total": 1000, "medio": "transferencia",
		"retenciones": []any{map[string]any{"regimenId": iibb, "base": 1210}}})
	if c != 422 || !strings.Contains(b, "no puede ser mayor al pago") {
		t.Errorf("base mayor al pago: %d %s", c, b)
	}
	if n := e.numero(t, `select count(*)::float8 from supplier_payments`); n != 0 {
		t.Errorf("no tiene que quedar el pago: %v", n)
	}
	// Igual al pago, sí.
	if c, b := pedir(t, adm, "POST", e.u+"compras/pagos", map[string]any{"supplierId": e.proveedor, "total": 1000, "medio": "transferencia",
		"retenciones": []any{map[string]any{"regimenId": iibb, "base": 1000}}}); c != 200 {
		t.Errorf("base igual al pago: %d %s", c, b)
	}
}

// El certificado y el CSV mostraban la base del pago, pero la retención sale
// del acumulado del mes menos el mínimo no imponible: con un mínimo de
// 224.000, el segundo pago de 200.000 retiene 3.520 (176.000 × 2 %), y
// «200.000 al 2 % = 3.520» no cierra. Ahora se guarda y se muestra el cálculo.
func TestElCertificadoMuestraElCalculo(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	ctx := context.Background()
	gan := e.regimen(t, "78", "ganancias", 2)
	if _, err := e.pool.Exec(ctx, `update regimenes_retencion set minimo_no_imponible = 224000, minimo_retencion = 0 where id = $1`, gan); err != nil {
		t.Fatal(err)
	}
	pago := map[string]any{"supplierId": e.proveedor, "total": 200000, "medio": "transferencia",
		"retenciones": []any{map[string]any{"regimenId": gan, "base": 200000}}}
	if c, b := pedir(t, adm, "POST", e.u+"compras/pagos", pago); c != 200 {
		t.Fatalf("primer pago: %d %s", c, b)
	}
	if c, b := pedir(t, adm, "POST", e.u+"compras/pagos", pago); c != 200 || !strings.Contains(b, `"importe":3520`) {
		t.Fatalf("segundo pago: %d %s", c, b)
	}
	numero := fmt.Sprintf("GAN-%d-000001", time.Now().In(argentina(t)).Year())
	_, b := pedir(t, adm, "GET", e.u+"compras/certificados/"+numero, nil)
	for _, quiero := range []string{`"base":"200000.00"`, `"acumulado":"400000.00"`, `"imponible":"176000.00"`, `"retenidoAntes":"0.00"`, `"importe":"3520.00"`} {
		if !strings.Contains(b, quiero) {
			t.Errorf("certificado sin %s: %s", quiero, b)
		}
	}
	c, csv := pedir(t, adm, "GET", e.u+"compras/pagos/retenciones-csv", nil)
	if c != 200 || !strings.Contains(csv, "Monto sujeto a retención") || !strings.Contains(csv, "200000,00;400000,00;176000,00;2,000;0,00;3520,00") {
		t.Errorf("csv: %d %s", c, csv)
	}
	// El PDF, con la cuenta a la vista.
	resp, err := adm.Get(e.u + "compras/certificados/" + numero + "/pdf")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 || resp.Header.Get("Content-Type") != "application/pdf" {
		t.Fatalf("pdf: %d %s", resp.StatusCode, resp.Header.Get("Content-Type"))
	}
	if _, err := exec.LookPath("pdftotext"); err != nil {
		t.Skip("sin pdftotext no se lee el PDF")
	}
	texto := textoDelPdf(t, resp)
	for _, quiero := range []string{"Acumulado del mes", "Monto sujeto a retención", "Menos mínimo no imponible", "224.000,00", "176.000,00", "3.520,00"} {
		if !strings.Contains(texto, quiero) {
			t.Errorf("el PDF no dice %q:\n%s", quiero, texto)
		}
	}
}

func argentina(t *testing.T) *time.Location {
	l, err := time.LoadLocation("America/Argentina/Buenos_Aires")
	if err != nil {
		t.Fatal(err)
	}
	return l
}

func textoDelPdf(t *testing.T, resp *http.Response) string {
	t.Helper()
	dir := t.TempDir()
	archivo := filepath.Join(dir, "c.pdf")
	f, err := os.Create(archivo)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.ReadFrom(resp.Body); err != nil {
		t.Fatal(err)
	}
	f.Close()
	out, err := exec.Command("pdftotext", "-layout", archivo, "-").Output()
	if err != nil {
		t.Fatal(err)
	}
	return string(out)
}

// Los mínimos del régimen solo se cambiaban con SQL; la pantalla mandaba
// alícuotas y «activo». Ahora también los mínimos; si no vienen, quedan.
func TestLosMinimosDelRegimenSeEditan(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	gan := e.regimen(t, "78", "ganancias", 2)
	minimos := func() string {
		var mni, mr string
		if err := e.pool.QueryRow(context.Background(), `select minimo_no_imponible::text, minimo_retencion::text from regimenes_retencion where id = $1`, gan).
			Scan(&mni, &mr); err != nil {
			t.Fatal(err)
		}
		return mni + " " + mr
	}
	c, b := pedir(t, adm, "POST", e.u+"compras/regimenes", map[string]string{"id": gan, "alicuota": "2", "alicuotaNoInscripto": "28", "activo": "on",
		"minimoNoImponible": "224000", "minimoRetencion": "240"})
	if c != 200 || minimos() != "224000.00 240.00" {
		t.Fatalf("guardar mínimos: %d %s → %s", c, b, minimos())
	}
	// El formulario de antes (sin mínimos) no los pisa.
	if c, b := pedir(t, adm, "POST", e.u+"compras/regimenes", map[string]string{"id": gan, "alicuota": "3", "alicuotaNoInscripto": "28", "activo": "on"}); c != 200 ||
		minimos() != "224000.00 240.00" {
		t.Errorf("sin mínimos: %d %s → %s", c, b, minimos())
	}
	if c, b := pedir(t, adm, "POST", e.u+"compras/regimenes", map[string]string{"id": gan, "alicuota": "2", "alicuotaNoInscripto": "28",
		"minimoNoImponible": "-1"}); c != 422 || !strings.Contains(b, "mínimos en pesos") {
		t.Errorf("mínimo negativo: %d %s", c, b)
	}
	if minimos() != "224000.00 240.00" {
		t.Errorf("el rechazado no cambia nada: %s", minimos())
	}
}

// Anular un pago a proveedor no existía: un pago cargado por error quedaba
// para siempre, con su certificado contando en el acumulado del mes.
func TestAnularUnPagoAProveedor(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	ctx := context.Background()
	iibb := e.regimen(t, "IIBB-MI", "iibb", 1.5)
	c, b := pedir(t, adm, "POST", e.u+"compras/facturas", map[string]any{"supplierId": e.proveedor, "tipo": "factura_a", "puntoVenta": 3, "numero": 1274,
		"fechaEmision": "2026-10-01", "neto": 826.45, "iva21": 173.55, "iva105": 0, "iva27": 0, "exento": 0, "percepciones": 0})
	if c != 200 {
		t.Fatalf("factura: %d %s", c, b)
	}
	factura := idDe(t, b)
	var tercero string
	_ = e.pool.QueryRow(ctx, `insert into cheques (sentido, tipo, numero, fecha_pago, importe, estado) values ('recibido', 'fisico', '12345678', now(), 500, 'cartera') returning id`).Scan(&tercero)
	// $1000: se retienen $15; salen un endoso de $500 y un cheque propio de $485.
	c, b = pedir(t, adm, "POST", e.u+"compras/pagos", map[string]any{"supplierId": e.proveedor, "total": 1000, "medio": "cheque", "referencia": "OP-1",
		"retenciones":  []any{map[string]any{"regimenId": iibb, "base": 826.45}},
		"imputaciones": []any{map[string]any{"purchaseInvoiceId": factura, "importe": 1000}},
		"partes": []any{map[string]any{"medio": "cheque", "importe": 500, "chequeId": tercero},
			map[string]any{"medio": "cheque", "importe": 987.6, "cheque": map[string]any{"tipo": "fisico", "numero": "00012345", "fechaPago": "2026-11-15T12:00:00.000Z"}}}})
	if c != 422 {
		t.Fatalf("las partes no suman: %d %s", c, b)
	}
	c, b = pedir(t, adm, "POST", e.u+"compras/pagos", map[string]any{"supplierId": e.proveedor, "total": 1000, "medio": "cheque", "referencia": "OP-1",
		"retenciones":  []any{map[string]any{"regimenId": iibb, "base": 826.45}},
		"imputaciones": []any{map[string]any{"purchaseInvoiceId": factura, "importe": 1000}},
		"partes": []any{map[string]any{"medio": "cheque", "importe": 500, "chequeId": tercero},
			map[string]any{"medio": "cheque", "importe": 487.6, "cheque": map[string]any{"tipo": "fisico", "numero": "00012345", "fechaPago": "2026-11-15T12:00:00.000Z"}}}})
	if c != 200 {
		t.Fatalf("pago: %d %s", c, b)
	}
	var pago, propio string
	_ = e.pool.QueryRow(ctx, `select id from supplier_payments`).Scan(&pago)
	_ = e.pool.QueryRow(ctx, `select id from cheques where sentido = 'entregado'`).Scan(&propio)
	if s := e.saldo(t); s != 0 {
		t.Fatalf("antes de anular: %v", s)
	}

	if c, _ := pedir(t, ven, "POST", e.u+"compras/pagos/"+pago+"/anular", map[string]string{"motivo": "error"}); c != 403 {
		t.Errorf("el vendedor no anula: %d", c)
	}
	if c, b := pedir(t, adm, "POST", e.u+"compras/pagos/"+pago+"/anular", map[string]string{"motivo": "  "}); c != 422 || !strings.Contains(b, "Poné el motivo") {
		t.Errorf("sin motivo: %d %s", c, b)
	}
	c, b = pedir(t, adm, "POST", e.u+"compras/pagos/"+pago+"/anular", map[string]string{"motivo": "Se cargó dos veces"})
	if c != 200 || !strings.Contains(b, "Pago anulado") {
		t.Fatalf("anular: %d %s", c, b)
	}
	if s := e.saldo(t); s != 1000 {
		t.Errorf("la deuda vuelve entera (retención incluida): %v", s)
	}
	if _, b := pedir(t, adm, "GET", e.u+"proveedores/"+e.proveedor+"/facturas-con-saldo", nil); !strings.Contains(b, `"saldo":1000`) {
		t.Errorf("la factura vuelve a tener saldo: %s", b)
	}
	estado := func(id string) string {
		var s string
		_ = e.pool.QueryRow(ctx, `select estado::text from cheques where id = $1`, id).Scan(&s)
		return s
	}
	if estado(tercero) != "cartera" || estado(propio) != "anulado" {
		t.Errorf("cheques: el endosado %s (cartera), el propio %s (anulado)", estado(tercero), estado(propio))
	}
	if n := e.numero(t, `select count(*)::float8 from retenciones_practicadas where anulada_at is null`); n != 0 {
		t.Errorf("certificados vivos: %v", n)
	}
	if n := e.numero(t, `select count(*)::float8 from bases_de_retencion`); n != 0 {
		t.Errorf("bases del pago anulado: %v", n)
	}
	if _, b := pedir(t, adm, "GET", e.u+"proveedores/"+e.proveedor+"/acumulado-del-mes", nil); b != "[]\n" {
		t.Errorf("el acumulado no cuenta el pago anulado: %q", b)
	}
	numero := fmt.Sprintf("IIB-%d-000001", time.Now().In(argentina(t)).Year())
	if _, csv := pedir(t, adm, "GET", e.u+"compras/pagos/retenciones-csv", nil); strings.Contains(csv, numero) {
		t.Errorf("el CSV no lleva el anulado: %s", csv)
	}
	if _, b := pedir(t, adm, "GET", e.u+"compras/certificados/"+numero, nil); !strings.Contains(b, `"anuladaAt":"`) {
		t.Errorf("el certificado dice que está anulado: %s", b)
	}
	if _, b := pedir(t, adm, "GET", e.u+"compras/pagos", nil); !strings.Contains(b, `"motivoAnulacion":"Se cargó dos veces"`) {
		t.Errorf("listado: %s", b)
	}
	if n := e.numero(t, `select count(*)::float8 from audit_log where accion = 'anular' and entidad = 'pago_proveedor'`); n != 1 {
		t.Errorf("bitácora: %v", n)
	}
	if c, b := pedir(t, adm, "POST", e.u+"compras/pagos/"+pago+"/anular", map[string]string{"motivo": "otra vez"}); c != 422 || !strings.Contains(b, "ya estaba anulado") {
		t.Errorf("dos veces: %d %s", c, b)
	}
	// El número del certificado anulado no se reusa.
	c, b = pedir(t, adm, "POST", e.u+"compras/pagos", map[string]any{"supplierId": e.proveedor, "total": 1000, "medio": "transferencia",
		"retenciones": []any{map[string]any{"regimenId": iibb, "base": 826.45}}})
	if c != 200 || !strings.Contains(b, fmt.Sprintf("IIB-%d-000002", time.Now().In(argentina(t)).Year())) {
		t.Errorf("número nuevo: %d %s", c, b)
	}
}

// Un cheque que el proveedor ya cobró (o que rebotó) no se puede deshacer:
// el pago no se anula y no se toca nada.
func TestNoSeAnulaUnPagoConElChequeCobrado(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	ctx := context.Background()
	for _, caso := range []struct{ estado, mensaje string }{{"acreditado", "ya lo cobró el proveedor"}, {"rechazado", "lo rechazó el banco"}} {
		c, b := pedir(t, adm, "POST", e.u+"compras/pagos", map[string]any{"supplierId": e.proveedor, "total": 100, "medio": "cheque", "retenciones": []any{},
			"partes": []any{map[string]any{"medio": "cheque", "importe": 100, "cheque": map[string]any{"tipo": "fisico", "numero": "00090001", "fechaPago": "2026-11-15T12:00:00.000Z"}}}})
		if c != 200 {
			t.Fatalf("pago: %d %s", c, b)
		}
		var pago string
		_ = e.pool.QueryRow(ctx, `select id from supplier_payments where anulado_at is null order by created_at desc limit 1`).Scan(&pago)
		if _, err := e.pool.Exec(ctx, `update cheques set estado = $1::estado_cheque where id = (select cheque_id from supplier_payment_parts where payment_id = $2)`,
			caso.estado, pago); err != nil {
			t.Fatal(err)
		}
		antes := e.saldo(t)
		if c, b := pedir(t, adm, "POST", e.u+"compras/pagos/"+pago+"/anular", map[string]string{"motivo": "error"}); c != 422 || !strings.Contains(b, caso.mensaje) {
			t.Errorf("%s: %d %s", caso.estado, c, b)
		}
		if e.saldo(t) != antes || e.numero(t, `select count(*)::float8 from supplier_payments where anulado_at is not null`) != 0 {
			t.Errorf("%s: no tenía que tocar nada", caso.estado)
		}
	}
}
