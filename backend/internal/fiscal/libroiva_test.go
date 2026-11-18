package fiscal

import (
	"archive/zip"
	"bytes"
	"io"
	"strings"
	"testing"
	"time"
)

func cuit(s string) *string { return &s }

// Una factura A con dos alícuotas (21 % y 10,5 %), una B a consumidor final
// y una nota de crédito A; en compras, una A con dos alícuotas y percepciones
// y una C. Cada renglón tiene el largo exacto del diseño y los campos caen
// en su posición.
func TestLibroIvaDigitalLargosYAlicuotas(t *testing.T) {
	// 31/10 a las 22 en Argentina: el comprobante es del 31.
	fecha := time.Date(2026, 11, 1, 1, 0, 0, 0, time.UTC)
	facturaA := ComprobanteDelLibro{
		Fecha: fecha, Codigo: CodigoComprobante["factura_a"], PuntoVenta: 3, Numero: 127,
		Documento: cuit("30-71234567-1"), Nombre: "Carpintería Muñoz S.R.L. — con un nombre largo de más",
		Total: 1331.5, Discrimina: true, PercepcionIibb: 10,
		Alicuotas: []IvaDeAlicuota{{Alicuota: 21, Base: 1000, Importe: 210}, {Alicuota: 10.5, Base: 100, Importe: 10.5}},
	}
	facturaB := ComprobanteDelLibro{
		Fecha: fecha, Codigo: CodigoComprobante["factura_b"], PuntoVenta: 3, Numero: 9,
		Nombre: "Consumidor final", Total: 1210, Discrimina: true,
		Alicuotas: []IvaDeAlicuota{{Alicuota: 21, Base: 1000, Importe: 210}},
	}
	notaA := ComprobanteDelLibro{
		Fecha: fecha, Codigo: CodigoComprobante["nota_credito_a"], PuntoVenta: 3, Numero: 4,
		Documento: cuit("30712345671"), Nombre: "Carpintería Muñoz", Total: 500, Exento: 500, Discrimina: true,
	}
	compraA := ComprobanteDelLibro{
		Fecha: fecha, Codigo: CodigoComprobanteCompra["factura_a"], PuntoVenta: 2, Numero: 1274,
		Documento: cuit("30-50000000-7"), Nombre: "Faplac", Total: 1375.5, Discrimina: true,
		PercepcionIva: 30, PercepcionIibb: 25, CreditoFiscal: 220.5,
		Alicuotas: NetosDeCompra(1100, 210, 10.5, 0),
	}
	compraC := ComprobanteDelLibro{
		Fecha: fecha, Codigo: CodigoComprobanteCompra["factura_c"], PuntoVenta: 1, Numero: 33,
		Documento: cuit("20-12345678-9"), Nombre: "Fletes Pérez", Total: 8000,
	}
	a := EscribirLibroIva([]ComprobanteDelLibro{facturaA, facturaB, notaA}, []ComprobanteDelLibro{compraA, compraC})

	renglones := func(nombre, archivo string, largo, cuantos int) []string {
		t.Helper()
		if !strings.HasSuffix(archivo, "\r\n") {
			t.Fatalf("%s no termina en CRLF", nombre)
		}
		ls := strings.Split(strings.TrimSuffix(archivo, "\r\n"), "\r\n")
		if len(ls) != cuantos {
			t.Fatalf("%s: %d renglones, quería %d\n%s", nombre, len(ls), cuantos, archivo)
		}
		for i, l := range ls {
			if len(l) != largo {
				t.Fatalf("%s renglón %d: %d posiciones, quería %d\n%q", nombre, i+1, len(l), largo, l)
			}
		}
		return ls
	}
	vc := renglones("VENTAS_CBTE", a.VentasCbte, LargoVentasCbte, 3)
	va := renglones("VENTAS_ALICUOTAS", a.VentasAlicuotas, LargoVentasAlicuotas, 4)
	cc := renglones("COMPRAS_CBTE", a.ComprasCbte, LargoComprasCbte, 2)
	ca := renglones("COMPRAS_ALICUOTAS", a.ComprasAlicuotas, LargoComprasAlicuotas, 2)

	// campo corta por posición (de 1, como el diseño de registro).
	campo := func(l string, desde, largo int) string { return l[desde-1 : desde-1+largo] }
	igual := func(donde, obtenido, esperado string) {
		t.Helper()
		if obtenido != esperado {
			t.Errorf("%s: %q, quería %q", donde, obtenido, esperado)
		}
	}

	// VENTAS_CBTE de la factura A.
	f := vc[0]
	igual("fecha", campo(f, 1, 8), "20261031")
	igual("tipo", campo(f, 9, 3), "001")
	igual("punto de venta", campo(f, 12, 5), "00003")
	igual("número", campo(f, 17, 20), "00000000000000000127")
	igual("número hasta", campo(f, 37, 20), "00000000000000000127")
	igual("tipo de documento", campo(f, 57, 2), "80")
	igual("documento", campo(f, 59, 20), "00000000030712345671")
	igual("nombre", campo(f, 79, 30), "Carpinteria Munoz S.R.L.   con")
	igual("total", campo(f, 109, 15), "000000000133150")
	igual("Ingresos Brutos", campo(f, 184, 15), "000000000001000")
	igual("moneda", campo(f, 229, 3), "PES")
	igual("tipo de cambio", campo(f, 232, 10), "0001000000")
	igual("cantidad de alícuotas", campo(f, 242, 1), "2")
	igual("código de operación", campo(f, 243, 1), "0")
	igual("vencimiento", campo(f, 259, 8), "00000000")

	// La B a consumidor final: documento 99 y número en cero.
	igual("B tipo", campo(vc[1], 9, 3), "006")
	igual("B documento", campo(vc[1], 57, 22), "99"+strings.Repeat("0", 20))
	// La nota de crédito exenta: positiva, una alícuota de 0 % y código E.
	igual("NC tipo", campo(vc[2], 9, 3), "003")
	igual("NC total", campo(vc[2], 109, 15), "000000000050000")
	igual("NC exento", campo(vc[2], 154, 15), "000000000050000")
	igual("NC alícuotas", campo(vc[2], 242, 2), "1E")

	// VENTAS_ALICUOTAS: las dos de la A, la de la B y la de 0 % de la nota.
	igual("A 21", va[0], "001"+"00003"+"00000000000000000127"+"000000000100000"+"0005"+"000000000021000")
	igual("A 10,5", va[1], "001"+"00003"+"00000000000000000127"+"000000000010000"+"0004"+"000000000001050")
	igual("B 21", campo(va[2], 1, 3)+campo(va[2], 44, 4), "0060005")
	igual("NC 0", campo(va[3], 1, 3)+campo(va[3], 29, 34), "003"+strings.Repeat("0", 15)+"0003"+strings.Repeat("0", 15))

	// COMPRAS_CBTE de la A.
	c := cc[0]
	igual("compra fecha", campo(c, 1, 8), "20261031")
	igual("compra tipo", campo(c, 9, 3), "001")
	igual("compra número", campo(c, 17, 20), "00000000000000001274")
	igual("despacho", campo(c, 37, 16), strings.Repeat(" ", 16))
	igual("vendedor", campo(c, 53, 22), "80"+"00000000030500000007")
	igual("compra total", campo(c, 105, 15), "000000000137550")
	igual("percepción IVA", campo(c, 150, 15), "000000000003000")
	igual("percepción IIBB", campo(c, 180, 15), "000000000002500")
	igual("compra moneda", campo(c, 225, 3), "PES")
	igual("compra alícuotas", campo(c, 238, 2), "20")
	igual("crédito fiscal", campo(c, 240, 15), "000000000022050")
	igual("corredor", campo(c, 270, 11), "00000000000")
	// La C no discrimina: sin alícuotas ni crédito.
	igual("C alícuotas", campo(cc[1], 238, 1), "0")
	igual("C crédito", campo(cc[1], 240, 15), strings.Repeat("0", 15))

	// COMPRAS_ALICUOTAS: el neto se reparte entre las dos y suma el cargado.
	igual("compra 21", ca[0], "001"+"00002"+"00000000000000001274"+"80"+"00000000030500000007"+"000000000100000"+"0005"+"000000000021000")
	igual("compra 10,5", campo(ca[1], 51, 34), "000000000010000"+"0004"+"000000000001050")
}

// Con varias alícuotas, la base de cada una sale del IVA y el redondeo queda
// en la de más IVA: las bases suman siempre el neto de la factura.
func TestNetosDeCompra(t *testing.T) {
	if n := NetosDeCompra(1000, 210, 0, 0); len(n) != 1 || n[0].Base != 1000 || n[0].Alicuota != 21 {
		t.Fatalf("una: %+v", n)
	}
	n := NetosDeCompra(1500.01, 210, 52.5, 0)
	if len(n) != 2 || n[1].Base != 500 || n[0].Base != 1000.01 {
		t.Fatalf("dos: %+v", n)
	}
	if NetosDeCompra(500, 0, 0, 0) != nil {
		t.Fatal("sin IVA no hay alícuotas")
	}
}

func TestZipDelLibro(t *testing.T) {
	b, err := ZipLibroIva("2026-10", ArchivosLibroIva{VentasCbte: "x\r\n"}, []string{"20261001 Ticket 0001-00000001 Corralón 100.00"})
	if err != nil {
		t.Fatal(err)
	}
	z, err := zip.NewReader(bytes.NewReader(b), int64(len(b)))
	if err != nil {
		t.Fatal(err)
	}
	var nombres []string
	for _, f := range z.File {
		nombres = append(nombres, f.Name)
		if f.Name == "VENTAS_CBTE_202610.txt" {
			r, _ := f.Open()
			x, _ := io.ReadAll(r)
			if string(x) != "x\r\n" {
				t.Fatalf("contenido: %q", x)
			}
		}
	}
	if strings.Join(nombres, ",") != "VENTAS_CBTE_202610.txt,VENTAS_ALICUOTAS_202610.txt,COMPRAS_CBTE_202610.txt,COMPRAS_ALICUOTAS_202610.txt,OMITIDOS.txt" {
		t.Fatal(nombres)
	}
}
