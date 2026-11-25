package whatsapp

import (
	"regexp"
	"strings"

	"mjbj/internal/jsmath"
)

// El webhook de Meta traducido a eventos propios (lib/whatsapp/payload.ts).
// Puro: recibe el JSON tal como lo manda Meta y devuelve los eventos que la
// ingesta sabe guardar. Nada de lo que llega se considera confiable: todo
// campo se lee como opcional y con su tipo verificado, y una forma nueva
// termina en un evento «otro» o en nada, nunca en un pánico que trabe la cola.
// Ver el TS para la lista de tipos y los campos de la coexistencia.

// MediaMeta es un adjunto que llegó: un id para pedirle a la Graph API.
type MediaMeta struct {
	ID      string  `json:"id"`
	Tipo    string  `json:"tipo"`
	Mime    *string `json:"mime"`
	Nombre  *string `json:"nombre"`
	Sha256  *string `json:"sha256"`
	Voz     bool    `json:"voz"`
	Animado bool    `json:"animado"`
}

// Reaccion es un emoji sobre un mensaje (vacío = la sacó).
type Reaccion struct {
	AMensaje string `json:"aMensaje"`
	Emoji    string `json:"emoji"`
}

// MensajeMeta es un mensaje de Meta. Para y ParaUsuario son de los ecos;
// DelNegocio y EstadoHistorial, del historial.
type MensajeMeta struct {
	De           string
	UsuarioMeta  *string
	NombrePerfil *string
	WaMessageID  string
	Ocurrido     *float64
	Tipo         string
	TipoOriginal string
	Texto        string
	Media        *MediaMeta
	Citado       *string
	Reaccion     *Reaccion
	Datos        obj

	Para, ParaUsuario *string
	esEco             bool

	DelNegocio      bool
	EstadoHistorial *string
	esHistorial     bool
}

// JSON es el mensaje con la forma del TS (para los golden).
func (m MensajeMeta) JSON() obj {
	o := obj{
		"de": m.De, "usuarioMeta": m.UsuarioMeta, "nombrePerfil": m.NombrePerfil, "waMessageId": m.WaMessageID,
		"ocurrido": m.Ocurrido, "tipo": m.Tipo, "tipoOriginal": m.TipoOriginal, "texto": m.Texto,
		"media": m.Media, "citado": m.Citado, "reaccion": m.Reaccion, "datos": nilSiVacio(m.Datos),
	}
	if m.esEco {
		o["para"], o["paraUsuario"] = m.Para, m.ParaUsuario
	}
	if m.esHistorial {
		o["delNegocio"], o["estadoHistorial"] = m.DelNegocio, m.EstadoHistorial
	}
	return o
}

func nilSiVacio(o obj) any {
	if o == nil {
		return nil
	}
	return o
}

// ErrorMeta es el error de un estado `failed`.
type ErrorMeta struct {
	Codigo  *float64 `json:"codigo"`
	Titulo  string   `json:"titulo"`
	Detalle *string  `json:"detalle"`
}

// CobroMeta es lo que informa Meta sobre el cobro de un mensaje.
type CobroMeta struct {
	Categoria *string `json:"categoria"`
	Cobrable  *bool   `json:"cobrable"`
	Tipo      *string `json:"tipo"`
}

// EstadoMeta es un estado de entrega. Es también la carga del trabajo
// `whatsapp.estado`, con la forma del TS (la cola la comparten los dos).
type EstadoMeta struct {
	WaMessageID  string     `json:"waMessageId"`
	Estado       string     `json:"estado"`
	Ocurrido     *float64   `json:"ocurrido"`
	Destinatario *string    `json:"destinatario"`
	Error        *ErrorMeta `json:"error"`
	Cobro        *CobroMeta `json:"cobro"`
}

// HiloHistorial es un chat del historial de la app.
type HiloHistorial struct {
	WaID     string
	Mensajes []MensajeMeta
}

// ParteHistorial es una parte del historial.
type ParteHistorial struct {
	Fase, Orden, Progreso *float64
	Hilos                 []HiloHistorial
}

// ContactoApp es un contacto de la agenda del teléfono.
type ContactoApp struct {
	Telefono string  `json:"telefono"`
	Nombre   *string `json:"nombre"`
	Accion   string  `json:"accion"`
}

// Evento es lo que sale de un payload. Tipo dice qué campos valen.
type Evento struct {
	Tipo          string
	PhoneNumberID *string
	conNumero     bool

	Mensaje *MensajeMeta // mensaje, eco
	Estado  *EstadoMeta  // estado

	Cambio, Original string  // eco-cambio
	TextoCambio      *string // eco-cambio

	Parte    *ParteHistorial // historial
	Mensajes []MensajeMeta   // historial-medios

	Codigo  *float64 // historial-error
	Detalle string   // historial-error

	Contactos []ContactoApp // contactos

	EventoCuenta string  // cuenta
	Motivo       *string // cuenta, plantilla

	Nombre          string  // plantilla
	Idioma          *string // plantilla
	EstadoPlantilla string  // plantilla
	MetaID          *string // plantilla

	Telefono, EventoCalidad, Limite *string // calidad

	Campo string // otro
}

// TieneNumero dice si el evento trae el phone_number_id (los de la cuenta no).
func (e Evento) TieneNumero() bool { return e.conNumero }

// JSON es el evento con la forma del TS (para los golden).
func (e Evento) JSON() obj {
	o := obj{"tipo": e.Tipo}
	if e.conNumero {
		o["phoneNumberId"] = e.PhoneNumberID
	}
	switch e.Tipo {
	case "mensaje", "eco":
		o["mensaje"] = e.Mensaje.JSON()
	case "estado":
		o["estado"] = e.Estado
	case "eco-cambio":
		o["cambio"], o["original"], o["texto"] = e.Cambio, e.Original, e.TextoCambio
	case "historial":
		hilos := []any{}
		for _, h := range e.Parte.Hilos {
			ms := []any{}
			for _, m := range h.Mensajes {
				ms = append(ms, m.JSON())
			}
			hilos = append(hilos, obj{"waId": h.WaID, "mensajes": ms})
		}
		o["parte"] = obj{"fase": e.Parte.Fase, "orden": e.Parte.Orden, "progreso": e.Parte.Progreso, "hilos": hilos}
	case "historial-medios":
		ms := []any{}
		for _, m := range e.Mensajes {
			ms = append(ms, m.JSON())
		}
		o["mensajes"] = ms
	case "historial-error":
		o["codigo"], o["detalle"] = e.Codigo, e.Detalle
	case "contactos":
		o["contactos"] = e.Contactos
	case "cuenta":
		o["evento"], o["motivo"] = e.EventoCuenta, e.Motivo
	case "plantilla":
		o["nombre"], o["idioma"], o["estado"], o["motivo"], o["metaId"] = e.Nombre, e.Idioma, e.EstadoPlantilla, e.Motivo, e.MetaID
	case "calidad":
		o["telefono"], o["evento"], o["limite"] = e.Telefono, e.EventoCalidad, e.Limite
	case "otro":
		o["campo"] = e.Campo
	}
	return o
}

// --- lectura defensiva ---

// texto es el texto de un valor: un texto, o un número escrito como JS.
func texto(v any) *string {
	switch x := v.(type) {
	case string:
		return &x
	case float64:
		s := jsmath.Texto(x)
		return &s
	}
	return nil
}

func textoO(v any, def string) string {
	if t := texto(v); t != nil {
		return *t
	}
	return def
}

func primero(ps ...*string) *string {
	for _, p := range ps {
		if p != nil {
			return p
		}
	}
	return nil
}

var reNumero = regexp.MustCompile(`^-?\d+(\.\d+)?$`)

func numero(v any) *float64 {
	switch x := v.(type) {
	case float64:
		return &x
	case string:
		if reNumero.MatchString(x) {
			n := jsmath.Numero(x)
			return &n
		}
	}
	return nil
}

// epochMs: los timestamps de Meta son segundos Unix, como texto.
func epochMs(v any) *float64 {
	n := numero(v)
	if n == nil || !(*n > 0) {
		return nil
	}
	r := float64(*n * 1000)
	return &r
}

func vacio(p *string) bool { return p == nil || *p == "" }

var tiposMedia = map[string]bool{"image": true, "document": true, "audio": true, "video": true, "sticker": true}

var tiposConocidos = map[string]bool{
	"text": true, "image": true, "document": true, "audio": true, "video": true, "sticker": true,
	"location": true, "contacts": true, "interactive": true, "button": true, "reaction": true,
	"order": true, "system": true, "media_placeholder": true, "unsupported": true,
}

func leerMedia(m obj, tipo string) *MediaMeta {
	if !tiposMedia[tipo] {
		return nil
	}
	media := comoObj(m[tipo])
	id := texto(media["id"])
	if media == nil || vacio(id) {
		return nil
	}
	return &MediaMeta{ID: *id, Tipo: tipo, Mime: texto(media["mime_type"]), Nombre: texto(media["filename"]),
		Sha256: texto(media["sha256"]), Voz: media["voice"] == true, Animado: media["animated"] == true}
}

func unir(sep string, ps ...*string) string {
	partes := []string{}
	for _, p := range ps {
		if !vacio(p) {
			partes = append(partes, *p)
		}
	}
	return strings.Join(partes, sep)
}

func textoDeUbicacion(u obj) (string, obj) {
	lat, lng := numero(u["latitude"]), numero(u["longitude"])
	nombre, direccion := texto(u["name"]), texto(u["address"])
	t := "Ubicación"
	if p := unir(" — ", nombre, direccion); p != "" {
		t += ": " + p
	}
	var mapa *string
	if lat != nil && lng != nil {
		mapa = ptr("https://www.google.com/maps/search/?api=1&query=" + jsmath.Texto(*lat) + "," + jsmath.Texto(*lng))
	}
	return t, obj{"ubicacion": obj{"lat": lat, "lng": lng, "nombre": nombre, "direccion": direccion, "url": texto(u["url"]), "mapa": mapa}}
}

func textoDeContactos(contactos []any) (string, obj) {
	leidos := []any{}
	resumenes := []string{}
	for _, c := range contactos {
		o := comoObj(c)
		n := comoObj(o["name"])
		nombre := "Sin nombre"
		if p := primero(texto(n["formatted_name"]), texto(n["first_name"])); p != nil {
			nombre = *p
		}
		telefonos := []any{}
		var primerNumero string
		for _, p := range comoLista(o["phones"]) {
			t := comoObj(p)
			num := primero(texto(t["phone"]), texto(t["wa_id"]))
			if vacio(num) {
				continue
			}
			if len(telefonos) == 0 {
				primerNumero = *num
			}
			telefonos = append(telefonos, obj{"numero": num, "waId": texto(t["wa_id"])})
		}
		leidos = append(leidos, obj{"nombre": nombre, "telefonos": telefonos})
		r := nombre
		if primerNumero != "" {
			r += " (" + primerNumero + ")"
		}
		resumenes = append(resumenes, r)
	}
	resumen := strings.Join(resumenes, ", ")
	if resumen == "" {
		resumen = "sin datos"
	}
	etiqueta := "Contactos"
	if len(leidos) == 1 {
		etiqueta = "Contacto"
	}
	return etiqueta + ": " + resumen, obj{"contactos": leidos}
}

func leerContenido(m obj, tipo string) (string, obj, *Reaccion) {
	switch tipo {
	case "text":
		return textoO(comoObj(m["text"])["body"], ""), nil, nil
	case "image", "video", "document":
		return textoO(comoObj(m[tipo])["caption"], ""), nil, nil
	case "audio", "sticker":
		return "", nil, nil
	case "media_placeholder":
		return "(Un archivo del historial del teléfono. Si es de las últimas dos semanas, llega en un rato.)", nil, nil
	case "location":
		u := comoObj(m["location"])
		if u == nil {
			return "Ubicación", nil, nil
		}
		t, d := textoDeUbicacion(u)
		return t, d, nil
	case "contacts":
		t, d := textoDeContactos(comoLista(m["contacts"]))
		return t, d, nil
	case "interactive":
		i := comoObj(m["interactive"])
		boton, fila, nfm := comoObj(i["button_reply"]), comoObj(i["list_reply"]), comoObj(i["nfm_reply"])
		switch {
		case boton != nil:
			return textoO(boton["title"], ""), obj{"respuesta": obj{"tipo": "boton", "id": texto(boton["id"]), "titulo": texto(boton["title"])}}, nil
		case fila != nil:
			desc := texto(fila["description"])
			return unir(" — ", texto(fila["title"]), desc), obj{"respuesta": obj{"tipo": "lista", "id": texto(fila["id"]), "titulo": texto(fila["title"]), "descripcion": desc}}, nil
		case nfm != nil:
			return "Respondió un formulario de WhatsApp", obj{"respuesta": obj{"tipo": "formulario", "cuerpo": texto(nfm["response_json"])}}, nil
		}
		return "Respuesta a un mensaje con opciones", nil, nil
	case "button":
		b := comoObj(m["button"])
		return textoO(b["text"], ""), obj{"respuesta": obj{"tipo": "boton_plantilla", "id": texto(b["payload"]), "titulo": texto(b["text"])}}, nil
	case "reaction":
		r := comoObj(m["reaction"])
		a := texto(r["message_id"])
		if vacio(a) {
			return "", nil, nil
		}
		return "", nil, &Reaccion{*a, textoO(r["emoji"], "")}
	case "order":
		var o any
		if oo := comoObj(m["order"]); oo != nil {
			o = oo
		}
		items := comoLista(comoObj(o)["product_items"])
		palabra := "artículos"
		if len(items) == 1 {
			palabra = "artículo"
		}
		t := "Armó un pedido desde el catálogo de WhatsApp (" + jsmath.Texto(float64(len(items))) + " " + palabra + ")"
		if tx := texto(comoObj(o)["text"]); !vacio(tx) {
			t += ": " + *tx
		}
		return t, obj{"pedido": o}, nil
	case "system":
		s := comoObj(m["system"])
		return textoO(s["body"], "Aviso de WhatsApp sobre este número"),
			obj{"sistema": obj{"tipo": texto(s["type"]), "nuevoWaId": primero(texto(s["wa_id"]), texto(s["new_wa_id"]))}}, nil
	}
	// `unsupported` o un tipo que Meta agregó después.
	var e any
	if eo := comoObj(firstOf(comoLista(m["errors"]))); eo != nil {
		e = eo
	}
	eo := comoObj(e)
	motivo := primero(texto(eo["title"]), texto(comoObj(eo["error_data"])["details"]))
	t := "(Mandó un mensaje que WhatsApp no deja ver acá"
	if !vacio(motivo) {
		t += ": " + *motivo
	}
	t += ". Hay que pedirle que lo reenvíe de otra forma.)"
	return t, obj{"tipoOriginal": tipo, "error": e}, nil
}

func leerMensaje(m obj, nombres map[string]string, sinRemitente bool) *MensajeMeta {
	de := textoO(m["from"], "")
	usuario := texto(m["from_user_id"])
	id := texto(m["id"])
	if (de == "" && vacio(usuario) && !sinRemitente) || vacio(id) {
		return nil
	}
	tipoOriginal := textoO(m["type"], "unsupported")
	tipo := tipoOriginal
	if !tiposConocidos[tipo] {
		tipo = "unsupported"
	}
	t, datos, reaccion := leerContenido(m, tipoOriginal)
	contexto := comoObj(m["context"])
	conDato := func(k string, v any) {
		nuevo := obj{}
		for kk, vv := range datos {
			nuevo[kk] = vv
		}
		nuevo[k] = v
		datos = nuevo
	}
	if ref := comoObj(m["referral"]); ref != nil {
		conDato("anuncio", obj{"titulo": texto(ref["headline"]), "cuerpo": texto(ref["body"]), "url": texto(ref["source_url"]), "tipo": texto(ref["source_type"])})
	}
	if contexto["forwarded"] == true || contexto["frequently_forwarded"] == true {
		v := "si"
		if contexto["frequently_forwarded"] == true {
			v = "muchas"
		}
		conDato("reenviado", v)
	}
	if p := texto(comoObj(contexto["referred_product"])["product_retailer_id"]); !vacio(p) {
		conDato("productoConsultado", *p)
	}
	clave := de
	if clave == "" && !vacio(usuario) {
		clave = *usuario
	}
	var nombre *string
	if n, ok := nombres[clave]; ok {
		nombre = &n
	}
	return &MensajeMeta{
		De: de, UsuarioMeta: usuario, NombrePerfil: nombre, WaMessageID: *id, Ocurrido: epochMs(m["timestamp"]),
		Tipo: tipo, TipoOriginal: tipoOriginal, Texto: t, Media: leerMedia(m, tipoOriginal),
		Citado: texto(contexto["id"]), Reaccion: reaccion, Datos: datos,
	}
}

var estadosEntrega = map[string]bool{"sent": true, "delivered": true, "read": true, "played": true, "failed": true}

func leerEstado(s obj) *EstadoMeta {
	id, est := texto(s["id"]), texto(s["status"])
	if vacio(id) || vacio(est) || !estadosEntrega[*est] {
		return nil
	}
	out := &EstadoMeta{WaMessageID: *id, Estado: *est, Ocurrido: epochMs(s["timestamp"]), Destinatario: texto(s["recipient_id"])}
	if e := comoObj(firstOf(comoLista(s["errors"]))); e != nil {
		titulo := "Error sin descripción"
		if p := primero(texto(e["title"]), texto(e["message"])); p != nil {
			titulo = *p
		}
		out.Error = &ErrorMeta{Codigo: numero(e["code"]), Titulo: titulo,
			Detalle: primero(texto(comoObj(e["error_data"])["details"]), texto(e["message"]))}
	}
	if p := comoObj(s["pricing"]); p != nil {
		c := &CobroMeta{Categoria: texto(p["category"]), Tipo: texto(p["type"])}
		if b, ok := p["billable"].(bool); ok {
			c.Cobrable = &b
		}
		out.Cobro = c
	}
	return out
}

// LeerPayload son todos los eventos de un payload, en el orden en que
// vinieron. Un POST puede traer varias entradas y varios cambios.
func LeerPayload(crudo any) []Evento {
	raiz := comoObj(crudo)
	if raiz == nil || raiz["object"] != "whatsapp_business_account" {
		return []Evento{}
	}
	eventos := []Evento{}
	for _, entrada := range comoLista(raiz["entry"]) {
		for _, cc := range comoLista(comoObj(entrada)["changes"]) {
			cambio := comoObj(cc)
			campo := textoO(cambio["field"], "messages")
			valor := comoObj(cambio["value"])
			if valor == nil {
				continue
			}
			pnid := texto(comoObj(valor["metadata"])["phone_number_id"])
			conNumero := func(e Evento) Evento { e.PhoneNumberID, e.conNumero = pnid, true; return e }

			switch campo {
			case "messages":
				nombres := map[string]string{}
				for _, c := range comoLista(valor["contacts"]) {
					co := comoObj(c)
					n := texto(comoObj(co["profile"])["name"])
					if vacio(n) {
						continue
					}
					if w := texto(co["wa_id"]); !vacio(w) {
						nombres[*w] = *n
					}
					if u := texto(co["user_id"]); !vacio(u) {
						nombres[*u] = *n
					}
				}
				for _, s := range comoLista(valor["statuses"]) {
					if so := comoObj(s); so != nil {
						if e := leerEstado(so); e != nil {
							eventos = append(eventos, conNumero(Evento{Tipo: "estado", Estado: e}))
						}
					}
				}
				for _, m := range comoLista(valor["messages"]) {
					if mo := comoObj(m); mo != nil {
						if mm := leerMensaje(mo, nombres, false); mm != nil {
							eventos = append(eventos, conNumero(Evento{Tipo: "mensaje", Mensaje: mm}))
						}
					}
				}
			case "smb_message_echoes":
				for _, m := range comoLista(valor["message_echoes"]) {
					if e := leerEco(comoObj(m)); e != nil {
						eventos = append(eventos, conNumero(*e))
					}
				}
			case "history":
				for _, e := range leerHistorial(valor) {
					eventos = append(eventos, conNumero(e))
				}
			case "smb_app_state_sync":
				contactos := []ContactoApp{}
				for _, item := range comoLista(valor["state_sync"]) {
					o := comoObj(item)
					c := comoObj(o["contact"])
					tel := texto(c["phone_number"])
					if o == nil || textoO(o["type"], "") != "contact" || vacio(tel) {
						continue
					}
					contactos = append(contactos, ContactoApp{*tel, primero(texto(c["full_name"]), texto(c["first_name"])), textoO(o["action"], "add")})
				}
				if len(contactos) > 0 {
					eventos = append(eventos, conNumero(Evento{Tipo: "contactos", Contactos: contactos}))
				}
			case "account_update":
				if ev := texto(valor["event"]); !vacio(ev) {
					eventos = append(eventos, Evento{Tipo: "cuenta", EventoCuenta: *ev,
						Motivo: primero(texto(comoObj(valor["disconnection_info"])["reason"]), texto(valor["reason"]))})
				}
			case "message_template_status_update":
				n, est := texto(valor["message_template_name"]), texto(valor["event"])
				if !vacio(n) && !vacio(est) {
					eventos = append(eventos, Evento{Tipo: "plantilla", Nombre: *n, Idioma: texto(valor["message_template_language"]),
						EstadoPlantilla: *est, Motivo: primero(texto(valor["reason"]), texto(valor["other_info"])), MetaID: texto(valor["message_template_id"])})
				}
			case "phone_number_quality_update":
				eventos = append(eventos, Evento{Tipo: "calidad", Telefono: texto(valor["display_phone_number"]), EventoCalidad: texto(valor["event"]),
					Limite: primero(texto(valor["current_limit"]), texto(valor["messaging_limit_tier"]))})
			default:
				eventos = append(eventos, Evento{Tipo: "otro", Campo: campo})
			}
		}
	}
	return eventos
}

func leerEco(o obj) *Evento {
	if o == nil {
		return nil
	}
	tipo := textoO(o["type"], "")
	if tipo == "revoke" || tipo == "edit" {
		contenido := comoObj(o[tipo])
		original := texto(contenido["original_message_id"])
		if vacio(original) {
			return nil
		}
		var nuevo *string
		cambio := "eliminado"
		if tipo == "edit" {
			cambio = "editado"
			if m := comoObj(contenido["message"]); m != nil {
				t, _, _ := leerContenido(m, textoO(m["type"], "text"))
				nuevo = &t
			}
		}
		return &Evento{Tipo: "eco-cambio", Cambio: cambio, Original: *original, TextoCambio: nuevo}
	}
	para, paraUsuario := texto(o["to"]), texto(o["to_user_id"])
	if vacio(para) && vacio(paraUsuario) {
		return nil
	}
	m := leerMensaje(o, map[string]string{}, true)
	if m == nil {
		return nil
	}
	m.Para, m.ParaUsuario, m.esEco = para, paraUsuario, true
	return &Evento{Tipo: "eco", Mensaje: m}
}

func digitos(p *string) string {
	if p == nil {
		return ""
	}
	return SoloDigitos(*p)
}

// mismoTelefono: el mismo número, con o sin el 9 de los celulares argentinos.
func mismoTelefono(a, b string) bool {
	x, y := SoloDigitos(a), SoloDigitos(b)
	if x == "" || y == "" {
		return false
	}
	sinNueve := func(d string) string {
		if strings.HasPrefix(d, "549") {
			return "54" + d[3:]
		}
		return d
	}
	return sinNueve(x) == sinNueve(y)
}

func leerHistorial(valor obj) []Evento {
	eventos := []Evento{}
	negocio := texto(comoObj(valor["metadata"])["display_phone_number"])

	sueltos := []MensajeMeta{}
	for _, m := range comoLista(valor["messages"]) {
		if mo := comoObj(m); mo != nil {
			if mm := leerMensaje(mo, map[string]string{}, false); mm != nil && mm.Media != nil {
				sueltos = append(sueltos, *mm)
			}
		}
	}
	if len(sueltos) > 0 {
		eventos = append(eventos, Evento{Tipo: "historial-medios", Mensajes: sueltos})
	}

	for _, pc := range comoLista(valor["history"]) {
		parte := comoObj(pc)
		if parte == nil {
			continue
		}
		if e := comoObj(firstOf(comoLista(parte["errors"]))); e != nil {
			detalle := "Error del historial"
			if p := primero(texto(comoObj(e["error_data"])["details"]), texto(e["title"]), texto(e["message"])); p != nil {
				detalle = *p
			}
			eventos = append(eventos, Evento{Tipo: "historial-error", Codigo: numero(e["code"]), Detalle: detalle})
			continue
		}
		meta := comoObj(parte["metadata"])
		hilos := []HiloHistorial{}
		for _, hc := range comoLista(parte["threads"]) {
			hilo := comoObj(hc)
			waID := texto(hilo["id"])
			if hilo == nil || vacio(waID) {
				continue
			}
			ms := []MensajeMeta{}
			for _, m := range comoLista(hilo["messages"]) {
				o := comoObj(m)
				if o == nil {
					continue
				}
				leido := leerMensaje(o, map[string]string{}, false)
				if leido == nil {
					continue
				}
				if !vacio(negocio) {
					leido.DelNegocio = mismoTelefono(leido.De, *negocio)
				} else {
					leido.DelNegocio = !mismoTelefono(leido.De, *waID)
				}
				leido.EstadoHistorial = texto(comoObj(o["history_context"])["status"])
				leido.esHistorial = true
				ms = append(ms, *leido)
			}
			hilos = append(hilos, HiloHistorial{*waID, ms})
		}
		eventos = append(eventos, Evento{Tipo: "historial", Parte: &ParteHistorial{
			Fase: numero(meta["phase"]), Orden: numero(meta["chunk_order"]), Progreso: numero(meta["progress"]), Hilos: hilos}})
	}
	return eventos
}
