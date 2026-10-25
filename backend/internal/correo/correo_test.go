package correo

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func selladorDePrueba(t *testing.T) (*Sellador, *time.Time) {
	t.Helper()
	s, err := NuevoSellador([]byte("0123456789abcdef0123456789abcdef"), true)
	if err != nil {
		t.Fatal(err)
	}
	ahora := time.Date(2026, 10, 24, 9, 0, 0, 0, time.UTC)
	s.ahora = func() time.Time { return ahora }
	return s, &ahora
}

// La cookie que escribe Iniciar, como la mandaría el navegador de vuelta.
func pedidoCon(w *httptest.ResponseRecorder) *http.Request {
	r := httptest.NewRequest("GET", "/api/sesion", nil)
	for _, c := range w.Result().Cookies() {
		r.AddCookie(c)
	}
	return r
}

func TestSesionIdaYVuelta(t *testing.T) {
	s, _ := selladorDePrueba(t)
	w := httptest.NewRecorder()
	if err := s.Iniciar(w, Credenciales{Correo: "ventas@mjbj.com.ar", Clave: "una clave larga"}); err != nil {
		t.Fatal(err)
	}
	ck := w.Result().Cookies()[0]
	if ck.Name != "__Host-correo_sesion" || !ck.HttpOnly || !ck.Secure || ck.SameSite != http.SameSiteStrictMode {
		t.Fatalf("cookie con atributos equivocados: %+v", ck)
	}
	if strings.Contains(ck.Value, "ventas") || strings.Contains(ck.Value, "clave") {
		t.Fatal("la cookie deja ver la casilla o la clave")
	}
	cred, err := s.Leer(httptest.NewRecorder(), pedidoCon(w))
	if err != nil || cred.Correo != "ventas@mjbj.com.ar" || cred.Clave != "una clave larga" {
		t.Fatalf("no se pudo leer: %v %+v", err, cred)
	}
}

func TestSesionAlterada(t *testing.T) {
	s, _ := selladorDePrueba(t)
	w := httptest.NewRecorder()
	_ = s.Iniciar(w, Credenciales{Correo: "a@b.com", Clave: "x"})
	ck := w.Result().Cookies()[0]
	// Un carácter cambiado en el medio: GCM tiene que rechazarla.
	b := []byte(ck.Value)
	b[len(b)/2] ^= 1
	r := httptest.NewRequest("GET", "/", nil)
	r.AddCookie(&http.Cookie{Name: ck.Name, Value: string(b)})
	if _, err := s.Leer(httptest.NewRecorder(), r); err == nil {
		t.Fatal("aceptó una cookie alterada")
	}
	// Sellada con otra clave, tampoco.
	otro, _ := NuevoSellador([]byte("ffffffffffffffffffffffffffffffff"), true)
	if _, err := otro.Leer(httptest.NewRecorder(), pedidoCon(w)); err == nil {
		t.Fatal("aceptó una cookie de otra clave")
	}
}

func TestSesionVence(t *testing.T) {
	s, ahora := selladorDePrueba(t)
	w := httptest.NewRecorder()
	_ = s.Iniciar(w, Credenciales{Correo: "a@b.com", Clave: "x"})
	pedido := pedidoCon(w)

	*ahora = ahora.Add(inactividadMaxima - time.Minute)
	w2 := httptest.NewRecorder()
	if _, err := s.Leer(w2, pedido); err != nil {
		t.Fatal("venció antes de tiempo")
	}
	// La lectura renovó la marca de uso: con la cookie nueva sigue viva otras
	// dos horas.
	renovada := pedidoCon(w2)
	*ahora = ahora.Add(inactividadMaxima - time.Minute)
	if _, err := s.Leer(httptest.NewRecorder(), renovada); err != nil {
		t.Fatal("la renovación no sirvió")
	}
	// Con la cookie vieja, sin uso por más de dos horas: afuera.
	if _, err := s.Leer(httptest.NewRecorder(), pedido); err == nil {
		t.Fatal("no venció por inactividad")
	}
	// Y nunca más de doce horas, aunque se use todo el tiempo.
	s2, ahora2 := selladorDePrueba(t)
	w3 := httptest.NewRecorder()
	_ = s2.Iniciar(w3, Credenciales{Correo: "a@b.com", Clave: "x"})
	p := pedidoCon(w3)
	for i := 0; i < 13; i++ {
		*ahora2 = ahora2.Add(time.Hour)
		w4 := httptest.NewRecorder()
		_, err := s2.Leer(w4, p)
		if i < 11 && err != nil {
			t.Fatalf("venció a las %d horas", i+1)
		}
		if i >= 12 && err == nil {
			t.Fatal("pasó las doce horas")
		}
		if err == nil {
			p = pedidoCon(w4)
		}
	}
}

func TestIntentos(t *testing.T) {
	in := NuevosIntentos(3, 15*time.Minute)
	ahora := time.Now()
	in.ahora = func() time.Time { return ahora }
	for i := 0; i < 3; i++ {
		if !in.Permitido("ip:1", "casilla:a") {
			t.Fatalf("bloqueó en el intento %d", i+1)
		}
		in.Fallo("ip:1", "casilla:a")
	}
	if in.Permitido("ip:1") || in.Permitido("casilla:a") {
		t.Fatal("no bloqueó al cuarto")
	}
	// Desde otra IP contra la misma casilla, tampoco: es el ataque repartido.
	if in.Permitido("ip:2", "casilla:a") {
		t.Fatal("otra IP pasó contra una casilla bloqueada")
	}
	ahora = ahora.Add(16 * time.Minute)
	if !in.Permitido("ip:1", "casilla:a") {
		t.Fatal("no se liberó al salir de la ventana")
	}
}

const mensajeDePrueba = "From: =?iso-8859-1?q?Jos=E9_Pe=F1a?= <jose@ejemplo.com>\r\n" +
	"To: ventas@mjbj.com.ar\r\n" +
	"Cc: Admin <admin@mjbj.com.ar>\r\n" +
	"Subject: =?utf-8?q?Presupuesto_de_placas_fen=C3=B3licas?=\r\n" +
	"Date: Fri, 23 Oct 2026 10:15:00 -0300\r\n" +
	"Message-ID: <abc123@ejemplo.com>\r\n" +
	"References: <uno@ejemplo.com> <dos@ejemplo.com>\r\n" +
	"MIME-Version: 1.0\r\n" +
	"Content-Type: multipart/mixed; boundary=\"MEZCLA\"\r\n" +
	"\r\n" +
	"--MEZCLA\r\n" +
	"Content-Type: multipart/related; boundary=\"RELACION\"\r\n" +
	"\r\n" +
	"--RELACION\r\n" +
	"Content-Type: multipart/alternative; boundary=\"ALTERNATIVA\"\r\n" +
	"\r\n" +
	"--ALTERNATIVA\r\n" +
	"Content-Type: text/plain; charset=iso-8859-1\r\n" +
	"Content-Transfer-Encoding: quoted-printable\r\n" +
	"\r\n" +
	"Hola, necesito 10 placas fenol=EDticas.\r\n" +
	"--ALTERNATIVA\r\n" +
	"Content-Type: text/html; charset=utf-8\r\n" +
	"\r\n" +
	"<p onclick=\"robar()\">Hola</p><script>alert(1)</script><img src=\"cid:logo@ejemplo\"><img src=\"https://rastreo.ejemplo.com/p.gif\">\r\n" +
	"--ALTERNATIVA--\r\n" +
	"--RELACION\r\n" +
	"Content-Type: image/png\r\n" +
	"Content-ID: <logo@ejemplo>\r\n" +
	"Content-Transfer-Encoding: base64\r\n" +
	"\r\n" +
	"iVBORw0KGgo=\r\n" +
	"--RELACION--\r\n" +
	"--MEZCLA\r\n" +
	"Content-Type: application/pdf; name=\"lista.pdf\"\r\n" +
	"Content-Disposition: attachment; filename=\"lista.pdf\"\r\n" +
	"Content-Transfer-Encoding: base64\r\n" +
	"\r\n" +
	"JVBERi0xLjQK\r\n" +
	"--MEZCLA--\r\n"

func TestParsear(t *testing.T) {
	m, datos, err := parsear([]byte(mensajeDePrueba))
	if err != nil {
		t.Fatal(err)
	}
	if m.Asunto != "Presupuesto de placas fenólicas" {
		t.Errorf("asunto: %q", m.Asunto)
	}
	if len(m.De) != 1 || m.De[0].Nombre != "José Peña" || m.De[0].Correo != "jose@ejemplo.com" {
		t.Errorf("remitente en Latin-1 mal decodificado: %+v", m.De)
	}
	if len(m.CC) != 1 || m.CC[0].Correo != "admin@mjbj.com.ar" {
		t.Errorf("cc: %+v", m.CC)
	}
	if m.MessageID != "abc123@ejemplo.com" || len(m.Referencias) != 2 {
		t.Errorf("hilo: %q %v", m.MessageID, m.Referencias)
	}
	if !strings.Contains(m.Texto, "fenolíticas") {
		t.Errorf("texto en Latin-1 mal decodificado: %q", m.Texto)
	}
	if !m.TieneHTML || !m.ImagenesRemotas {
		t.Errorf("html=%v remotas=%v", m.TieneHTML, m.ImagenesRemotas)
	}
	if len(m.Adjuntos) != 2 || len(datos) != 2 {
		t.Fatalf("adjuntos: %+v", m.Adjuntos)
	}
	visibles := soloVisibles(m.Adjuntos, m.html)
	if len(visibles) != 1 || visibles[0].Nombre != "lista.pdf" || visibles[0].Tipo != "application/pdf" {
		t.Errorf("la imagen en línea que el HTML usa no tiene que listarse: %+v", visibles)
	}
	if string(datos[visibles[0].Indice]) != "%PDF-1.4\n" {
		t.Errorf("datos del PDF: %q", datos[visibles[0].Indice])
	}
}

func TestSanear(t *testing.T) {
	m, datos, _ := parsear([]byte(mensajeDePrueba))
	enLinea := map[string]string{}
	for _, a := range m.Adjuntos {
		if a.cid != "" {
			enLinea[a.cid] = "data:" + a.Tipo + ";base64,AAAA"
		}
	}
	_ = datos
	h := sanear(m.html, enLinea)
	for _, prohibido := range []string{"<script", "onclick", "robar", "cid:"} {
		if strings.Contains(h, prohibido) {
			t.Errorf("el HTML saneado tiene %q: %s", prohibido, h)
		}
	}
	if !strings.Contains(h, `src="data:image/png;base64,AAAA"`) {
		t.Errorf("la imagen en línea no quedó incrustada: %s", h)
	}
}

func TestValidarBorrador(t *testing.T) {
	b := &Borrador{Para: []string{"no-es-un-correo"}, Asunto: "hola\r\nBcc: todos@ejemplo.com"}
	errs := b.Validar()
	if errs["para"] == "" || errs["asunto"] == "" {
		t.Errorf("faltan errores: %v", errs)
	}
	b = &Borrador{Para: []string{"jose@ejemplo.com"}, Asunto: "Presupuesto"}
	if errs := b.Validar(); len(errs) != 0 {
		t.Errorf("un borrador bueno dio errores: %v", errs)
	}
	if errs := (&Borrador{}).Validar(); errs["para"] == "" {
		t.Error("sin destinatarios no puede pasar")
	}
}

func TestSepararDirecciones(t *testing.T) {
	got := separarDirecciones(" a@b.com, c@d.com;e@f.com\n ,, ")
	if strings.Join(got, "|") != "a@b.com|c@d.com|e@f.com" {
		t.Errorf("%v", got)
	}
}

func TestEtiquetas(t *testing.T) {
	for _, nombre := range []string{"Presupuesto", "Pedido abierto", "Reclamación", "Año 2026", "a_b&c$"} {
		f, ok := palabraClave(nombre)
		if !ok {
			t.Fatalf("%q no se pudo codificar", nombre)
		}
		for i := 0; i < len(f); i++ {
			if !esAtomo(f[i]) {
				t.Fatalf("%q quedó %q, que no es un átomo", nombre, f)
			}
		}
		vuelta, ok := etiquetaDe(f)
		if !ok || vuelta != nombre {
			t.Fatalf("%q → %q → %q", nombre, f, vuelta)
		}
	}
	if _, ok := etiquetaDe("$Forwarded"); ok {
		t.Fatal("$Forwarded no es una etiqueta")
	}
	if _, ok := palabraClave("   "); ok {
		t.Fatal("una etiqueta vacía no vale")
	}
}

func TestSospecha(t *testing.T) {
	crudo := "From: Mercado Pago <avisos@mercadopag0-seguridad.test>\r\nTo: ventas@mjbj.com.ar\r\nSubject: Tu cuenta\r\n" +
		"MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=b\r\n\r\n" +
		"--b\r\nContent-Type: text/html; charset=utf-8\r\n\r\n" +
		`<p>Verificá en <a href="https://mp-verificacion-cuentas.xyz/login">www.mercadopago.com/verificar</a> o <a href="https://mjbj.com.ar">acá</a>.</p>` + "\r\n" +
		"--b\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename=\"comprobante.pdf.exe\"\r\n\r\nMZ\r\n--b--\r\n"
	m, _, err := parsear([]byte(crudo))
	if err != nil {
		t.Fatal(err)
	}
	if m.Sospecha == nil {
		t.Fatal("tendría que ser sospechoso")
	}
	for _, quiero := range []string{"Mercado Pago", "mercadopag0-seguridad.test", "enlaces", "comprobante.pdf.exe"} {
		if !strings.Contains(m.Sospecha.Motivo, quiero) {
			t.Errorf("el motivo %q no dice %q", m.Sospecha.Motivo, quiero)
		}
	}
	if len(m.Sospecha.Enlaces) != 1 || m.Sospecha.Enlaces[0].Destino != "mp-verificacion-cuentas.xyz" {
		t.Errorf("enlaces: %+v", m.Sospecha.Enlaces)
	}
	if len(m.Adjuntos) != 1 || !m.Adjuntos[0].Bloqueado {
		t.Errorf("el .exe tiene que quedar bloqueado: %+v", m.Adjuntos)
	}
	marcado := sanear(m.html, nil)
	if !strings.Contains(marcado, `data-enganoso="Este enlace no va a mercadopago.com: lleva a mp-verificacion-cuentas.xyz"`) {
		t.Errorf("el enlace engañoso no quedó marcado: %s", marcado)
	}
	if strings.Count(marcado, "data-enganoso") != 1 {
		t.Errorf("«acá» no promete destino y no se marca: %s", marcado)
	}

	// El mismo nombre desde el dominio de verdad no es sospechoso.
	bueno := strings.Replace(crudo, "mercadopag0-seguridad.test", "mercadopago.com.ar", 1)
	bueno = strings.Replace(bueno, "https://mp-verificacion-cuentas.xyz/login", "https://www.mercadopago.com/verificar", 1)
	bueno = strings.Replace(bueno, "comprobante.pdf.exe", "comprobante.pdf", 1)
	if m, _, _ := parsear([]byte(bueno)); m.Sospecha != nil {
		t.Errorf("no tendría que ser sospechoso: %+v", m.Sospecha)
	}
}

func TestNombreUnico(t *testing.T) {
	usados := map[string]int{}
	got := []string{nombreUnico("foto.jpg", usados), nombreUnico("foto.jpg", usados), nombreUnico("plano.pdf", usados)}
	if strings.Join(got, "|") != "foto.jpg|foto (2).jpg|plano.pdf" {
		t.Errorf("%v", got)
	}
}

func TestVista(t *testing.T) {
	casos := []struct {
		p    parteTexto
		in   string
		want string
	}{
		{parteTexto{codificado: "7bit"}, "Hola Diego,\n\nva el presupuesto.\n\nEl vie, 24 oct a las 9:42, Martín escribió:\n> algo", "Hola Diego, va el presupuesto."},
		{parteTexto{codificado: "quoted-printable", juego: "utf-8"}, "Te paso el despiece en PDF. Las piezas de 2600 van con la veta =\na lo largo y las de 7=C3=", "Te paso el despiece en PDF. Las piezas de 2600 van con la veta a lo largo y las de 7"},
		{parteTexto{codificado: "base64"}, "SG9sYSwgwr9jb3J0YW4gZmVuw7NsaWNvPw==", "Hola, ¿cortan fenólico?"},
		{parteTexto{codificado: "8bit", esHTML: true}, "<p>Hola <b>Ana</b></p><div>¿Cómo va?</div>", "Hola Ana ¿Cómo va?"},
		{parteTexto{codificado: "quoted-printable", juego: "iso-8859-1"}, "Ma=F1ana", "Mañana"},
	}
	for _, c := range casos {
		if got := decodificarVista(c.p, []byte(c.in)); got != c.want {
			t.Errorf("decodificarVista(%q) = %q, quería %q", c.in, got, c.want)
		}
	}
}
