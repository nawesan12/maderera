package facturacion

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/api/facturacionapi"
	"mjbj/internal/auth"
	"mjbj/internal/fiscal"
	"mjbj/internal/fiscal/simulador"
	"mjbj/internal/plataforma"
	"mjbj/internal/pruebas"
	"mjbj/internal/sqlc"
)

var silencio = slog.New(slog.NewTextHandler(io.Discard, nil))

const secretoInterno = "secreto-interno-de-prueba-facturacion"

const cuitEmisor = "30589445259"

type entorno struct {
	srv  *httptest.Server
	pool *pgxpool.Pool
	ses  *auth.Servicio
	s    *Servicio
	sim  *simulador.Simulador
}

// armar levanta la API con un ARCA simulado (o sin ARCA, con el proveedor
// interno) y deja el emisor y el punto de venta 3 cargados.
func armar(t *testing.T, conArca bool) *entorno {
	t.Helper()
	pool := pruebas.Base(t)
	ses := auth.Nuevo(auth.Config{Secreto: "secreto-de-prueba-de-facturacion-32-caracteres", URL: "http://localhost"}, pool)
	s := Nuevo(pool, silencio)
	e := &entorno{pool: pool, ses: ses}
	vars := map[string]string{}
	if conArca {
		e.sim = simulador.Nuevo()
		t.Cleanup(e.sim.Cerrar)
		cert, clave, err := simulador.CertificadoDePrueba(cuitEmisor)
		if err != nil {
			t.Fatal(err)
		}
		vars = map[string]string{"ARCA_CUIT": cuitEmisor, "ARCA_CERTIFICADO": cert, "ARCA_CLAVE_PRIVADA": clave,
			"ARCA_URL_WSAA": e.sim.URLWsaa(), "ARCA_URL_WSFE": e.sim.URLWsfe()}
	}
	e.s = s.ConEntorno(func(k string) string { return vars[k] })
	m := http.NewServeMux()
	facturacionapi.HandlerWithOptions(
		facturacionapi.NewStrictHandlerWithOptions(NuevaAPI(e.s, plataforma.ConfigInterna{Secreto: secretoInterno}),
			[]facturacionapi.StrictMiddlewareFunc{plataforma.ConPedido[facturacionapi.StrictHandlerFunc]},
			facturacionapi.StrictHTTPServerOptions{RequestErrorHandlerFunc: plataforma.ErrorDePedido, ResponseErrorHandlerFunc: plataforma.ErrorDeRespuesta(silencio)}),
		facturacionapi.StdHTTPServerOptions{BaseRouter: m},
	)
	spec, _ := facturacionapi.GetSwagger()
	validar, err := plataforma.ValidarContra(spec)
	if err != nil {
		t.Fatal(err)
	}
	spec2, _ := facturacionapi.GetSwagger()
	e.srv = httptest.NewServer(pruebas.ConContrato(t, spec2, ses.Middleware(validar(m))))
	t.Cleanup(e.srv.Close)
	ctx := context.Background()
	if _, err := s.ObtenerEmisor(ctx); err != nil {
		t.Fatal(err)
	}
	e.exec(t, `UPDATE configuracion_fiscal SET cuit = $1, condicion_iva = 'responsable_inscripto'`, cuitEmisor)
	e.exec(t, `INSERT INTO puntos_venta (numero, nombre, numero_inicial) VALUES (3, 'Mostrador', 0)`)
	return e
}

func (e *entorno) exec(t *testing.T, sql string, args ...any) {
	t.Helper()
	if _, err := e.pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
}

func (e *entorno) uno(t *testing.T, sql string, dest any, args ...any) {
	t.Helper()
	if err := e.pool.QueryRow(context.Background(), sql, args...).Scan(dest); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
}

func (e *entorno) cliente(cookies []*http.Cookie) *http.Client {
	jar, _ := cookiejar.New(nil)
	u, _ := http.NewRequest("GET", e.srv.URL, nil)
	jar.SetCookies(u.URL, cookies)
	return &http.Client{Jar: jar}
}

func (e *entorno) staff(t *testing.T, correo string, rol sqlc.StaffRole) *http.Client {
	t.Helper()
	ctx := context.Background()
	if _, err := e.ses.AltaDeStaff(ctx, correo, "una clave larga", "Persona", rol); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	if _, err := e.ses.Entrar(ctx, w, correo, "una clave larga", "", "", true); err != nil {
		t.Fatal(err)
	}
	return e.cliente(w.Result().Cookies())
}

func (e *entorno) web(t *testing.T, correo string) (*http.Client, string) {
	t.Helper()
	ctx := context.Background()
	if _, err := e.ses.AltaDeCliente(ctx, correo, "una clave larga", "Cliente Web"); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	ses, err := e.ses.Entrar(ctx, w, correo, "una clave larga", "", "", true)
	if err != nil {
		t.Fatal(err)
	}
	var id string
	e.uno(t, `SELECT id FROM customers WHERE user_id = $1`, &id, ses.UserID)
	return e.cliente(w.Result().Cookies()), id
}

func pedir(t *testing.T, c *http.Client, metodo, url string, cuerpo any, cabeceras ...string) (int, []byte) {
	t.Helper()
	var r io.Reader
	if cuerpo != nil {
		b, _ := json.Marshal(cuerpo)
		r = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(metodo, url, r)
	if cuerpo != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for i := 0; i+1 < len(cabeceras); i += 2 {
		req.Header.Set(cabeceras[i], cabeceras[i+1])
	}
	resp, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, b
}

func leerJSON[T any](t *testing.T, b []byte) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatalf("%v: %s", err, b)
	}
	return v
}

func manual(campos map[string]string, renglones ...[4]string) map[string]any {
	l := LineasManuales{Descripcion: []string{}, Cantidad: []string{}, Precio: []string{}, Alicuota: []string{}}
	for _, r := range renglones {
		l.Descripcion = append(l.Descripcion, r[0])
		l.Cantidad = append(l.Cantidad, r[1])
		l.Precio = append(l.Precio, r[2])
		l.Alicuota = append(l.Alicuota, r[3])
	}
	return map[string]any{"campos": campos, "lineas": l}
}

func consumidor() map[string]string {
	return map[string]string{"receptorNombre": "Juan Pérez", "receptorCondicionIva": "consumidor_final"}
}

// La ida y vuelta entera: emitir a mano, pedir el CAE al simulador, ver el
// comprobante con su QR y bajarlo en PDF.
func TestEmitirYAutorizarContraElSimulador(t *testing.T) {
	e := armar(t, true)
	admin := e.staff(t, "admin@mjbj.test", sqlc.StaffRoleAdmin)

	st, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes",
		manual(consumidor(), [4]string{"Fenólico 18 mm", "2", "12100", "21"}, [4]string{"  ", "", "", ""}, [4]string{"Flete", "1", "5000", "10.5"}))
	if st != 200 {
		t.Fatalf("emitir: %d %s", st, b)
	}
	id := leerJSON[map[string]string](t, b)["invoiceId"]
	var tipo string
	var numero int64
	var total string
	if err := e.pool.QueryRow(context.Background(), `SELECT tipo::text, numero, total::text FROM invoices WHERE id = $1`, id).Scan(&tipo, &numero, &total); err != nil {
		t.Fatal(err)
	}
	if tipo != "factura_b" || numero != 1 || total != "29200.00" {
		t.Fatalf("emitido: %s %d %s", tipo, numero, total)
	}
	var avisos int
	e.uno(t, `SELECT count(*) FROM trabajos WHERE tipo = 'factura.aviso'`, &avisos)
	if avisos != 1 {
		t.Fatalf("avisos encolados: %d", avisos)
	}

	st, b = pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/"+id+"/autorizar", nil)
	r := leerJSON[map[string]string](t, b)
	if st != 200 || !strings.HasPrefix(r["ok"], "Autorizado por ARCA. CAE ") {
		t.Fatalf("autorizar: %d %s", st, b)
	}
	st, b = pedir(t, admin, "GET", e.srv.URL+"/api/v1/comprobantes/"+id, nil)
	c := leerJSON[Completo](t, b)
	if st != 200 || c.Estado != "autorizada" || c.Cae == nil || c.QrURL == nil || len(c.Items) != 2 || c.CaeVencimiento == nil {
		t.Fatalf("comprobante: %d %s", st, b)
	}
	var logs int
	e.uno(t, `SELECT count(*) FROM arca_log WHERE invoice_id = $1 AND operacion = 'FECAESolicitar' AND exito`, &logs, id)
	if logs != 1 {
		t.Fatalf("arca_log del pedido de CAE: %d", logs)
	}
	st, b = pedir(t, admin, "GET", e.srv.URL+"/api/v1/comprobantes/"+id+"/pdf", nil)
	if st != 200 || !bytes.HasPrefix(b, []byte("%PDF")) {
		t.Fatalf("pdf: %d", st)
	}
	// Autorizar otra vez: ya está.
	_, b = pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/"+id+"/autorizar", nil)
	if leerJSON[map[string]string](t, b)["error"] != "Este comprobante ya está autorizado." {
		t.Fatalf("reautorizar: %s", b)
	}
	// El ticket del WSAA se pidió una sola vez.
	if n := e.sim.Llamadas("loginCms"); n != 1 {
		t.Fatalf("tickets pedidos: %d", n)
	}
}

// **El corte entre el CAE y el guardado.** ARCA autorizó y el proceso murió
// antes de guardar el CAE: el comprobante quedó «emitido» sin CAE. El TS, al
// reintentar, volvía a pedir el CAE del mismo número, ARCA lo rechazaba por
// repetido (10016) y el comprobante quedaba «rechazado» con el CAE perdido.
// Go pregunta el último autorizado, ve que el número ya está del lado de
// ARCA, lo consulta y adopta el mismo CAE, sin pedir otro.
func TestCorteEntreElCaeYElGuardado(t *testing.T) {
	e := armar(t, true)
	ctx := context.Background()
	id, err := e.s.EmitirComprobante(ctx, DatosEmision{ReceptorNombre: "Consumidor final", ReceptorCondicionIva: "consumidor_final",
		Lineas: []Linea{{LineaEntrada: fiscal.LineaEntrada{Descripcion: "Tirante", Cantidad: 3, PrecioFinalUnitario: 4500}}}})
	if err != nil {
		t.Fatal(err)
	}
	corte := errors.New("el proceso se cortó")
	e.s.despuesDelCAE = func(string) error { return corte }
	if _, err := e.s.Autorizar(ctx, id); !errors.Is(err, corte) {
		t.Fatalf("tendría que cortarse: %v", err)
	}
	e.s.despuesDelCAE = nil
	var estado string
	e.uno(t, `SELECT estado::text FROM invoices WHERE id = $1 AND cae IS NULL`, &estado, id)
	dado, ok := e.sim.Emitido(3, 6, 1)
	if estado != "emitida" || !ok {
		t.Fatalf("antes del reintento: %s, ARCA lo tiene: %v", estado, ok)
	}

	m, err := e.s.Autorizar(ctx, id)
	if err != nil {
		t.Fatalf("el reintento: %v", err)
	}
	var cae string
	e.uno(t, `SELECT cae FROM invoices WHERE id = $1 AND estado = 'autorizada'`, &cae, id)
	if cae != dado.Cae || m != "Autorizado por ARCA. CAE "+dado.Cae+"." {
		t.Fatalf("CAE %s (%s), ARCA dio %s", cae, m, dado.Cae)
	}
	if n := e.sim.Llamadas("FECAESolicitar"); n != 1 {
		t.Fatalf("se pidieron %d CAE: tendría que haber recuperado el primero", n)
	}
	if n := e.sim.Llamadas("FECompConsultar"); n != 1 {
		t.Fatalf("consultas: %d", n)
	}

	// Lo mismo con el segundo, que va por el camino corto (el anterior tiene
	// CAE): ARCA rechaza el reintento por repetido (10016) y Go recupera.
	id2, _ := e.s.EmitirComprobante(ctx, DatosEmision{ReceptorNombre: "Consumidor final", ReceptorCondicionIva: "consumidor_final",
		Lineas: []Linea{{LineaEntrada: fiscal.LineaEntrada{Descripcion: "Tirante", Cantidad: 1, PrecioFinalUnitario: 4500}}}})
	e.s.despuesDelCAE = func(string) error { return corte }
	if _, err := e.s.Autorizar(ctx, id2); !errors.Is(err, corte) {
		t.Fatalf("el segundo tendría que cortarse: %v", err)
	}
	e.s.despuesDelCAE = nil
	if _, err := e.s.Autorizar(ctx, id2); err != nil {
		t.Fatalf("el reintento del segundo: %v", err)
	}
	dado2, _ := e.sim.Emitido(3, 6, 2)
	e.uno(t, `SELECT cae FROM invoices WHERE id = $1 AND estado = 'autorizada'`, &cae, id2)
	if cae != dado2.Cae {
		t.Fatalf("segundo: CAE %s, ARCA dio %s", cae, dado2.Cae)
	}
}

// Si la respuesta de ARCA no llega (se corta la red después de autorizar),
// pasa lo mismo: el reintento recupera el CAE.
func TestRespuestaPerdida(t *testing.T) {
	e := armar(t, true)
	ctx := context.Background()
	id, err := e.s.EmitirComprobante(ctx, DatosEmision{ReceptorNombre: "CF", ReceptorCondicionIva: "consumidor_final",
		Lineas: []Linea{{LineaEntrada: fiscal.LineaEntrada{Descripcion: "Placa", Cantidad: 1, PrecioFinalUnitario: 1000}}}})
	if err != nil {
		t.Fatal(err)
	}
	var una sync.Once
	e.sim.AntesDeResponder(func(metodo string) {
		if metodo == "FECAESolicitar" {
			una.Do(func() { panic(http.ErrAbortHandler) })
		}
	})
	if _, err := e.s.Autorizar(ctx, id); Mensaje(err) != "No se pudo conectar con ARCA." {
		t.Fatalf("sin respuesta: %v", err)
	}
	if _, err := e.s.Autorizar(ctx, id); err != nil {
		t.Fatalf("reintento: %v", err)
	}
	dado, _ := e.sim.Emitido(3, 6, 1)
	var cae string
	e.uno(t, `SELECT cae FROM invoices WHERE id = $1`, &cae, id)
	if cae != dado.Cae || e.sim.Llamadas("FECAESolicitar") != 1 {
		t.Fatalf("CAE %s, ARCA %s, pedidos %d", cae, dado.Cae, e.sim.Llamadas("FECAESolicitar"))
	}
}

// **Numeración sin huecos con 20 a la vez.** Sin el candado, dos emisiones
// leen el mismo máximo y la segunda choca con el índice único
// (MJBJ_PRUEBA_SIN_CANDADO=1 para verla fallar).
func TestNumeracionConcurrente(t *testing.T) {
	e := armar(t, false)
	e.s.sinCandado = os.Getenv("MJBJ_PRUEBA_SIN_CANDADO") == "1"
	e.exec(t, `UPDATE puntos_venta SET numero_inicial = 1200`)
	ctx := context.Background()
	const n = 20
	var wg sync.WaitGroup
	errores := make(chan error, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := e.s.EmitirComprobante(ctx, DatosEmision{ReceptorNombre: "CF", ReceptorCondicionIva: "consumidor_final",
				Lineas: []Linea{{LineaEntrada: fiscal.LineaEntrada{Descripcion: "Machimbre", Cantidad: 15.5, PrecioFinalUnitario: 3100}}}})
			errores <- err
		}()
	}
	wg.Wait()
	close(errores)
	for err := range errores {
		if err != nil {
			t.Errorf("una emisión falló: %v", err)
		}
	}
	var cuantos, minimo, maximo int64
	if err := e.pool.QueryRow(ctx, `SELECT count(DISTINCT numero), min(numero), max(numero) FROM invoices`).Scan(&cuantos, &minimo, &maximo); err != nil {
		t.Fatal(err)
	}
	if cuantos != n || minimo != 1201 || maximo != 1200+n {
		t.Fatalf("numeración: %d números entre %d y %d", cuantos, minimo, maximo)
	}
}

// Veinte ventas a la vez que piden su CAE apenas se emiten (como el
// mostrador): ARCA solo acepta el siguiente número, y el TS, sin orden, se
// llevaba rechazos 10016. Con el candado y los anteriores primero, todas
// quedan autorizadas.
func TestAutorizarVeinteALaVez(t *testing.T) {
	e := armar(t, true)
	ctx := context.Background()
	const n = 20
	var wg sync.WaitGroup
	fallas := make(chan string, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r, err := e.s.EmitirParaLaVenta(ctx, PedidoDeComprobante{OrderID: "", ReceptorNombre: "Mostrador", UsuarioID: "u",
				Lineas: []LineaDeVenta{{Descripcion: "Clavos", Unidad: "kg", Cantidad: 2, PrecioUnitario: 1500}}})
			if err != nil {
				fallas <- err.Error()
			} else if !r.Autorizado {
				fallas <- r.Aviso
			}
		}()
	}
	wg.Wait()
	close(fallas)
	for f := range fallas {
		t.Error(f)
	}
	var autorizadas int
	e.uno(t, `SELECT count(*) FROM invoices WHERE estado = 'autorizada' AND cae IS NOT NULL`, &autorizadas)
	if autorizadas != n || e.sim.Ultimo(3, 6) != n {
		t.Fatalf("autorizadas %d, último de ARCA %d", autorizadas, e.sim.Ultimo(3, 6))
	}
}

// Autorizar el tercero autoriza antes el primero y el segundo; si ARCA ya
// traía números de otro sistema, lo dice en vez de pedir un CAE que va a
// rechazar.
func TestAutorizarEnOrden(t *testing.T) {
	e := armar(t, true)
	ctx := context.Background()
	var ids []string
	for i := 0; i < 3; i++ {
		id, err := e.s.EmitirComprobante(ctx, DatosEmision{ReceptorNombre: "CF", ReceptorCondicionIva: "consumidor_final",
			Lineas: []Linea{{LineaEntrada: fiscal.LineaEntrada{Descripcion: "Placa", Cantidad: 1, PrecioFinalUnitario: float64(1000 * (i + 1))}}}})
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id)
	}
	if _, err := e.s.Autorizar(ctx, ids[2]); err != nil {
		t.Fatal(err)
	}
	var n int
	e.uno(t, `SELECT count(*) FROM invoices WHERE cae IS NOT NULL`, &n)
	if n != 3 {
		t.Fatalf("autorizados: %d", n)
	}
	// Otro sistema facturó el 4 en ARCA: el 4 de acá tiene otro total.
	id4, _ := e.s.EmitirComprobante(ctx, DatosEmision{ReceptorNombre: "CF", ReceptorCondicionIva: "consumidor_final",
		Lineas: []Linea{{LineaEntrada: fiscal.LineaEntrada{Descripcion: "Placa", Cantidad: 1, PrecioFinalUnitario: 99}}}})
	e.sim.Fijar(3, 6, 4)
	if _, err := e.s.Autorizar(ctx, id4); !strings.Contains(Mensaje(err), "no lo tiene registrado") {
		t.Fatalf("desfasado: %v", err)
	}
}

// Sin certificado: el proveedor interno numera y emite, pero no autoriza y
// nunca inventa un CAE.
func TestProveedorInterno(t *testing.T) {
	e := armar(t, false)
	ctx := context.Background()
	id, err := e.s.EmitirComprobante(ctx, DatosEmision{ReceptorNombre: "CF", ReceptorCondicionIva: "consumidor_final",
		Lineas: []Linea{{LineaEntrada: fiscal.LineaEntrada{Descripcion: "Placa", Cantidad: 1, PrecioFinalUnitario: 1000}}}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.s.Autorizar(ctx, id); Mensaje(err) != sinValorFiscal {
		t.Fatalf("interno: %v", err)
	}
	var estado string
	e.uno(t, `SELECT estado::text FROM invoices WHERE id = $1 AND cae IS NULL`, &estado, id)
	if estado != "rechazada" {
		t.Fatal(estado)
	}
	admin := e.staff(t, "a@mjbj.test", sqlc.StaffRoleAdmin)
	_, b := pedir(t, admin, "GET", e.srv.URL+"/api/v1/admin/facturacion/arca", nil)
	if st := leerJSON[EstadoArca](t, b); st.ID != "interno" || st.Operativo || st.HayCertificado {
		t.Fatalf("estado: %s", b)
	}
}

// Las notas: una parcial no anula; anular acredita lo que queda; la de débito
// suma. Las tres llevan su movimiento de cuenta corriente y la nota se
// autoriza con el comprobante asociado.
func TestNotasYAnulacion(t *testing.T) {
	e := armar(t, true)
	admin := e.staff(t, "admin@mjbj.test", sqlc.StaffRoleAdmin)
	campos := map[string]string{"receptorNombre": "Gómez SRL", "receptorCuit": "30-71234567-1", "receptorCondicionIva": "responsable_inscripto",
		"guardarComoCliente": "on", "receptorDomicilio": "Juan B. Justo 1"}
	st, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes", manual(campos,
		[4]string{"Fenólico", "10", "12100", "21"}, [4]string{"Tornillos", "4", "121", "21"}))
	if st != 200 {
		t.Fatalf("%d %s", st, b)
	}
	id := leerJSON[map[string]string](t, b)["invoiceId"]
	c, _ := e.s.Obtener(context.Background(), id)
	if c.Tipo != "factura_a" || c.CustomerID == nil {
		t.Fatalf("factura: %+v", c)
	}
	var saldo float64
	e.uno(t, `SELECT sum(monto)::float8 FROM account_movements WHERE customer_id = $1`, &saldo, *c.CustomerID)
	if saldo != 121484 {
		t.Fatalf("deuda: %v", saldo)
	}
	// El mismo CUIT otra vez no crea otra ficha.
	pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes", manual(campos, [4]string{"Otra", "1", "100", "21"}))
	var fichas int
	e.uno(t, `SELECT count(*) FROM customers WHERE cuit = '30712345671'`, &fichas)
	if fichas != 1 {
		t.Fatalf("fichas: %d", fichas)
	}
	pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/"+id+"/autorizar", nil)

	st, b = pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/"+id+"/nota-de-credito",
		map[string]any{"motivo": "Devolvió dos", "parciales": []map[string]any{{"itemId": c.Items[0].ID, "cantidad": 2}, {"itemId": c.Items[1].ID, "cantidad": nil}}})
	if st != 200 {
		t.Fatalf("parcial: %d %s", st, b)
	}
	nc := leerJSON[map[string]string](t, b)["invoiceId"]
	_, b = pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/"+nc+"/autorizar", nil)
	if leerJSON[map[string]string](t, b)["ok"] == "" {
		t.Fatalf("la nota con su asociado: %s", b)
	}
	c, _ = e.s.Obtener(context.Background(), id)
	if c.Estado != "autorizada" || c.Acreditado != "24200.00" {
		t.Fatalf("después de la parcial: %s %s", c.Estado, c.Acreditado)
	}
	// Más de lo facturado no.
	st, b = pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/"+id+"/nota-de-credito",
		map[string]any{"motivo": "Otra vez", "parciales": []map[string]any{{"itemId": c.Items[0].ID, "cantidad": 11}}})
	if st != 422 || !strings.Contains(string(b), `No se puede acreditar más de lo facturado en \"Fenólico\".`) {
		t.Fatalf("de más: %d %s", st, b)
	}
	// Anular: acredita lo que queda (8 placas y los tornillos) y anula.
	st, b = pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/"+id+"/anular", map[string]string{"motivo": "Mal"})
	if st != 422 || !strings.Contains(string(b), "Escribí el motivo de la anulación.") {
		t.Fatalf("motivo corto: %d %s", st, b)
	}
	st, b = pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/"+id+"/anular", map[string]string{"motivo": "Error de carga"})
	if st != 200 {
		t.Fatalf("anular: %d %s", st, b)
	}
	resto, _ := e.s.Obtener(context.Background(), leerJSON[map[string]string](t, b)["invoiceId"])
	c, _ = e.s.Obtener(context.Background(), id)
	if c.Estado != "anulada" || resto.Total != "97284.00" || len(resto.Items) != 2 {
		t.Fatalf("anulada: %s, la nota %s con %d renglones", c.Estado, resto.Total, len(resto.Items))
	}
	// Una nota de débito sobre una anulada no.
	st, b = pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/"+id+"/nota-de-debito",
		map[string]any{"motivo": "Flete olvidado", "concepto": "Flete", "importe": 5000, "alicuota": 21})
	if st != 422 || !strings.Contains(string(b), "está anulado") {
		t.Fatalf("débito sobre anulada: %d %s", st, b)
	}
	e.uno(t, `SELECT sum(monto)::float8 FROM account_movements WHERE customer_id = $1`, &saldo, *c.CustomerID)
	if saldo != 100 { // la segunda factura (100 final) es lo único que queda
		t.Fatalf("saldo final: %v", saldo)
	}
}

// El cobro: con recibo (por EmitirRecibo, con el aviso encolado) o a cuenta
// corriente, con el control de crédito.
func TestCobrarComprobante(t *testing.T) {
	e := armar(t, false)
	vendedor := e.staff(t, "v@mjbj.test", sqlc.StaffRoleVendedor)
	_, b := pedir(t, vendedor, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes", manual(consumidor(), [4]string{"Placa", "1", "12100", "21"}))
	id := leerJSON[map[string]string](t, b)["invoiceId"]
	st, b := pedir(t, vendedor, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/"+id+"/cobros",
		map[string]string{"modo": "cuenta_corriente", "monto": "12.100"})
	if st != 422 || !strings.Contains(string(b), "no tiene cliente") {
		t.Fatalf("a cuenta sin cliente: %d %s", st, b)
	}
	st, b = pedir(t, vendedor, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/"+id+"/cobros",
		map[string]string{"partes": `[{"medio":"efectivo","importe":"10000"},{"medio":"tarjeta_debito","importe":"2100","referencia":"lote 7"}]`})
	if st != 200 {
		t.Fatalf("cobrar: %d %s", st, b)
	}
	r := leerJSON[ResultadoDeCobro](t, b)
	if !strings.HasPrefix(r.Ok, "Cobro registrado con el recibo REC-0001.") || r.ReceiptID == nil {
		t.Fatalf("%+v", r)
	}
	c, _ := e.s.Obtener(context.Background(), id)
	if c.Cobrado != 12100 || c.Saldo != 0 || len(c.Cobros) != 2 {
		t.Fatalf("cobrado %v saldo %v", c.Cobrado, c.Saldo)
	}
	var avisos int
	e.uno(t, `SELECT count(*) FROM trabajos WHERE tipo = 'recibo.aviso'`, &avisos)
	if avisos != 1 {
		t.Fatalf("avisos del recibo: %d", avisos)
	}
	_, b = pedir(t, vendedor, "GET", e.srv.URL+"/api/v1/admin/facturacion/comprobantes?cobro=contado", nil)
	if l := leerJSON[[]Listado](t, b); len(l) != 1 || l[0].Cobrado != 12100 {
		t.Fatalf("listado de contado: %s", b)
	}
	_, b = pedir(t, vendedor, "GET", e.srv.URL+"/api/v1/admin/facturacion/comprobantes?cobro=cuenta", nil)
	if l := leerJSON[[]Listado](t, b); len(l) != 0 {
		t.Fatalf("listado a cuenta: %s", b)
	}
	// El vendedor no anula.
	if st, _ := pedir(t, vendedor, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/"+id+"/anular", map[string]string{"motivo": "Error de carga"}); st != 403 {
		t.Fatalf("anular un vendedor: %d", st)
	}
}

// Facturar un pedido: con el envío como renglón; dos clics a la vez lo
// facturaban dos veces (el TS miraba fuera de la transacción).
func TestFacturarPedidoUnaSolaVez(t *testing.T) {
	e := armar(t, false)
	admin := e.staff(t, "a@mjbj.test", sqlc.StaffRoleAdmin)
	var pedido string
	e.uno(t, `INSERT INTO orders (numero, contacto_nombre, costo_envio, zona_envio, total) VALUES ('PED-1000', 'Ana', 3000, 'Sur', 27200) RETURNING id`, &pedido)
	e.exec(t, `INSERT INTO order_items (order_id, descripcion, unidad, cantidad, precio_unitario, subtotal) VALUES ($1, 'Placa', 'unidad', 2, 12100, 24200)`, pedido)
	var wg sync.WaitGroup
	codigos := make(chan int, 5)
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			st, _ := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/pedidos/"+pedido+"/facturar", nil)
			codigos <- st
		}()
	}
	wg.Wait()
	close(codigos)
	bien := 0
	for c := range codigos {
		if c == 200 {
			bien++
		}
	}
	var n int
	e.uno(t, `SELECT count(*) FROM invoices WHERE order_id = $1`, &n, pedido)
	if bien != 1 || n != 1 {
		t.Fatalf("facturado %d veces (%d respuestas bien)", n, bien)
	}
	_, b := pedir(t, admin, "GET", e.srv.URL+"/api/v1/admin/facturacion/pedidos/"+pedido, nil)
	p := leerJSON[Pedido](t, b)
	if p.YaFacturado == nil || p.YaFacturado.Numero != 1 || len(p.Items) != 1 {
		t.Fatalf("%s", b)
	}
	var total string
	var renglones int
	e.uno(t, `SELECT total::text FROM invoices WHERE order_id = $1`, &total, pedido)
	e.uno(t, `SELECT count(*) FROM invoice_items i JOIN invoices f ON f.id = i.invoice_id WHERE f.order_id = $1 AND i.descripcion = 'Envío — Sur'`, &renglones, pedido)
	if total != "27200.00" || renglones != 1 {
		t.Fatalf("total %s, envío %d", total, renglones)
	}
}

// El portal ve solo lo suyo; a uno ajeno, 404. El servidor de Next con el
// secreto ve todo y emite por la ruta interna; sin el secreto, 403.
func TestPortalYRutasInternas(t *testing.T) {
	e := armar(t, false)
	web, cliente := e.web(t, "cliente@mjbj.test")
	ctx := context.Background()
	propio, err := e.s.EmitirComprobante(ctx, DatosEmision{CustomerID: &cliente, ReceptorNombre: "Cliente Web", ReceptorCondicionIva: "consumidor_final",
		Lineas: []Linea{{LineaEntrada: fiscal.LineaEntrada{Descripcion: "Placa", Cantidad: 1, PrecioFinalUnitario: 1000}}}})
	if err != nil {
		t.Fatal(err)
	}
	ajeno, _ := e.s.EmitirComprobante(ctx, DatosEmision{ReceptorNombre: "Otro", ReceptorCondicionIva: "consumidor_final",
		Lineas: []Linea{{LineaEntrada: fiscal.LineaEntrada{Descripcion: "Placa", Cantidad: 1, PrecioFinalUnitario: 1000}}}})
	_, b := pedir(t, web, "GET", e.srv.URL+"/api/v1/cuenta/comprobantes", nil)
	if l := leerJSON[[]Propio](t, b); len(l) != 1 || l[0].ID != propio {
		t.Fatalf("mis comprobantes: %s", b)
	}
	if st, _ := pedir(t, web, "GET", e.srv.URL+"/api/v1/comprobantes/"+propio+"/pdf", nil); st != 200 {
		t.Fatalf("mi pdf: %d", st)
	}
	if st, _ := pedir(t, web, "GET", e.srv.URL+"/api/v1/comprobantes/"+ajeno, nil); st != 404 {
		t.Fatalf("uno ajeno: %d", st)
	}
	if st, _ := pedir(t, http.DefaultClient, "GET", e.srv.URL+"/api/v1/comprobantes/"+ajeno, nil, "Authorization", "Bearer "+secretoInterno); st != 200 {
		t.Fatalf("el servidor: %d", st)
	}
	cuerpo := map[string]any{"receptorNombre": "Mostrador", "receptorCondicionIva": "consumidor_final", "lineas": []map[string]any{{"descripcion": "Clavos", "cantidad": 1, "precioFinalUnitario": 100}}}
	if st, _ := pedir(t, web, "POST", e.srv.URL+"/api/v1/interno/facturacion/comprobantes", cuerpo); st != 403 {
		t.Fatalf("la ruta interna sin secreto: %d", st)
	}
	st, b := pedir(t, http.DefaultClient, "POST", e.srv.URL+"/api/v1/interno/facturacion/comprobantes", cuerpo, "Authorization", "Bearer "+secretoInterno)
	if st != 200 || leerJSON[map[string]string](t, b)["invoiceId"] == "" {
		t.Fatalf("interno: %d %s", st, b)
	}
	st, b = pedir(t, http.DefaultClient, "GET", e.srv.URL+"/api/v1/interno/facturacion/letra?cuit=20-12345678-9", nil, "Authorization", "Bearer "+secretoInterno)
	if l := leerJSON[map[string]string](t, b); st != 200 || l["letra"] != "A" {
		t.Fatalf("letra: %d %s", st, b)
	}
	// Sin CUIT del emisor no se factura.
	e.exec(t, `UPDATE configuracion_fiscal SET cuit = NULL`)
	_, b = pedir(t, http.DefaultClient, "POST", e.srv.URL+"/api/v1/interno/facturacion/comprobantes", cuerpo, "Authorization", "Bearer "+secretoInterno)
	if !strings.Contains(leerJSON[map[string]string](t, b)["error"], "Falta cargar el CUIT") {
		t.Fatalf("sin CUIT: %s", b)
	}
}

// El libro IVA ventas: el mes en hora argentina (una factura de las 22 del
// 31 es de ese mes) y las notas de crédito en negativo.
func TestLibroIvaEnHoraArgentina(t *testing.T) {
	e := armar(t, false)
	ctx := context.Background()
	id, _ := e.s.EmitirComprobante(ctx, DatosEmision{ReceptorNombre: "CF", ReceptorCondicionIva: "consumidor_final",
		Lineas: []Linea{{LineaEntrada: fiscal.LineaEntrada{Descripcion: "Placa", Cantidad: 1, PrecioFinalUnitario: 1210}}}})
	// 31/10 a las 22 en Argentina = 1/11 01:00 UTC.
	e.exec(t, `UPDATE invoices SET fecha_emision = '2026-11-01T01:00:00Z' WHERE id = $1`, id)
	admin := e.staff(t, "a@mjbj.test", sqlc.StaffRoleAdmin)
	_, b := pedir(t, admin, "GET", e.srv.URL+"/api/v1/admin/facturacion/libro-iva?periodo=2026-10", nil)
	l := leerJSON[libroConPeriodo](t, b)
	if len(l.Filas) != 1 || l.Totales.Total != 1210 || l.Clave != "2026-10" {
		t.Fatalf("octubre: %s", b)
	}
	st, csv := pedir(t, admin, "GET", e.srv.URL+"/api/v1/admin/facturacion/libro-iva/csv?periodo=2026-10", nil)
	if st != 200 || !strings.Contains(string(csv), "31/10/2026") || !strings.HasPrefix(string(csv), "\ufeff") {
		t.Fatalf("csv: %d %s", st, csv)
	}
	_, b = pedir(t, admin, "GET", e.srv.URL+"/api/v1/admin/facturacion/libro-iva?periodo=2026-11", nil)
	if l := leerJSON[libroConPeriodo](t, b); len(l.Filas) != 0 {
		t.Fatalf("noviembre: %s", b)
	}
	// La fecha que va a ARCA es la misma.
	c, _ := e.s.Obtener(ctx, id)
	if fiscal.FechaArca(c.FechaEmision) != "20261031" {
		t.Fatal(fiscal.FechaArca(c.FechaEmision))
	}
}

// Los datos del emisor y los puntos de venta, con los errores de zod.
func TestEmisorYPuntosDeVenta(t *testing.T) {
	e := armar(t, false)
	admin := e.staff(t, "a@mjbj.test", sqlc.StaffRoleAdmin)
	vendedor := e.staff(t, "v@mjbj.test", sqlc.StaffRoleVendedor)
	campos := map[string]string{"razonSocial": "Maderera Juan B. Justo S.R.L.", "cuit": "30-58944525-9", "condicionIva": "responsable_inscripto",
		"alicuotaPercepcionIibb": "3,5", "percibeIibb": "on", "inicioActividades": "1981-03-01", "localidad": ""}
	if st, _ := pedir(t, vendedor, "PUT", e.srv.URL+"/api/v1/admin/facturacion/emisor", campos); st != 403 {
		t.Fatalf("vendedor: %d", st)
	}
	if st, b := pedir(t, admin, "PUT", e.srv.URL+"/api/v1/admin/facturacion/emisor", campos); st != 200 {
		t.Fatalf("emisor: %d %s", st, b)
	}
	_, b := pedir(t, admin, "GET", e.srv.URL+"/api/v1/fiscal/emisor", nil)
	em := leerJSON[Emisor](t, b)
	if em.AlicuotaPercepcionIibb != "3.50" || !em.PercibeIibb || em.Localidad != "Mar del Plata" || em.Cuit == nil || *em.Cuit != cuitEmisor {
		t.Fatalf("emisor: %s", b)
	}
	// Con percepción: la factura lleva el tributo.
	ctx := context.Background()
	id, _ := e.s.EmitirComprobante(ctx, DatosEmision{ReceptorNombre: "CF", ReceptorCondicionIva: "consumidor_final",
		Lineas: []Linea{{LineaEntrada: fiscal.LineaEntrada{Descripcion: "Placa", Cantidad: 1, PrecioFinalUnitario: 1210}}}})
	c, _ := e.s.Obtener(ctx, id)
	if c.TributosTotal != "35.00" || c.Total != "1245.00" || len(c.Tributos) != 1 {
		t.Fatalf("percepción: %s %s", c.TributosTotal, c.Total)
	}
	st, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/puntos-de-venta", map[string]string{"numero": "3", "nombre": "Repetido"})
	if st != 422 || !strings.Contains(string(b), "Ya hay un punto de venta con el número 3.") {
		t.Fatalf("repetido: %d %s", st, b)
	}
	st, b = pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/puntos-de-venta", map[string]string{"numero": "1.5", "nombre": "X"})
	if st != 422 || !strings.Contains(string(b), "expected int") {
		t.Fatalf("decimal: %d %s", st, b)
	}
	if st, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/puntos-de-venta", map[string]string{"numero": "15", "nombre": "Sucursal", "numeroInicial": "1274"}); st != 200 {
		t.Fatalf("alta: %d %s", st, b)
	}
	_, b = pedir(t, admin, "GET", e.srv.URL+"/api/v1/admin/facturacion/puntos-de-venta", nil)
	if l := leerJSON[[]PuntoDeVenta](t, b); len(l) != 2 || l[1].NumeroInicial != 1274 {
		t.Fatalf("puntos: %s", b)
	}
}
