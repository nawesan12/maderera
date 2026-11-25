package facturacion

import (
	"archive/zip"
	"strconv"
	"bytes"
	"context"
	"io"
	"strings"
	"testing"

	"mjbj/internal/fiscal"
	"mjbj/internal/sqlc"
)

// El Libro IVA Digital de un mes: una factura A con dos alícuotas (los
// renglones de VENTAS_ALICUOTAS salen de los ítems, como el AlicIva que fue
// a ARCA), una compra A y un tique de compra que no tiene código y va a
// OMITIDOS.txt. Solo el admin lo baja.
func TestLibroIvaDigitalDelMes(t *testing.T) {
	e := armar(t, false)
	ctx := context.Background()
	id, err := e.s.EmitirComprobante(ctx, DatosEmision{ReceptorNombre: "Carpintería Muñoz", ReceptorCuit: ptr("30712345671"),
		ReceptorCondicionIva: "responsable_inscripto", Lineas: []Linea{
			{LineaEntrada: fiscal.LineaEntrada{Descripcion: "Placa", Cantidad: 1, PrecioFinalUnitario: 1210, Alicuota: ptr(21.0)}},
			{LineaEntrada: fiscal.LineaEntrada{Descripcion: "Leña", Cantidad: 1, PrecioFinalUnitario: 110.5, Alicuota: ptr(10.5)}},
			{LineaEntrada: fiscal.LineaEntrada{Descripcion: "Otra placa", Cantidad: 1, PrecioFinalUnitario: 605, Alicuota: ptr(21.0)}},
		}})
	if err != nil {
		t.Fatal(err)
	}
	e.exec(t, `UPDATE invoices SET fecha_emision = '2026-10-20T15:00:00Z', cae = '70000000000001', estado = 'autorizada' WHERE id = $1`, id)
	var prov string
	e.uno(t, `INSERT INTO suppliers (nombre, cuit) VALUES ('Faplac', '30-50000000-7') RETURNING id`, &prov)
	e.exec(t, `INSERT INTO purchase_invoices (supplier_id, tipo, punto_venta, numero, fecha_emision, neto, iva21, total)
		VALUES ($1, 'factura_a', 2, 1274, '2026-10-05T12:00:00Z', 1000, 210, 1210),
		       ($1, 'ticket', 1, 55, '2026-10-06T12:00:00Z', 0, 0, 300)`, prov)

	vendedor := e.staff(t, "v@mjbj.test", sqlc.StaffRoleVendedor)
	ruta := e.srv.URL + "/api/v1/admin/facturacion/libro-iva/digital?periodo=2026-10"
	if st, _ := pedir(t, vendedor, "GET", ruta, nil); st != 403 {
		t.Fatalf("vendedor: %d", st)
	}
	admin := e.staff(t, "a@mjbj.test", sqlc.StaffRoleAdmin)
	st, b := pedir(t, admin, "GET", ruta, nil)
	if st != 200 {
		t.Fatalf("admin: %d %s", st, b)
	}
	z, err := zip.NewReader(bytes.NewReader(b), int64(len(b)))
	if err != nil {
		t.Fatal(err)
	}
	archivos := map[string]string{}
	for _, f := range z.File {
		r, _ := f.Open()
		x, _ := io.ReadAll(r)
		archivos[f.Name] = string(x)
	}
	vc := archivos["VENTAS_CBTE_202610.txt"]
	if len(vc) != fiscal.LargoVentasCbte+2 || vc[8:11] != "001" || vc[241:243] != "20" {
		t.Fatalf("VENTAS_CBTE: %q", vc)
	}
	va := strings.Split(strings.TrimSuffix(archivos["VENTAS_ALICUOTAS_202610.txt"], "\r\n"), "\r\n")
	// 21 %: 1000 + 500 de neto y 210 + 105 de IVA; 10,5 %: 100 y 10,50.
	if len(va) != 2 || va[0][28:62] != "000000000150000"+"0005"+"000000000031500" || va[1][28:62] != "000000000010000"+"0004"+"000000000001050" {
		t.Fatalf("VENTAS_ALICUOTAS: %q", va)
	}
	cc := archivos["COMPRAS_CBTE_202610.txt"]
	if len(cc) != fiscal.LargoComprasCbte+2 || cc[16:36] != "00000000000000001274" || cc[239:254] != "000000000021000" {
		t.Fatalf("COMPRAS_CBTE: %q", cc)
	}
	if ca := archivos["COMPRAS_ALICUOTAS_202610.txt"]; len(ca) != fiscal.LargoComprasAlicuotas+2 {
		t.Fatalf("COMPRAS_ALICUOTAS: %q", ca)
	}
	if o := archivos["OMITIDOS.txt"]; !strings.Contains(o, "Faplac") || !strings.Contains(o, "300.00") {
		t.Fatalf("OMITIDOS: %q", o)
	}
}

// Una compra A con neto y sin ningún IVA: el neto va a «no integra el neto
// gravado» y el registro cierra contra el total (antes informaba la alícuota
// 0 % en cero y el neto no iba a ningún campo).
func TestCompraASinIvaCierraContraElTotal(t *testing.T) {
	e := armar(t, false)
	var prov string
	e.uno(t, `INSERT INTO suppliers (nombre, cuit) VALUES ('Fletes Sur', '30-50000000-7') RETURNING id`, &prov)
	e.exec(t, `INSERT INTO purchase_invoices (supplier_id, tipo, punto_venta, numero, fecha_emision, neto, iva21, total)
		VALUES ($1, 'factura_a', 3, 77, '2026-10-07T12:00:00Z', 2500, 0, 2500)`, prov)
	admin := e.staff(t, "a@mjbj.test", sqlc.StaffRoleAdmin)
	st, b := pedir(t, admin, "GET", e.srv.URL+"/api/v1/admin/facturacion/libro-iva/digital?periodo=2026-10", nil)
	if st != 200 {
		t.Fatalf("admin: %d %s", st, b)
	}
	z, err := zip.NewReader(bytes.NewReader(b), int64(len(b)))
	if err != nil {
		t.Fatal(err)
	}
	archivos := map[string]string{}
	for _, f := range z.File {
		r, _ := f.Open()
		x, _ := io.ReadAll(r)
		archivos[f.Name] = string(x)
	}
	importe := func(s string) int64 {
		n, err := strconv.ParseInt(s, 10, 64)
		if err != nil {
			t.Fatalf("importe %q", s)
		}
		return n
	}
	cc := strings.TrimSuffix(archivos["COMPRAS_CBTE_202610.txt"], "\r\n")
	if len(cc) != fiscal.LargoComprasCbte {
		t.Fatalf("COMPRAS_CBTE: %q", cc)
	}
	total := importe(cc[104:119])
	// Del campo 10 (no gravado) al 16 (internos), más otros tributos (22).
	suma := importe(cc[254:269])
	for i := 119; i < 224; i += 15 {
		suma += importe(cc[i : i+15])
	}
	if importe(cc[119:134]) != 250000 || cc[238] != 'N' {
		t.Fatalf("el neto no está en no gravado (o la operación no es N): %q", cc)
	}
	for _, a := range strings.Split(strings.TrimSuffix(archivos["COMPRAS_ALICUOTAS_202610.txt"], "\r\n"), "\r\n") {
		if a == "" {
			continue
		}
		// La base y el IVA de cada alícuota (después del documento del vendedor).
		suma += importe(a[50:65]) + importe(a[69:84])
	}
	if total != 250000 || suma != total {
		t.Fatalf("no cierra: total %d, suma de campos %d", total, suma)
	}
}
