package whatsapp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// El adaptador de WhatsApp (lib/whatsapp/tipos.ts): la bandeja, los avisos y
// la ingesta solo conocen esta interfaz. Hay dos: la Cloud API de Meta
// (`cloud`, que también habla con el simulador si WHATSAPP_GRAPH_URL apunta a
// él) y la de demostración (`demo`), que no llama a nadie.

// EstadoConexion es lo que muestra el cartel de la bandeja.
type EstadoConexion struct {
	Conectado bool    `json:"conectado"`
	Proveedor string  `json:"proveedor"`
	Telefono  *string `json:"telefono"`
	// UltimaSenal en milisegundos (como Date.now()).
	UltimaSenal *int64  `json:"ultimaSenal"`
	Detalle     *string `json:"detalle"`
}

// ErrorDeEnvio es por qué no salió, dicho para la bandeja.
type ErrorDeEnvio struct {
	Codigo  *float64 `json:"codigo"`
	Texto   string   `json:"texto"`
	Accion  string   `json:"accion"`
	Detalle *string  `json:"detalle"`
}

// PlantillaRemota es una plantilla como la devuelve Meta.
type PlantillaRemota struct {
	MetaID            *string
	Nombre, Idioma    string
	Categoria         *string
	Estado            string
	MotivoRechazo     *string
	FormatoParametros string
	Componentes       []any
}

// PuntoDeDiagnostico es un punto del chequeo de la configuración.
type PuntoDeDiagnostico struct {
	Clave   string `json:"clave"`
	Titulo  string `json:"titulo"`
	Estado  string `json:"estado"`
	Detalle string `json:"detalle"`
}

// NumeroDiagnostico son los datos del número según Meta.
type NumeroDiagnostico struct {
	Telefono         *string `json:"telefono"`
	NombreVerificado *string `json:"nombreVerificado"`
	Calidad          *string `json:"calidad"`
	Limite           *string `json:"limite"`
	EstadoNombre     *string `json:"estadoNombre"`
	Plataforma       *string `json:"plataforma"`
}

// Diagnostico es el chequeo contra Meta.
type Diagnostico struct {
	Puntos []PuntoDeDiagnostico `json:"puntos"`
	Numero *NumeroDiagnostico   `json:"numero"`
}

// Proveedor habla con WhatsApp. Nunca devuelve un error de Go para afuera
// en Enviar ni SubirMedia: todo vuelve como ErrorDeEnvio, para mostrarlo.
type Proveedor interface {
	ID() string
	Estado(ctx context.Context) EstadoConexion
	Enviar(ctx context.Context, destino string, m Saliente) (string, *ErrorDeEnvio)
	SubirMedia(ctx context.Context, contenido []byte, mime, nombre string) (string, *ErrorDeEnvio)
	BajarMedia(ctx context.Context, mediaID string) ([]byte, string, error)
	MarcarLeido(ctx context.Context, waMessageID string)
	ListarPlantillas(ctx context.Context) ([]PlantillaRemota, error)
	Diagnosticar(ctx context.Context) Diagnostico
}

// --- demostración ---

// Demo se usa mientras no haya credenciales de Meta: acepta todo y no manda
// nada. El panel muestra un cartel permanente que lo dice.
type Demo struct{ telefono string }

func (d *Demo) ID() string { return "demo" }

func (d *Demo) Estado(context.Context) EstadoConexion {
	tel := d.telefono
	if tel == "" {
		tel = "+54 9 223 590-3118"
	}
	ahora := time.Now().UnixMilli()
	return EstadoConexion{Proveedor: "demo", Telefono: &tel, UltimaSenal: &ahora,
		Detalle: ptr("Modo demostración: los mensajes se guardan acá pero no salen a WhatsApp. Falta dar de alta el número en la Cloud API de Meta.")}
}

func (d *Demo) Enviar(context.Context, string, Saliente) (string, *ErrorDeEnvio) {
	return "demo-" + uuid(), nil
}

func (d *Demo) SubirMedia(context.Context, []byte, string, string) (string, *ErrorDeEnvio) {
	return "demo-media-" + uuid(), nil
}

func (d *Demo) BajarMedia(context.Context, string) ([]byte, string, error) {
	return nil, "", errors.New("En demostración no hay archivos de Meta para bajar.")
}

func (d *Demo) MarcarLeido(context.Context, string) {}

func (d *Demo) ListarPlantillas(context.Context) ([]PlantillaRemota, error) {
	out := []PlantillaRemota{}
	for _, p := range PlantillasBase {
		out = append(out, PlantillaRemota{Nombre: p.Nombre, Idioma: p.Idioma, Categoria: ptr(p.Categoria), Estado: "APPROVED",
			FormatoParametros: "NAMED", Componentes: p.Componentes})
	}
	return out, nil
}

func (d *Demo) Diagnosticar(context.Context) Diagnostico {
	return Diagnostico{Puntos: []PuntoDeDiagnostico{{"demo", "Modo demostración", "aviso",
		"No hay credenciales de Meta cargadas: la bandeja guarda todo pero no envía. Los pasos para conectar están en docs/WHATSAPP.md."}}}
}

// --- Cloud API ---

const (
	timeoutGraph = 15 * time.Second
	timeoutMedia = 60 * time.Second
)

// Cloud habla con la Graph API por HTTP, sin SDK. Todo llamado tiene timeout:
// una Graph API que no responde no puede colgar la bandeja ni la cola.
type Cloud struct {
	cfg     Config
	cliente *http.Client
}

// NuevoCloud arma el proveedor de la Cloud API.
func NuevoCloud(cfg Config) *Cloud { return &Cloud{cfg: cfg.limpia(), cliente: &http.Client{}} }

func (c *Cloud) ID() string { return "cloud" }

func (c *Cloud) url(ruta string) string {
	return c.cfg.GraphURL + "/" + c.cfg.GraphVersion + "/" + strings.TrimLeft(ruta, "/")
}

type errorGraph struct {
	codigo  *float64
	mensaje string
	detalle *string
}

// graph es un pedido a la Graph API. Nunca falla para afuera: el error vuelve
// en errorGraph.
func (c *Cloud) graph(ctx context.Context, metodo, ruta string, cuerpo io.Reader, tipo string, timeout time.Duration, destino any) *errorGraph {
	ctx, cancelar := context.WithTimeout(ctx, timeout)
	defer cancelar()
	req, err := http.NewRequestWithContext(ctx, metodo, c.url(ruta), cuerpo)
	if err != nil {
		return &errorGraph{mensaje: "No se pudo conectar con Meta.", detalle: ptr(err.Error())}
	}
	req.Header.Set("Authorization", "Bearer "+c.cfg.AccessToken)
	if tipo != "" {
		req.Header.Set("Content-Type", tipo)
	}
	res, err := c.cliente.Do(req)
	if err != nil {
		m := "No se pudo conectar con Meta."
		if errors.Is(err, context.DeadlineExceeded) {
			m = "Meta no respondió a tiempo."
		}
		return &errorGraph{mensaje: m, detalle: ptr(err.Error())}
	}
	defer res.Body.Close()
	crudo, _ := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	if res.StatusCode < 200 || res.StatusCode > 299 {
		var e struct {
			Error *struct {
				Code      any     `json:"code"`
				Message   *string `json:"message"`
				ErrorData *struct {
					Details *string `json:"details"`
				} `json:"error_data"`
			} `json:"error"`
		}
		_ = json.Unmarshal(crudo, &e)
		out := &errorGraph{mensaje: fmt.Sprintf("HTTP %d", res.StatusCode)}
		if e.Error != nil {
			if n, ok := e.Error.Code.(float64); ok {
				out.codigo = &n
			}
			if e.Error.Message != nil {
				out.mensaje = *e.Error.Message
			}
			if e.Error.ErrorData != nil && e.Error.ErrorData.Details != nil {
				out.detalle = e.Error.ErrorData.Details
			} else {
				out.detalle = e.Error.Message
			}
		}
		return out
	}
	if destino != nil {
		_ = json.Unmarshal(crudo, destino)
	}
	return nil
}

var reSinRespuesta = regexp.MustCompile(`responder|conectar`)

func errorDeEnvio(e *errorGraph) *ErrorDeEnvio {
	if e == nil {
		return &ErrorDeEnvio{Texto: "No se pudo enviar.", Accion: AccionReintentar}
	}
	if e.codigo == nil && reSinRespuesta.MatchString(e.mensaje) {
		d := e.mensaje
		if e.detalle != nil {
			d = *e.detalle
		}
		return &ErrorDeEnvio{Texto: "WhatsApp no respondió. El mensaje quedó guardado: volvé a probar en un momento.", Accion: AccionReintentar, Detalle: &d}
	}
	det := ""
	if e.detalle != nil {
		det = *e.detalle
	}
	x := ExplicarError(e.codigo, det)
	d := e.mensaje
	if e.detalle != nil {
		d = *e.detalle
	}
	return &ErrorDeEnvio{Codigo: x.Codigo, Texto: x.Texto, Accion: x.Accion, Detalle: &d}
}

func sinCredenciales() *ErrorDeEnvio {
	return &ErrorDeEnvio{Texto: "WhatsApp todavía no está conectado. Avisale a quien mantiene el sistema.", Accion: AccionSistema}
}

func (c *Cloud) Estado(context.Context) EstadoConexion {
	if !c.cfg.HayCloud() {
		return EstadoConexion{Proveedor: "cloud", Detalle: ptr("Faltan las credenciales de Meta en el servidor.")}
	}
	ahora := time.Now().UnixMilli()
	var tel, det *string
	if t := strings.TrimSpace(c.cfg.Telefono); t != "" {
		tel = &t
	}
	if c.cfg.UsaSimulador() {
		det = ptr("Conectado al simulador de Meta: los mensajes no salen a WhatsApp.")
	}
	return EstadoConexion{Conectado: true, Proveedor: "cloud", Telefono: tel, UltimaSenal: &ahora, Detalle: det}
}

func (c *Cloud) Enviar(ctx context.Context, destino string, m Saliente) (string, *ErrorDeEnvio) {
	if !c.cfg.HayCloud() {
		return "", sinCredenciales()
	}
	cuerpo, _ := json.Marshal(CuerpoDelMensaje(destino, m))
	var r struct {
		Messages []struct {
			ID string `json:"id"`
		} `json:"messages"`
	}
	if e := c.graph(ctx, http.MethodPost, c.cfg.PhoneNumberID+"/messages", bytes.NewReader(cuerpo), "application/json", timeoutGraph, &r); e != nil {
		return "", errorDeEnvio(e)
	}
	if len(r.Messages) == 0 || r.Messages[0].ID == "" {
		return "", errorDeEnvio(&errorGraph{mensaje: "Meta no devolvió el id del mensaje."})
	}
	return r.Messages[0].ID, nil
}

func (c *Cloud) SubirMedia(ctx context.Context, contenido []byte, mime, nombre string) (string, *ErrorDeEnvio) {
	if !c.cfg.HayCloud() {
		return "", sinCredenciales()
	}
	var b bytes.Buffer
	w := multipart.NewWriter(&b)
	_ = w.WriteField("messaging_product", "whatsapp")
	_ = w.WriteField("type", mime)
	h := make(textproto.MIMEHeader)
	h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename="%s"`, strings.ReplaceAll(nombre, `"`, "_")))
	h.Set("Content-Type", mime)
	parte, _ := w.CreatePart(h)
	_, _ = parte.Write(contenido)
	_ = w.Close()
	var r struct {
		ID string `json:"id"`
	}
	e := c.graph(ctx, http.MethodPost, c.cfg.PhoneNumberID+"/media", &b, w.FormDataContentType(), timeoutMedia, &r)
	if e != nil || r.ID == "" {
		return "", errorDeEnvio(e)
	}
	return r.ID, nil
}

func (c *Cloud) BajarMedia(ctx context.Context, mediaID string) ([]byte, string, error) {
	if !c.cfg.HayCloud() {
		return nil, "", errors.New("Faltan las credenciales de Meta.")
	}
	// Dos pasos: el id da una URL que vive unos minutos, y la URL se baja con
	// el mismo token. Por eso se guarda el archivo y no el enlace.
	var info struct {
		URL      string `json:"url"`
		MimeType string `json:"mime_type"`
	}
	if e := c.graph(ctx, http.MethodGet, url.PathEscape(mediaID), nil, "", timeoutGraph, &info); e != nil || info.URL == "" {
		if e != nil {
			return nil, "", errors.New(e.mensaje)
		}
		return nil, "", errors.New("Meta no devolvió la dirección del archivo.")
	}
	ctx, cancelar := context.WithTimeout(ctx, timeoutMedia)
	defer cancelar()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, info.URL, nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Authorization", "Bearer "+c.cfg.AccessToken)
	res, err := c.cliente.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return nil, "", fmt.Errorf("La descarga devolvió HTTP %d.", res.StatusCode)
	}
	contenido, err := io.ReadAll(io.LimitReader(res.Body, TamanoMaximoMedio+1))
	if err != nil {
		return nil, "", err
	}
	if len(contenido) == 0 {
		return nil, "", errors.New("El archivo llegó vacío.")
	}
	mime := info.MimeType
	if mime == "" {
		mime = res.Header.Get("Content-Type")
	}
	if mime == "" {
		mime = "application/octet-stream"
	}
	return contenido, mime, nil
}

func (c *Cloud) MarcarLeido(ctx context.Context, waMessageID string) {
	if !c.cfg.HayCloud() {
		return
	}
	cuerpo, _ := json.Marshal(obj{"messaging_product": "whatsapp", "status": "read", "message_id": waMessageID})
	_ = c.graph(ctx, http.MethodPost, c.cfg.PhoneNumberID+"/messages", bytes.NewReader(cuerpo), "application/json", timeoutGraph, nil)
}

const camposPlantilla = "id,name,language,status,category,parameter_format,rejected_reason,components"

func (c *Cloud) ListarPlantillas(ctx context.Context) ([]PlantillaRemota, error) {
	if !c.cfg.HayCloud() {
		return nil, errors.New("Faltan las credenciales de Meta.")
	}
	if c.cfg.WabaID == "" {
		return nil, errors.New("Falta WHATSAPP_BUSINESS_ACCOUNT_ID para leer las plantillas.")
	}
	out := []PlantillaRemota{}
	ruta := c.cfg.WabaID + "/message_templates?limit=100&fields=" + camposPlantilla
	// Meta pagina de a cien; diez páginas son mil plantillas, más que de sobra.
	for pagina := 0; ruta != "" && pagina < 10; pagina++ {
		var r struct {
			Data []struct {
				ID              *string `json:"id"`
				Name            string  `json:"name"`
				Language        string  `json:"language"`
				Status          string  `json:"status"`
				Category        *string `json:"category"`
				ParameterFormat string  `json:"parameter_format"`
				RejectedReason  string  `json:"rejected_reason"`
				Components      []any   `json:"components"`
			} `json:"data"`
			Paging *struct {
				Cursors *struct {
					After string `json:"after"`
				} `json:"cursors"`
				Next string `json:"next"`
			} `json:"paging"`
		}
		if e := c.graph(ctx, http.MethodGet, ruta, nil, "", timeoutGraph, &r); e != nil {
			return nil, errors.New(e.mensaje)
		}
		for _, p := range r.Data {
			if p.Name == "" || p.Language == "" {
				continue
			}
			estado := p.Status
			if estado == "" {
				estado = "UNKNOWN"
			}
			var motivo *string
			if p.RejectedReason != "" && p.RejectedReason != "NONE" {
				motivo = ptr(p.RejectedReason)
			}
			formatoP := "POSITIONAL"
			if p.ParameterFormat == "NAMED" {
				formatoP = "NAMED"
			}
			comps := p.Components
			if comps == nil {
				comps = []any{}
			}
			out = append(out, PlantillaRemota{MetaID: p.ID, Nombre: p.Name, Idioma: p.Language, Categoria: p.Category, Estado: estado,
				MotivoRechazo: motivo, FormatoParametros: formatoP, Componentes: comps})
		}
		ruta = ""
		if r.Paging != nil && r.Paging.Next != "" && r.Paging.Cursors != nil && r.Paging.Cursors.After != "" {
			ruta = c.cfg.WabaID + "/message_templates?limit=100&after=" + url.QueryEscape(r.Paging.Cursors.After) + "&fields=" + camposPlantilla
		}
	}
	return out, nil
}

var limites = map[string]string{
	"TIER_250": "250 personas por día", "TIER_1K": "1.000 personas por día", "TIER_2K": "2.000 personas por día",
	"TIER_10K": "10.000 personas por día", "TIER_100K": "100.000 personas por día", "TIER_UNLIMITED": "sin límite",
}

var calidades = map[string]string{
	"GREEN": "buena", "YELLOW": "media: hay clientes que marcan los mensajes como no deseados",
	"RED": "baja: Meta puede bajar el límite de mensajes", "UNKNOWN": "todavía sin calificar", "NA": "todavía sin calificar",
}

func oTexto(p *string, def string) string {
	if p == nil {
		return def
	}
	return *p
}

func (c *Cloud) Diagnosticar(ctx context.Context) Diagnostico {
	if !c.cfg.HayCloud() {
		return Diagnostico{Puntos: []PuntoDeDiagnostico{{"credenciales", "Credenciales", "error", "Faltan WHATSAPP_PHONE_NUMBER_ID y WHATSAPP_ACCESS_TOKEN en el servidor."}}}
	}
	puntos := []PuntoDeDiagnostico{}
	if c.cfg.UsaSimulador() {
		puntos = append(puntos, PuntoDeDiagnostico{"simulador", "Simulador", "aviso", "Se está hablando con " + c.cfg.GraphURL + ", no con Meta. Sirve para probar; nada sale a WhatsApp."})
	}

	// 1. El token: si `/me` no contesta, nada de lo demás va a andar.
	var yo struct {
		ID   *string `json:"id"`
		Name *string `json:"name"`
	}
	if e := c.graph(ctx, http.MethodGet, "me?fields=id,name", nil, "", timeoutGraph, &yo); e != nil {
		det := "Meta no aceptó el token: " + e.mensaje + "."
		if e.codigo != nil && *e.codigo == 190 {
			det = "Meta dice que el token venció o lo revocaron. Hay que generar uno permanente del usuario del sistema."
		}
		puntos = append(puntos, PuntoDeDiagnostico{"token", "Token de acceso", "error", det})
		return Diagnostico{Puntos: puntos}
	}
	puntos = append(puntos, PuntoDeDiagnostico{"token", "Token de acceso", "ok", "Válido, del usuario «" + oTexto(primero(yo.Name, yo.ID), "undefined") + "»."})

	// 2. El número.
	var n struct {
		DisplayPhoneNumber *string `json:"display_phone_number"`
		VerifiedName       *string `json:"verified_name"`
		QualityRating      *string `json:"quality_rating"`
		NameStatus         *string `json:"name_status"`
		PlatformType       *string `json:"platform_type"`
		Limite             *string `json:"whatsapp_business_manager_messaging_limit"`
	}
	var numero *NumeroDiagnostico
	if e := c.graph(ctx, http.MethodGet, c.cfg.PhoneNumberID+"?fields=display_phone_number,verified_name,quality_rating,code_verification_status,name_status,platform_type,whatsapp_business_manager_messaging_limit,throughput,status", nil, "", timeoutGraph, &n); e != nil {
		puntos = append(puntos, PuntoDeDiagnostico{"numero", "Número de teléfono", "error", "El WHATSAPP_PHONE_NUMBER_ID no corresponde a un número que este token pueda usar (" + e.mensaje + ")."})
	} else {
		numero = &NumeroDiagnostico{n.DisplayPhoneNumber, n.VerifiedName, n.QualityRating, n.Limite, n.NameStatus, n.PlatformType}
		otraPlataforma := !vacio(n.PlatformType) && *n.PlatformType != "CLOUD_API"
		if otraPlataforma {
			puntos = append(puntos, PuntoDeDiagnostico{"numero", "Número de teléfono", "error", oTexto(n.DisplayPhoneNumber, "undefined") + " está registrado en " + *n.PlatformType + ", no en la Cloud API."})
		} else {
			puntos = append(puntos, PuntoDeDiagnostico{"numero", "Número de teléfono", "ok", oTexto(n.DisplayPhoneNumber, "?") + " — " + oTexto(n.VerifiedName, "sin nombre verificado") + "."})
		}
		if !vacio(n.NameStatus) && *n.NameStatus != "APPROVED" && *n.NameStatus != "AVAILABLE_WITHOUT_REVIEW" {
			puntos = append(puntos, PuntoDeDiagnostico{"nombre", "Nombre visible", "aviso", "Meta todavía no aprobó el nombre que ven los clientes (estado " + *n.NameStatus + ")."})
		}
		calidad := oTexto(n.QualityRating, "UNKNOWN")
		estado := "ok"
		switch calidad {
		case "RED":
			estado = "error"
		case "YELLOW":
			estado = "aviso"
		}
		dicha, ok := calidades[calidad]
		if !ok {
			dicha = calidad
		}
		det := "La calidad es " + dicha + "."
		if !vacio(n.Limite) {
			l, ok := limites[*n.Limite]
			if !ok {
				l = *n.Limite
			}
			det += " Límite: " + l + " con mensajes iniciados por la maderera."
		}
		puntos = append(puntos, PuntoDeDiagnostico{"calidad", "Calidad del número", estado, det})
	}

	// 3. La cuenta (WABA): que exista, que el número sea suyo y que la app
	// esté suscripta, que es lo que hace que Meta mande el webhook.
	if c.cfg.WabaID == "" {
		puntos = append(puntos, PuntoDeDiagnostico{"waba", "Cuenta de WhatsApp Business", "error", "Falta WHATSAPP_BUSINESS_ACCOUNT_ID: sin eso no se leen las plantillas ni se verifica el webhook."})
	} else {
		var nums struct {
			Data []struct {
				ID string `json:"id"`
			} `json:"data"`
		}
		if e := c.graph(ctx, http.MethodGet, c.cfg.WabaID+"/phone_numbers?fields=id", nil, "", timeoutGraph, &nums); e != nil {
			puntos = append(puntos, PuntoDeDiagnostico{"waba", "Cuenta de WhatsApp Business", "error", "El WHATSAPP_BUSINESS_ACCOUNT_ID no es accesible con este token (" + e.mensaje + ")."})
		} else {
			suyo := false
			for _, x := range nums.Data {
				suyo = suyo || x.ID == c.cfg.PhoneNumberID
			}
			if suyo {
				puntos = append(puntos, PuntoDeDiagnostico{"waba", "Cuenta de WhatsApp Business", "ok", "El número pertenece a la cuenta configurada."})
			} else {
				puntos = append(puntos, PuntoDeDiagnostico{"waba", "Cuenta de WhatsApp Business", "error", "El número no pertenece a esa cuenta: el WHATSAPP_PHONE_NUMBER_ID o el WHATSAPP_BUSINESS_ACCOUNT_ID está mal."})
			}
		}
		var apps struct {
			Data []struct {
				Datos *struct {
					Name *string `json:"name"`
					ID   *string `json:"id"`
				} `json:"whatsapp_business_api_data"`
			} `json:"data"`
		}
		e := c.graph(ctx, http.MethodGet, c.cfg.WabaID+"/subscribed_apps", nil, "", timeoutGraph, &apps)
		switch {
		case e != nil:
			puntos = append(puntos, PuntoDeDiagnostico{"webhook", "Webhook suscripto", "error", "No se pudo consultar (" + e.mensaje + ")."})
		case len(apps.Data) > 0:
			nombres := []string{}
			for _, a := range apps.Data {
				if a.Datos == nil {
					nombres = append(nombres, "")
					continue
				}
				nombres = append(nombres, oTexto(primero(a.Datos.Name, a.Datos.ID), ""))
			}
			puntos = append(puntos, PuntoDeDiagnostico{"webhook", "Webhook suscripto", "ok", "Meta manda los avisos a: " + strings.Join(nombres, ", ") + "."})
		default:
			puntos = append(puntos, PuntoDeDiagnostico{"webhook", "Webhook suscripto", "error", "Ninguna app está suscripta a la cuenta: los mensajes de los clientes no van a llegar. Hay que hacer el POST a subscribed_apps (ver docs/WHATSAPP.md)."})
		}
	}
	if c.cfg.AppSecret == "" {
		puntos = append(puntos, PuntoDeDiagnostico{"firma", "Firma del webhook", "error", "Falta WHATSAPP_APP_SECRET: sin él se rechaza todo lo que llega por el webhook."})
	}
	return Diagnostico{Puntos: puntos, Numero: numero}
}
