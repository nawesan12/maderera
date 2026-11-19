package facturacion

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	cuits "mjbj/internal/cuit"
	"mjbj/internal/fiscal"
	"mjbj/internal/sqlc"
)

// El padrón de ARBA se importa del archivo mensual, entero (revisión del
// comité, T6): el que se da de alta después de importarlo también figura.
func TestImportarElPadronDeArba(t *testing.T) {
	e := armar(t, false)
	ctx := context.Background()
	e.exec(t, `INSERT INTO customers (nombre, cuit, condicion_iva) VALUES ('Gómez SRL', '30-71234567-1', 'responsable_inscripto')`)
	archivo := strings.Join([]string{
		"P;25102026;01112026;30112026;30712345671;C;N;N;2,50;00;",
		// Todavía no es cliente: se guarda igual.
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
	entero := append([]byte(nil), zipeado.Bytes()...)
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
	var otro int
	e.uno(t, `SELECT count(*) FROM padron_iibb WHERE cuit = '30589445259'`, &otro)
	if otro != 0 {
		// El .zip de la vigencia de noviembre reemplazó a la del .txt.
		t.Errorf("el que no está en el último archivo quedó: %d", otro)
	}
	// Un .zip cortado (la subida se interrumpió) no se importa.
	if _, err := e.s.ImportarPadron(ctx, "", bytes.NewReader(entero[:len(entero)-10])); err == nil {
		t.Errorf("un .zip cortado se importó")
	}
}

// El cliente que se da de alta después de importar el padrón figura: antes
// quedaba «sin padrón» hasta el mes siguiente.
func TestElClienteNuevoFiguraEnElPadron(t *testing.T) {
	e := armar(t, false)
	ctx := context.Background()
	hoy := time.Now().In(fiscal.Argentina)
	desde, hasta := hoy.AddDate(0, 0, -1).Format("02012006"), hoy.AddDate(0, 0, 20).Format("02012006")
	archivo := "P;01012026;" + desde + ";" + hasta + ";30589445259;C;N;N;3,00;00;\n"
	if _, err := e.s.ImportarPadron(ctx, "", strings.NewReader(archivo)); err != nil {
		t.Fatal(err)
	}
	e.exec(t, `UPDATE configuracion_fiscal SET percibe_iibb = true, cuit = $1, condicion_iva = 'responsable_inscripto'`, cuitEmisor)
	e.exec(t, `INSERT INTO customers (nombre, cuit, condicion_iva) VALUES ('Nueva SA', '30-58944525-9', 'responsable_inscripto')`)
	cuit := "30589445259"
	id, err := e.s.EmitirComprobante(ctx, DatosEmision{ReceptorNombre: "Nueva SA", ReceptorCuit: &cuit, ReceptorCondicionIva: "responsable_inscripto",
		Lineas: []Linea{{LineaEntrada: fiscal.LineaEntrada{Descripcion: "Placa", Cantidad: 1, PrecioFinalUnitario: 12100}}}})
	if err != nil {
		t.Fatal(err)
	}
	var tributos string
	e.uno(t, `SELECT tributos::text FROM invoices WHERE id = $1`, &tributos, id)
	if tributos != "300.00" {
		t.Errorf("al cliente nuevo: %s, quería 300,00 (3 %% de 10.000)", tributos)
	}
}

// Con el padrón vencido no figura nadie: no se aplica la alícuota de quien
// no figura (antes se le percibía a todos), y cambiar un dato del emisor con
// la percepción encendida no falla.
func TestConElPadronVencido(t *testing.T) {
	e := armar(t, false)
	ctx := context.Background()
	admin := e.staff(t, "vencido@mjbj.test", sqlc.StaffRoleAdmin)
	e.exec(t, `INSERT INTO padron_iibb_importaciones (vigencia_desde, vigencia_hasta, renglones) VALUES (current_date - 40, current_date - 10, 1)`)
	e.exec(t, `INSERT INTO padron_iibb (cuit, alicuota, vigencia_desde, vigencia_hasta) VALUES ('30712345671', 0.5, current_date - 40, current_date - 10)`)
	e.exec(t, `UPDATE configuracion_fiscal SET percibe_iibb = true, alicuota_iibb_sin_padron = 5, cuit = $1, condicion_iva = 'responsable_inscripto'`, cuitEmisor)
	ri := "30712345671"
	id, err := e.s.EmitirComprobante(ctx, DatosEmision{ReceptorNombre: "Cliente", ReceptorCuit: &ri, ReceptorCondicionIva: "responsable_inscripto",
		Lineas: []Linea{{LineaEntrada: fiscal.LineaEntrada{Descripcion: "Placa", Cantidad: 1, PrecioFinalUnitario: 12100}}}})
	if err != nil {
		t.Fatal(err)
	}
	var tributos string
	e.uno(t, `SELECT tributos::text FROM invoices WHERE id = $1`, &tributos, id)
	if tributos != "0.00" {
		t.Errorf("con el padrón vencido: %s, quería 0 (no la alícuota de «no figura»)", tributos)
	}
	emisor := map[string]string{"razonSocial": "Maderera", "cuit": cuitEmisor, "condicionIva": "responsable_inscripto", "percibeIibb": "on",
		"alicuotaIibbSinPadron": "5", "telefono": "223 555-0000"}
	if st, b := pedir(t, admin, "PUT", e.srv.URL+"/api/v1/admin/facturacion/emisor", emisor); st != 200 {
		t.Errorf("guardar el emisor con la percepción ya encendida: %d %s", st, b)
	}
}

// El padrón sube entero por la ruta de verdad, con un cuerpo de más de
// 10 MB (lo que cortaba el proxy de Next), y lo que pasa del tope es un
// error y no un corte callado.
func TestElPadronGrandeLlegaEntero(t *testing.T) {
	e := armar(t, false)
	admin := e.staff(t, "grande@mjbj.test", sqlc.StaffRoleAdmin)
	var b strings.Builder
	n := 0
	for b.Len() < 11<<20 {
		// CUIT con dígito verificador válido: 20-NNNNNNNN-d.
		base := fmt.Sprintf("20%08d", n)
		for d := 0; d <= 9; d++ {
			if c := base + fmt.Sprint(d); cuits.Valido(c) {
				b.WriteString("P;25102026;01112026;30112026;" + c + ";C;N;N;1,00;00;\n")
				break
			}
		}
		n++
	}
	lineas := strings.Count(b.String(), "\n")
	req, _ := http.NewRequest("POST", e.srv.URL+"/api/v1/admin/facturacion/padron-iibb", strings.NewReader(b.String()))
	req.Header.Set("Content-Type", "application/octet-stream")
	resp, err := admin.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var r ResultadoDelPadron
	if err := json.NewDecoder(resp.Body).Decode(&r); err != nil || resp.StatusCode != 200 {
		t.Fatalf("%d %v", resp.StatusCode, err)
	}
	var filas int
	e.uno(t, `SELECT count(*) FROM padron_iibb`, &filas)
	if r.Leidos != lineas || filas != lineas {
		t.Errorf("leídos %d, guardados %d, quería %d", r.Leidos, filas, lineas)
	}
	// El tope corta con un error.
	c := &conTope{r: strings.NewReader("12345"), queda: 3}
	if _, err := io.ReadAll(c); err == nil || !strings.Contains(Mensaje(err), "400 MB") {
		t.Errorf("pasarse del tope: %v", err)
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
	e.exec(t, `INSERT INTO padron_iibb_importaciones (vigencia_desde, vigencia_hasta, renglones) VALUES (current_date - 1, current_date + 30, 1)`)
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

// lectorLento entrega el archivo de a un renglón, con una pausa antes de
// cada uno: una subida lenta que la copia va esperando.
type lectorLento struct {
	renglones []string
	pausa     time.Duration
}

func (l *lectorLento) Read(p []byte) (int, error) {
	if len(l.renglones) == 0 {
		return 0, io.EOF
	}
	time.Sleep(l.pausa)
	n := copy(p, l.renglones[0])
	l.renglones[0] = l.renglones[0][n:]
	if l.renglones[0] == "" {
		l.renglones = l.renglones[1:]
	}
	return n, nil
}

// La importación del padrón no muere por el tope de sentencia del pool
// principal (comité final, A5): la copia dura lo que dure la subida. Acá el
// pool tiene 300 ms de tope y la subida tarda más de un segundo.
func TestElPadronNoMuerePorElTopeDelPool(t *testing.T) {
	e := armar(t, false)
	ctx := context.Background()
	cfg := e.pool.Config().Copy()
	cfg.ConnConfig.RuntimeParams["statement_timeout"] = "300"
	conTope, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer conTope.Close()
	s := Nuevo(conTope, silencio)
	lento := &lectorLento{pausa: 400 * time.Millisecond, renglones: []string{
		"P;25102026;01112026;30112026;30712345671;C;N;N;2,50;00;\n",
		"P;25102026;01112026;30112026;30589445259;C;N;N;1,00;00;\n",
		"P;25102026;01112026;30112026;20123456786;C;N;N;1,50;00;\n",
	}}
	r, err := s.ImportarPadron(ctx, "", lento)
	if err != nil {
		t.Fatalf("la subida lenta se cortó: %v", err)
	}
	if r.Leidos != 3 {
		t.Errorf("leídos %d, quería 3", r.Leidos)
	}
	// La conexión vuelve al pool con su tope: el SET LOCAL no se escapa.
	var tope string
	if err := conTope.QueryRow(ctx, `SHOW statement_timeout`).Scan(&tope); err != nil || tope != "300ms" {
		t.Errorf("el tope quedó en %q (%v)", tope, err)
	}
}

// El listado del padrón cruza los CUIT limpios una sola vez (comité final):
// el cliente con el CUIT con guiones figura con el nombre del más viejo, y
// el renglón de quien no es cliente no figura.
func TestElListadoDelPadron(t *testing.T) {
	e := armar(t, false)
	ctx := context.Background()
	hoy := time.Now().In(fiscal.Argentina)
	desde, hasta := hoy.AddDate(0, 0, -1).Format("02012006"), hoy.AddDate(0, 0, 20).Format("02012006")
	archivo := "P;01012026;" + desde + ";" + hasta + ";30712345671;C;N;N;2,50;00;\n" +
		"P;01012026;" + desde + ";" + hasta + ";30589445259;C;N;N;1,00;00;\n"
	if _, err := e.s.ImportarPadron(ctx, "", strings.NewReader(archivo)); err != nil {
		t.Fatal(err)
	}
	e.exec(t, `INSERT INTO customers (nombre, razon_social, cuit, condicion_iva, created_at) VALUES
		('Gómez', 'Gómez SRL', '30-71234567-1', 'responsable_inscripto', now() - interval '1 day'),
		('Gómez repetido', '', '30712345671', 'responsable_inscripto', now()),
		('Sin padrón', '', '20-12345678-6', 'responsable_inscripto', now())`)
	filas, err := e.s.Padron(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(filas) != 1 || filas[0].Cuit != "30712345671" || filas[0].Cliente == nil || *filas[0].Cliente != "Gómez SRL" || filas[0].Alicuota != 2.5 {
		t.Fatalf("%+v", filas)
	}
}
