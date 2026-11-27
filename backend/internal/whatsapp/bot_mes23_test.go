package whatsapp

import (
	"strings"
	"testing"

	"mjbj/internal/asistente"
	"mjbj/internal/auth"
)

// Los casos del mes simulado (27/11/2026) en que el bot se calló, contestó
// otra cosa o le pidió al cliente lo que ya había mandado.

func TestBotDerivaCuandoPidenUnaPersona(t *testing.T) {
	for _, texto := range []string{
		"Hola, quiero hablar con una persona por un mueble a medida", // M3S2-016: «persona» le gana a «a medida»
		"Quiero hablar con una persona para encargar un mueble a medida",
		"persona, es un reclamo", // M2S3-022
		"persona",
	} {
		r := Responder(texto, EstadoBot{}, datosDePrueba, false)
		if !r.Derivar {
			t.Errorf("«%s»: no derivó (%q)", texto, r.Texto)
		}
	}
}

func TestBotDerivaReclamosYCuenta(t *testing.T) {
	for _, texto := range []string{
		"Hola, ayer retiré un pedido y me faltó una tabla de deck, me cobraron 20 y vinieron 19", // M2S3-021
		"Me rechazaron un cheque que les di? me llegó un mail raro",
		"Aceptan cheques a 30 días?", // M3S4-011
	} {
		r := Responder(texto, EstadoBot{}, datosDePrueba, false)
		if !r.Derivar || r.Motivo == "" {
			t.Errorf("«%s»: derivar=%v motivo=%q texto=%q", texto, r.Derivar, r.Motivo, r.Texto)
		}
	}
}

func TestBotContestaLaPreguntaDespuesDelGracias(t *testing.T) {
	d := datosDePrueba
	d.Envios = []string{"• Mar del Plata — Coordinamos al confirmar", "• Tandil — 48 h"}
	for _, texto := range []string{"Ok gracias, hacen envíos a Batán?", "Gracias. Y hacen envíos a Batán?"} {
		r := Responder(texto, EstadoBot{}, d, false)
		if r.Entendio == asistente.Gracias || (r.Texto == "" && !r.Derivar) {
			t.Errorf("«%s»: se calló (%v)", texto, r.Entendio)
		}
	}
	r := Responder("Gracias. Aceptan transferencia?", EstadoBot{}, d, false)
	if !strings.Contains(r.Texto, "Transferencia") {
		t.Errorf("pagos después del gracias: %q", r.Texto)
	}
	if r := Responder("gracias", EstadoBot{}, d, false); r.Texto != "" || r.Derivar {
		t.Errorf("un gracias solo no se contesta: %q", r.Texto)
	}
}

func TestBotEnvioAUnLugar(t *testing.T) {
	d := datosDePrueba
	d.Envios = []string{"• Mar del Plata — Coordinamos al confirmar", "• Tandil — 48 h"}
	// M2S2-074: Batán no está entre las zonas: no se manda la lista entera.
	r := Responder("Hacen envíos a Batán? cuánto sale?", EstadoBot{}, d, false)
	if !r.Derivar || strings.Contains(r.Texto, "Tandil") {
		t.Errorf("Batán: derivar=%v %q", r.Derivar, r.Texto)
	}
	r = Responder("hacen envíos a Tandil?", EstadoBot{}, d, false)
	if r.Derivar || !strings.HasPrefix(r.Texto, "Sí, entregamos en Tandil") || strings.Contains(r.Texto, "Mar del Plata") {
		t.Errorf("Tandil: %q", r.Texto)
	}
	r = Responder("hacen envíos a domicilio?", EstadoBot{}, d, false)
	if !strings.Contains(r.Texto, "Tandil") {
		t.Errorf("sin lugar va la lista: %q", r.Texto)
	}
}

func TestBotHorarioDelDiaYDeUnaSucursal(t *testing.T) {
	r := Responder("Buenas! abren el domingo?", EstadoBot{}, datosDePrueba, false)
	if !strings.HasPrefix(r.Texto, "El domingo cerramos.") {
		t.Errorf("domingo: %q", r.Texto)
	}
	r = Responder("Dónde queda el aserradero?", EstadoBot{}, datosDePrueba, false)
	if !strings.Contains(r.Texto, "Diagonal Canosa 61") || strings.Contains(r.Texto, "Casa Central") {
		t.Errorf("aserradero: %q", r.Texto)
	}
}

// M3S1-026: «¿dónde queda el aserradero?» después del horario no se calla.
func TestJuntarNoSeCallaConUnaPreguntaYaContestada(t *testing.T) {
	horario := Responder("a qué hora abren?", EstadoBot{}, datosDePrueba, false)
	aserradero := Responder("Dónde queda el aserradero?", EstadoBot{}, datosDePrueba, false)
	tu := JuntarRespuestas([]RespuestaBot{aserradero}, []string{"Dónde queda el aserradero?"}, nil, EstadoBot{}, datosDePrueba, []string{horario.Texto})
	if len(tu.Partes) == 0 {
		t.Fatal("se calló")
	}
	// El «no lo encontré» ya dicho: la segunda vez pasa a una persona.
	no := RespuestaBot{Texto: "No lo encontré. Probá…", NoEntendio: true}
	tu = JuntarRespuestas([]RespuestaBot{no}, []string{"xyz"}, nil, EstadoBot{}, datosDePrueba, []string{"No lo encontré. Probá…"})
	if !tu.Derivar || len(tu.Partes) == 0 {
		t.Errorf("no derivó: %+v", tu)
	}
}

func TestBotRankeaPorElNombre(t *testing.T) {
	ps := []ProductoBot{
		{Nombre: "Fenólico 1220 x 2440mm", Slug: "fenolico"},
		{Nombre: "Melamina Blanca", Slug: "melamina-blanca"},
		{Nombre: "MDF Crudo", Slug: "mdf"},
	}
	got := rankearProductos(ps, "melamina blanca placas cortadas")
	if len(got) != 1 || got[0].Slug != "melamina-blanca" {
		t.Errorf("melamina: %+v", got)
	}
	tirantes := []ProductoBot{
		{Nombre: "Machimbre Pino", Slug: "machimbre"},
		{Nombre: "Tirante Pino Tratado", Slug: "tirante-pino"},
		{Nombre: "Membrana Asfáltica", Slug: "membrana"},
		{Nombre: "Tirante Saligna", Slug: "tirante-saligna"},
	}
	got = rankearProductos(tirantes, "sim prueba tirantes pino")
	if len(got) != 2 || got[0].Slug != "tirante-pino" || got[1].Slug != "tirante-saligna" {
		t.Errorf("tirantes: %+v", got)
	}
	herrajes := []ProductoBot{{Nombre: "Bisagra Cierre Suave"}, {Nombre: "Corredera Telescópica", Slug: "corredera"}, {Nombre: "Laca Poliuretánica"}}
	got = rankearProductos(herrajes, "stock corredera telescopica")
	if len(got) != 1 || got[0].Slug != "corredera" {
		t.Errorf("corredera: %+v", got)
	}
}

// M2S3-023: «hay en las dos sucursales» del Fenólico de 18, que no tenía.
func TestBotStockDeLaMedidaPedida(t *testing.T) {
	d := datosDePrueba
	d.StockVisible = true
	d.Productos = []ProductoBot{{Nombre: "Fenólico", Slug: "fenolico", Medidas: []string{"1220 x 2440mm — 15mm", "1220 x 2440mm — 18mm"},
		ConStock: []string{"Casa Central", "Aserradero"}, Sucursales: 2,
		StockPorMedida: map[string][]string{"1220 x 2440mm — 15mm": {"Casa Central", "Aserradero"}}}}
	r := Responder("Tienen fenólico de 18?", EstadoBot{}, d, true)
	if strings.Contains(r.Texto, "Hay en") || !strings.Contains(r.Texto, "Sin stock ahora") {
		t.Errorf("fenólico de 18: %q", r.Texto)
	}
	r = Responder("Tienen fenólico de 15?", EstadoBot{}, d, true)
	if !strings.Contains(r.Texto, "Hay en las dos sucursales") {
		t.Errorf("fenólico de 15: %q", r.Texto)
	}
}

func TestBotCortadoSumaElArmador(t *testing.T) {
	d := datosDePrueba
	d.Productos = []ProductoBot{{Nombre: "Melamina Blanca", Slug: "melamina-blanca", Medidas: []string{"18mm"}}, {Nombre: "Fenólico", Slug: "fenolico", Medidas: []string{"18mm"}}}
	r := Responder("Tienen melamina blanca de 18? necesito 3 placas cortadas", EstadoBot{}, d, true)
	if !strings.Contains(r.Texto, "https://mjbj.test/corte") || strings.Contains(r.Texto, "Fenólico") {
		t.Errorf("cortado: %q", r.Texto)
	}
}

func TestBotVariosProductosConPrecioPasaAPersona(t *testing.T) {
	d := datosDePrueba
	d.Productos = []ProductoBot{{Nombre: "MDF", Slug: "mdf", Medidas: []string{"18mm"}}}
	for _, texto := range []string{
		"Tienen MDF de 18? necesito 3 placas y 10 bisagras, me pasan precio?", // M3S2-019
		"Necesito 2 placas de melamina blanca 18 y 6 bisagras, me pasan presupuesto?",
	} {
		r := Responder(texto, EstadoBot{}, d, true)
		if !r.Derivar || !strings.Contains(r.Motivo, "bisagras") {
			t.Errorf("«%s»: derivar=%v motivo=%q", texto, r.Derivar, r.Motivo)
		}
	}
}

func TestBotReconoceElCorteArmado(t *testing.T) {
	r := Responder("Hola! les mandé este corte para presupuestar https://mjbj.iamnaw.dev/corte/c/p4n45uoiar76ibuu", EstadoBot{}, datosDePrueba, false)
	if r.CorteArmado != "p4n45uoiar76ibuu" || strings.Contains(r.Texto, "despiece") {
		t.Errorf("corte armado: %+v", r)
	}
}

func TestBajaDentroDeUnaFrase(t *testing.T) {
	for _, texto := range []string{"Hola, no quiero recibir más mensajes de ustedes. BAJA", "no quiero recibir mas mensajes", "STOP por favor"} {
		if !PideLaBaja(texto) {
			t.Errorf("«%s» no es baja", texto)
		}
	}
	for _, texto := range []string{"¿me das de baja el pedido de ayer?", "La baja de precio sigue?", "hola"} {
		if PideLaBaja(texto) {
			t.Errorf("«%s» es baja", texto)
		}
	}
}

func TestDerivarUsaElEnlaceCorto(t *testing.T) {
	d := datosDePrueba
	d.EnlaceHumano = "https://mjbj.test/api/whatsapp/hablar/abc"
	r := Responder("persona", EstadoBot{}, d, false)
	if !strings.Contains(r.Texto, d.EnlaceHumano) || strings.Contains(r.Texto, "wa.me") {
		t.Errorf("enlace: %q", r.Texto)
	}
	if got := textoDeDerivacion([]string{"me faltó una tabla", " ", "persona"}); !strings.Contains(got, "me faltó una tabla\npersona") {
		t.Errorf("texto: %q", got)
	}
}

// M3S3-029 y M3S1-017: el costado de la conversación trae el último cheque
// rechazado para la plantilla y dice si la cuenta está bloqueada.
func TestConversacionConChequeRechazadoYCuentaBloqueada(t *testing.T) {
	e := armar(t, false)
	var cliente, conv string
	if err := e.pool.QueryRow(e.ctx, `insert into customers (nombre, cuenta_bloqueada) values ('Sim Herrería del Faro', true) returning id`).Scan(&cliente); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(e.ctx, `insert into cheques (sentido, tipo, numero, banco, fecha_pago, importe, estado, motivo_rechazo, customer_id)
		values ('recibido', 'fisico', '00109101', 'Sim Banco Provincia', now(), 60000, 'rechazado', 'sin fondos', $1)`, cliente); err != nil {
		t.Fatal(err)
	}
	if err := e.pool.QueryRow(e.ctx, `insert into whatsapp_conversaciones (wa_jid, customer_id) values ('5492235550911', $1) returning id`, cliente).Scan(&conv); err != nil {
		t.Fatal(err)
	}
	d, err := e.wa.ObtenerConversacion(e.ctx, conv)
	if err != nil || d == nil {
		t.Fatal(err)
	}
	if d.Conocidos["cheque_rechazado:cheque"] != "Cheque Sim Banco Provincia N° 00109101" || !strings.HasSuffix(d.Conocidos["cheque_rechazado:importe"], "60.000") ||
		d.Conocidos["cheque_rechazado:motivo"] != "sin fondos" || d.Conocidos["importe"] != "" {
		t.Errorf("conocidos: %v", d.Conocidos)
	}
	if !d.ClienteBloqueado {
		t.Error("no dice que la cuenta está bloqueada")
	}
}

// M3S3-030: el aviso del último recibo es el del último cobro de plata, no
// el de un certificado de retención; con un cheque rechazado después, no hay
// aviso de recibo (va primero el de lo que debe).
func TestAvisoDelUltimoReciboDePlata(t *testing.T) {
	e := armar(t, false)
	var cliente, plata, retencion string
	if err := e.pool.QueryRow(e.ctx, `insert into customers (nombre, telefono) values ('Sim Herrería del Faro', '223 555-0911') returning id`).Scan(&cliente); err != nil {
		t.Fatal(err)
	}
	_ = e.pool.QueryRow(e.ctx, `insert into receipts (numero, recibido_de, total, origen, customer_id, created_at) values ('REC-0090', 'X', 60000, 'panel', $1, now() - interval '2 hours') returning id`, cliente).Scan(&plata)
	_, _ = e.pool.Exec(e.ctx, `insert into receipt_parts (receipt_id, medio, importe, orden) values ($1, 'transferencia', 60000, 0)`, plata)
	_ = e.pool.QueryRow(e.ctx, `insert into receipts (numero, recibido_de, total, origen, customer_id) values ('REC-0091', 'X', 1500, 'panel', $1) returning id`, cliente).Scan(&retencion)
	_, _ = e.pool.Exec(e.ctx, `insert into receipt_parts (receipt_id, medio, importe, orden) values ($1, 'retencion', 1500, 0)`, retencion)
	a, err := e.wa.AvisoDelUltimoRecibo(e.ctx, cliente)
	if err != nil || a == nil || a.Referencia == nil || !strings.Contains(*a.Referencia, "REC-0090") {
		t.Fatalf("aviso: %+v %v", a, err)
	}
	var cheque string
	_ = e.pool.QueryRow(e.ctx, `insert into cheques (sentido, tipo, numero, fecha_pago, importe, estado, customer_id) values ('recibido', 'fisico', '00109101', now(), 60000, 'rechazado', $1) returning id`, cliente).Scan(&cheque)
	_, _ = e.pool.Exec(e.ctx, `insert into account_movements (customer_id, tipo, monto, cheque_id, created_at) values ($1, 'nota_debito', 60000, $2, now() - interval '1 hour')`, cliente, cheque)
	if a, err := e.wa.AvisoDelUltimoRecibo(e.ctx, cliente); err != nil || a != nil {
		t.Fatalf("con el cheque rechazado después, no va el recibo: %+v %v", a, err)
	}
}

// M3S1-011: un dato que no existe no se guarda en el texto del aviso.
func TestTextoDelAvisoConDatosQueNoExisten(t *testing.T) {
	e := armar(t, false)
	if err := e.wa.SembrarAvisos(e.ctx); err != nil {
		t.Fatal(err)
	}
	var id string
	if err := e.pool.QueryRow(e.ctx, `select id from whatsapp_avisos where evento = 'entregado'`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	ses := &auth.Sesion{UserID: "nadie", Nombre: "Ana"}
	r, err := e.wa.GuardarTextoAviso(e.ctx, ses, id, "Hola {{nombr}}, Sim {{pedidoo}}")
	if err != nil || !strings.Contains(r.Error, "{{nombr}}, {{pedidoo}} no son datos") {
		t.Fatalf("variables malas: %+v %v", r, err)
	}
	var texto string
	_ = e.pool.QueryRow(e.ctx, `select texto_libre from whatsapp_avisos where id = $1`, id).Scan(&texto)
	if strings.Contains(texto, "nombr}") {
		t.Fatalf("se guardó: %q", texto)
	}
	if r, err := e.wa.GuardarTextoAviso(e.ctx, ses, id, "Hola {{nombre}}, entregamos {{pedido}}."); err != nil || r.Error != "" {
		t.Fatalf("texto bueno: %+v %v", r, err)
	}
}

// M3S2-018: el enlace de un corte armado en el sitio. El bot no pide el
// despiece de nuevo, ata la consulta a la conversación y la pasa a una
// persona.
func TestBotRecibeElCorteArmadoEnLaBandeja(t *testing.T) {
	b := armarBot(t)
	if _, err := b.pool.Exec(b.ctx, `insert into consultas_corte (token, material, placa_largo_mm, placa_ancho_mm, piezas, ancho_sierra_mm)
		values ('p4n45uoiar76ibuu', 'Melamina Blanca 18mm', 2600, 1830, '[{"largoMm":600,"anchoMm":400,"cantidad":4},{"largoMm":800,"anchoMm":300,"cantidad":2}]', 4)`); err != nil {
		t.Fatal(err)
	}
	jid := "5492235550703"
	b.texto(jid, "Hola! les mandé este corte para presupuestar https://mjbj.iamnaw.dev/corte/c/p4n45uoiar76ibuu")
	r := b.delBot(jid)
	if len(r) != 1 || !strings.Contains(r[0], "Recibimos tu corte: 6 piezas en *Melamina Blanca 18mm*") || strings.Contains(r[0], "despiece") {
		t.Fatalf("respuesta: %q", r)
	}
	var atada bool
	if err := b.pool.QueryRow(b.ctx, `select k.whatsapp_conversacion_id = c.id from consultas_corte k, whatsapp_conversaciones c
		where k.token = 'p4n45uoiar76ibuu' and c.wa_jid = $1`, jid).Scan(&atada); err != nil || !atada {
		t.Fatalf("la consulta no quedó atada a la conversación: %v", err)
	}
	if e := b.estado(jid); e != "derivada" {
		t.Errorf("estado: %s", e)
	}
}
