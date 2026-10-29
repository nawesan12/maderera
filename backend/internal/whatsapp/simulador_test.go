package whatsapp

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// simulador es la Graph API de Meta para las pruebas: lo mismo que
// scripts/simulador-meta.ts (mandar, subir y bajar archivos, plantillas, el
// número y la cuenta) y lo que hace Meta después de un envío: mandarle a la
// aplicación los estados, firmados, por el webhook de verdad.
type simulador struct {
	t        *testing.T
	srv      *httptest.Server
	app      string // la URL del webhook de la aplicación
	secreto  string
	pnid     string
	waba     string
	mu       sync.Mutex
	enviados []map[string]any
	medios   map[string][]byte
	tipos    map[string]string
	// proximoError hace fallar el próximo envío con ese código de Meta.
	proximoError int
	contador     int
	// pendientes son los estados por avisar (los manda avisarEstados).
	pendientes []map[string]any
}

const (
	pnidPrueba    = "106540352242922"
	wabaPrueba    = "102290129340398"
	secretoPrueba = "secreto-de-prueba"
	tokenPrueba   = "token-de-prueba"
)

func nuevoSimulador(t *testing.T) *simulador {
	s := &simulador{t: t, secreto: secretoPrueba, pnid: pnidPrueba, waba: wabaPrueba,
		medios: map[string][]byte{}, tipos: map[string]string{}}
	// Un adjunto que ya «mandó» un cliente.
	s.medios["1037543291543636"] = []byte("\x89PNG\r\n\x1a\nfoto de la cocina")
	s.tipos["1037543291543636"] = "image/png"
	s.srv = httptest.NewServer(http.HandlerFunc(s.atender))
	t.Cleanup(s.srv.Close)
	return s
}

func (s *simulador) responder(w http.ResponseWriter, estado int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(estado)
	_ = json.NewEncoder(w).Encode(v)
}

func (s *simulador) errorMeta(w http.ResponseWriter, codigo int, mensaje, detalle string) {
	estado := 400
	if codigo == 190 {
		estado = 401
	}
	e := map[string]any{"message": mensaje, "type": "OAuthException", "code": codigo}
	if detalle != "" {
		e["error_data"] = map[string]any{"messaging_product": "whatsapp", "details": detalle}
	}
	s.responder(w, estado, map[string]any{"error": e})
}

func (s *simulador) atender(w http.ResponseWriter, r *http.Request) {
	partes := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if partes[0] == "_medio" {
		s.mu.Lock()
		b, ok := s.medios[partes[1]]
		tipo := s.tipos[partes[1]]
		s.mu.Unlock()
		if !ok {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", tipo)
		_, _ = w.Write(b)
		return
	}
	if r.Header.Get("Authorization") != "Bearer "+tokenPrueba {
		s.errorMeta(w, 190, "Invalid OAuth access token - Cannot parse access token", "")
		return
	}
	ruta := partes[1:] // la versión va primero
	switch {
	case ruta[0] == "me":
		s.responder(w, 200, map[string]any{"id": "122100000000001", "name": "Sistema MJBJ"})
	case ruta[0] == s.pnid && len(ruta) == 1:
		s.responder(w, 200, map[string]any{"id": s.pnid, "display_phone_number": "+54 9 223 590-3118", "verified_name": "Maderera Juan B. Justo",
			"quality_rating": "GREEN", "name_status": "APPROVED", "platform_type": "CLOUD_API", "whatsapp_business_manager_messaging_limit": "TIER_250"})
	case ruta[0] == s.waba && ruta[1] == "phone_numbers":
		s.responder(w, 200, map[string]any{"data": []any{map[string]any{"id": s.pnid}}})
	case ruta[0] == s.waba && ruta[1] == "subscribed_apps":
		s.responder(w, 200, map[string]any{"data": []any{map[string]any{"whatsapp_business_api_data": map[string]any{"name": "MJBJ Plataforma", "id": "1"}}}})
	case ruta[0] == s.waba && ruta[1] == "message_templates":
		data := []any{}
		for i, p := range PlantillasBase {
			estado := "APPROVED"
			if p.Nombre == "cheque_rechazado" {
				estado = "PENDING"
			}
			data = append(data, map[string]any{"id": fmt.Sprint(594425479261596 + i), "name": p.Nombre, "language": p.Idioma, "status": estado,
				"category": p.Categoria, "parameter_format": "NAMED", "components": p.Componentes})
		}
		data = append(data, map[string]any{"id": "1192339204654487", "name": "hello_world", "language": "en_US", "status": "APPROVED",
			"category": "UTILITY", "parameter_format": "POSITIONAL", "components": []any{
				map[string]any{"type": "HEADER", "format": "TEXT", "text": "Hello World"},
				map[string]any{"type": "BODY", "text": "Welcome and congratulations!!"}}})
		s.responder(w, 200, map[string]any{"data": data, "paging": map[string]any{"cursors": map[string]any{"before": "a", "after": "b"}}})
	case ruta[0] == s.pnid && ruta[1] == "media" && r.Method == http.MethodPost:
		if err := r.ParseMultipartForm(32 << 20); err != nil || r.FormValue("messaging_product") != "whatsapp" {
			s.errorMeta(w, 100, "(#100) The parameter file is required.", "")
			return
		}
		f, _, err := r.FormFile("file")
		if err != nil {
			s.errorMeta(w, 100, "(#100) The parameter file is required.", "")
			return
		}
		b, _ := io.ReadAll(f)
		s.mu.Lock()
		s.contador++
		id := fmt.Sprintf("77%08d", s.contador)
		s.medios[id], s.tipos[id] = b, r.FormValue("type")
		s.mu.Unlock()
		s.responder(w, 200, map[string]any{"id": id})
	case ruta[0] == s.pnid && ruta[1] == "messages" && r.Method == http.MethodPost:
		var cuerpo map[string]any
		_ = json.NewDecoder(r.Body).Decode(&cuerpo)
		if cuerpo["status"] == "read" {
			s.mu.Lock()
			s.enviados = append(s.enviados, cuerpo)
			s.mu.Unlock()
			s.responder(w, 200, map[string]any{"success": true})
			return
		}
		para := fmt.Sprint(cuerpo["to"])
		if cuerpo["to"] == nil {
			para = fmt.Sprint(cuerpo["recipient"])
		}
		s.mu.Lock()
		codigo := s.proximoError
		s.proximoError = 0
		s.mu.Unlock()
		if codigo != 0 {
			s.errorMeta(w, codigo, fmt.Sprintf("(#%d) Re-engagement message", codigo), "Message failed to send because more than 24 hours have passed since the customer last replied to this number.")
			return
		}
		s.mu.Lock()
		s.contador++
		id := fmt.Sprintf("wamid.SIM%d", s.contador)
		cuerpo["id"] = id
		s.enviados = append(s.enviados, cuerpo)
		categoria := "service"
		if cuerpo["type"] == "template" {
			categoria = "utility"
		}
		for _, e := range []string{"sent", "delivered", "read"} {
			s.pendientes = append(s.pendientes, estadoMeta(s.pnid, id, e, para, categoria))
		}
		s.mu.Unlock()
		s.responder(w, 200, map[string]any{"messaging_product": "whatsapp", "contacts": []any{map[string]any{"input": para, "wa_id": para}},
			"messages": []any{map[string]any{"id": id}}})
	case len(ruta) == 1 && r.Method == http.MethodGet:
		s.mu.Lock()
		_, ok := s.medios[ruta[0]]
		tipo := s.tipos[ruta[0]]
		s.mu.Unlock()
		if !ok || strings.HasSuffix(ruta[0], "0000") {
			s.errorMeta(w, 100, "(#100) Invalid parameter", "Media not found or expired.")
			return
		}
		s.responder(w, 200, map[string]any{"url": s.srv.URL + "/_medio/" + ruta[0], "mime_type": tipo, "id": ruta[0]})
	default:
		s.errorMeta(w, 100, "(#100) Unsupported request: "+r.Method+" "+r.URL.Path, "")
	}
}

func envolverPayload(pnid, campo string, valor map[string]any) map[string]any {
	valor["messaging_product"] = "whatsapp"
	valor["metadata"] = map[string]any{"display_phone_number": "5492235903118", "phone_number_id": pnid}
	return map[string]any{"object": "whatsapp_business_account", "entry": []any{map[string]any{"id": wabaPrueba,
		"changes": []any{map[string]any{"field": campo, "value": valor}}}}}
}

func estadoMeta(pnid, id, estado, para, categoria string) map[string]any {
	return envolverPayload(pnid, "messages", map[string]any{"statuses": []any{map[string]any{
		"id": id, "status": estado, "timestamp": fmt.Sprint(time.Now().Unix()), "recipient_id": para,
		"pricing": map[string]any{"billable": true, "pricing_model": "PMP", "category": categoria, "type": "regular"},
	}}})
}

func mensajeDeCliente(pnid, de, nombre, id, tipo string, contenido map[string]any) map[string]any {
	m := map[string]any{"from": de, "id": id, "timestamp": fmt.Sprint(time.Now().Unix()), "type": tipo}
	for k, v := range contenido {
		m[k] = v
	}
	return envolverPayload(pnid, "messages", map[string]any{
		"contacts": []any{map[string]any{"profile": map[string]any{"name": nombre}, "wa_id": de}},
		"messages": []any{m},
	})
}

// aLaApp le manda un payload a la aplicación, firmado como lo firma Meta.
func (s *simulador) aLaApp(payload any, secreto string) int {
	cuerpo, _ := json.Marshal(payload)
	req, _ := http.NewRequest(http.MethodPost, s.app, bytes.NewReader(cuerpo))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Hub-Signature-256", Firmar(cuerpo, secreto))
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		s.t.Fatal(err)
	}
	res.Body.Close()
	return res.StatusCode
}

// avisarEstados manda los estados de lo que se envió (sent, delivered, read).
func (s *simulador) avisarEstados() int {
	s.mu.Lock()
	p := s.pendientes
	s.pendientes = nil
	s.mu.Unlock()
	for _, e := range p {
		if c := s.aLaApp(e, s.secreto); c != 200 {
			s.t.Fatalf("el webhook contestó %d", c)
		}
	}
	return len(p)
}

func (s *simulador) ultimoEnviado() map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.enviados) == 0 {
		return nil
	}
	return s.enviados[len(s.enviados)-1]
}

func (s *simulador) cuantosEnviados() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.enviados)
}
