package pagos

import "testing"

// Un comprobante se mira por dentro: un .txt renombrado a .png o un PDF de
// bytes al azar no se registran como pagos (mes simulado, tercera prueba).
func TestComprobanteSeMiraPorDentro(t *testing.T) {
	rechazados := []*Archivo{
		{Datos: []byte("hola, soy un texto"), Tipo: "image/png"},
		{Datos: []byte{0x13, 0x77, 0x00, 0xaa, 0x01, 0x02}, Tipo: "application/pdf"},
	}
	for _, a := range rechazados {
		if err := revisarArchivo(a); err == nil {
			t.Fatalf("aceptó %q como %s", a.Datos, a.Tipo)
		}
	}
	// Una foto JPEG que el navegador mandó como PNG pasa, con su tipo real.
	jpeg := &Archivo{Datos: []byte{0xff, 0xd8, 0xff, 0xe0, 0, 0x10}, Tipo: "image/png"}
	if err := revisarArchivo(jpeg); err != nil || jpeg.Tipo != "image/jpeg" {
		t.Fatalf("jpeg: err=%v tipo=%s", err, jpeg.Tipo)
	}
	pdf := &Archivo{Datos: []byte("%PDF-1.7\n..."), Tipo: "application/pdf"}
	if err := revisarArchivo(pdf); err != nil {
		t.Fatal(err)
	}
}
