package facturacion

import (
	"archive/zip"
	"bytes"
	"context"
	"strings"
	"testing"

	"mjbj/internal/fiscal"
	"mjbj/internal/sqlc"
)

// El padrón de ARBA se importa del archivo mensual y se queda con los CUIT de
// los clientes (revisión del comité, T6).
func TestImportarElPadronDeArba(t *testing.T) {
	e := armar(t, false)
	ctx := context.Background()
	e.exec(t, `INSERT INTO customers (nombre, cuit, condicion_iva) VALUES ('Gómez SRL', '30-71234567-1', 'responsable_inscripto')`)
	archivo := strings.Join([]string{
		"P;25102026;01112026;30112026;30712345671;C;N;N;2,50;00;",
		// No es cliente: no se guarda.
		"P;25102026;01112026;30112026;30589445259;C;N;N;1,00;00;",
		// De retención: no se mira.
		"R;25102026;01112026;30112026;30712345671;C;N;N;9,00;00;",
		"basura",
	}, "\r\n")
	r, err := e.s.ImportarPadron(ctx, "", strings.NewReader(archivo))
	if err != nil {
		t.Fatal(err)
	}
	if r.Leidos != 2 || r.Cargados != 1 || r.Desde != "2026-11-01" || r.Hasta != "2026-11-30" {
		t.Fatalf("%+v", r)
	}
	// El mismo mes otra vez, con otra alícuota y en .zip: reemplaza, no se
	// pisan dos filas.
	var zipeado bytes.Buffer
	z := zip.NewWriter(&zipeado)
	w, _ := z.Create("PadronRGSPer112026.txt")
	_, _ = w.Write([]byte("P;25102026;01112026;30112026;30712345671;C;N;S;3,00;00;\n"))
	_ = z.Close()
	if _, err := e.s.ImportarPadron(ctx, "", &zipeado); err != nil {
		t.Fatal(err)
	}
	var filas int
	var alicuota float64
	e.uno(t, `SELECT count(*) FROM padron_iibb WHERE cuit = '30712345671'`, &filas)
	e.uno(t, `SELECT alicuota::float8 FROM padron_iibb WHERE cuit = '30712345671'`, &alicuota)
	if filas != 1 || alicuota != 3 {
		t.Errorf("%d filas, alícuota %v", filas, alicuota)
	}
	if _, err := e.s.ImportarPadron(ctx, "", strings.NewReader("hola\nchau\n")); err == nil || !strings.Contains(Mensaje(err), "no es el padrón") {
		t.Errorf("un archivo cualquiera: %v", err)
	}
}

// La percepción no se enciende sin padrón vigente, y con padrón se percibe
// al inscripto que figura y no al consumidor final.
func TestLaPercepcionSaleDelPadron(t *testing.T) {
	e := armar(t, false)
	ctx := context.Background()
	admin := e.staff(t, "padron@mjbj.test", sqlc.StaffRoleAdmin)
	emisor := map[string]string{"razonSocial": "Maderera", "cuit": cuitEmisor, "condicionIva": "responsable_inscripto", "percibeIibb": "on"}
	st, b := pedir(t, admin, "PUT", e.srv.URL+"/api/v1/admin/facturacion/emisor", emisor)
	if st != 422 || !strings.Contains(string(b), "padrón de ARBA") {
		t.Fatalf("encender sin padrón: %d %s", st, b)
	}
	e.exec(t, `INSERT INTO padron_iibb (cuit, alicuota, vigencia_desde, vigencia_hasta) VALUES ('30712345671', 2.5, current_date - 1, current_date + 30)`)
	if st, b := pedir(t, admin, "PUT", e.srv.URL+"/api/v1/admin/facturacion/emisor", emisor); st != 200 {
		t.Fatalf("encender con padrón: %d %s", st, b)
	}
	emitir := func(cuit *string, condicion string) string {
		id, err := e.s.EmitirComprobante(ctx, DatosEmision{ReceptorNombre: "Cliente", ReceptorCuit: cuit, ReceptorCondicionIva: condicion,
			Lineas: []Linea{{LineaEntrada: fiscal.LineaEntrada{Descripcion: "Placa", Cantidad: 1, PrecioFinalUnitario: 12100}}}})
		if err != nil {
			t.Fatal(err)
		}
		var tributos string
		e.uno(t, `SELECT tributos::text FROM invoices WHERE id = $1`, &tributos, id)
		return tributos
	}
	ri := "30712345671"
	if tr := emitir(&ri, "responsable_inscripto"); tr != "250.00" {
		t.Errorf("al inscripto del padrón: %s, quería 250,00 (2,5 %% de 10.000)", tr)
	}
	otro := "30589445259"
	if tr := emitir(&otro, "responsable_inscripto"); tr != "0.00" {
		t.Errorf("al que no figura, sin regla del contador: %s", tr)
	}
	if tr := emitir(&ri, "consumidor_final"); tr != "0.00" {
		t.Errorf("al consumidor final: %s", tr)
	}
}
