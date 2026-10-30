package pagos

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"math"
	"net/url"
	"strings"
	"time"
	"unicode/utf16"

	"mjbj/internal/jsmath"
	"mjbj/internal/zodjs"
)

// Lo puro de lib/pagos: la firma del webhook, el cuerpo de la preferencia,
// la traducción de un pago de Mercado Pago, los avisos y la decisión de
// acreditarPago. Golden: scripts/golden/checkout.ts.

// EstadoRemoto es el estado de un pago en nuestro vocabulario.
type EstadoRemoto = string

const (
	Pendiente   EstadoRemoto = "pendiente"
	Aprobado    EstadoRemoto = "aprobado"
	Rechazado   EstadoRemoto = "rechazado"
	Reintegrado EstadoRemoto = "reintegrado"
	Cancelado   EstadoRemoto = "cancelado"
)

// --- lib/pagos/firma.ts ---

// CabeceraFirma es lo que trae `x-signature`.
type CabeceraFirma struct {
	Ts string `json:"ts"`
	V1 string `json:"v1"`
}

// LeerCabeceraFirma parte `ts=…,v1=…`; nil si viene rota.
func LeerCabeceraFirma(cabecera string) *CabeceraFirma {
	if cabecera == "" {
		return nil
	}
	var ts, v1 string
	for _, parte := range strings.Split(cabecera, ",") {
		i := strings.Index(parte, "=")
		if i < 0 {
			continue
		}
		clave := zodjs.TrimJS(parte[:i])
		valor := zodjs.TrimJS(parte[i+1:])
		if clave == "ts" {
			ts = valor
		}
		if clave == "v1" {
			v1 = valor
		}
	}
	if ts == "" || v1 == "" {
		return nil
	}
	return &CabeceraFirma{ts, v1}
}

// ManifiestoFirma es el texto que firmó Mercado Pago, sin los segmentos que
// no vinieron.
func ManifiestoFirma(dataID, requestID *string, ts string) string {
	var b strings.Builder
	if dataID != nil && *dataID != "" {
		b.WriteString("id:" + *dataID + ";")
	}
	if requestID != nil && *requestID != "" {
		b.WriteString("request-id:" + *requestID + ";")
	}
	b.WriteString("ts:" + ts + ";")
	return b.String()
}

// DesfaseMaximo es la tolerancia del `ts` firmado.
const DesfaseMaximo = 5 * time.Minute

// FirmaValida dice si la firma es de Mercado Pago. Sin secreto, falso.
func FirmaValida(dataID, requestID *string, ts, v1, secreto string, ahora time.Time) bool {
	if secreto == "" {
		return false
	}
	marca := jsmath.Numero(ts)
	if math.IsNaN(marca) || math.IsInf(marca, 0) {
		return false
	}
	marcaMs := marca
	if !(marca > 1e12) {
		marcaMs = marca * 1000
	}
	if math.Abs(float64(ahora.UnixMilli())-marcaMs) > float64(DesfaseMaximo.Milliseconds()) {
		return false
	}
	m := hmac.New(sha256.New, []byte(secreto))
	m.Write([]byte(ManifiestoFirma(dataID, requestID, ts)))
	esperada := hex.EncodeToString(m.Sum(nil))
	recibida := strings.ToLower(zodjs.TrimJS(v1))
	if len(recibida) != len(esperada) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(esperada), []byte(recibida)) == 1
}

// DataIDDelAviso es el `data.id` que se firma: el de la query, o el del
// cuerpo, en minúsculas (app/api/pagos/webhook/route.ts).
func DataIDDelAviso(query url.Values, cuerpo any) *string {
	var id string
	if vs, ok := query["data.id"]; ok && len(vs) > 0 {
		id = vs[0]
	} else if m, ok := cuerpo.(map[string]any); ok {
		if d, ok := m["data"].(map[string]any); ok {
			if v, esta := d["id"]; esta {
				id = zodjs.TextoJS(v)
			}
		}
	}
	if id == "" {
		return nil
	}
	id = strings.ToLower(id)
	return &id
}

// --- lib/pagos/proveedor-mercadopago.ts ---

// TraducirEstado lleva un estado de Mercado Pago al nuestro.
func TraducirEstado(estado, detalle string) EstadoRemoto {
	switch estado {
	case "approved":
		return Aprobado
	case "refunded", "charged_back":
		return Reintegrado
	case "cancelled":
		return Cancelado
	case "rejected":
		return Rechazado
	case "pending", "in_process", "in_mediation", "authorized":
		return Pendiente
	}
	if detalle == "accredited" {
		return Aprobado
	}
	return Pendiente
}

// ItemPreferencia es un renglón del checkout.
type ItemPreferencia struct {
	Titulo         string  `json:"titulo"`
	Cantidad       float64 `json:"cantidad"`
	PrecioUnitario float64 `json:"precioUnitario"`
}

// Pagador es quien paga, si se sabe.
type Pagador struct {
	Nombre *string `json:"nombre"`
	Email  *string `json:"email"`
}

// SolicitudPreferencia es lo que se le pide al proveedor.
type SolicitudPreferencia struct {
	Referencia  string            `json:"referencia"`
	Descripcion string            `json:"descripcion"`
	Monto       float64           `json:"monto"`
	Items       []ItemPreferencia `json:"items"`
	Pagador     *Pagador          `json:"pagador"`
	URLRetorno  string            `json:"urlRetorno"`
	URLWebhook  string            `json:"urlWebhook"`
}

type itemMP struct {
	ID         string  `json:"id"`
	Title      string  `json:"title"`
	Quantity   float64 `json:"quantity"`
	UnitPrice  float64 `json:"unit_price"`
	CurrencyID string  `json:"currency_id"`
}

type payerMP struct {
	Name  *string `json:"name,omitempty"`
	Email string  `json:"email"`
}

// CuerpoPreferencia es el JSON de POST /checkout/preferences.
type CuerpoPreferencia struct {
	Items               []itemMP          `json:"items"`
	Payer               *payerMP          `json:"payer,omitempty"`
	ExternalReference   string            `json:"external_reference"`
	StatementDescriptor string            `json:"statement_descriptor"`
	NotificationURL     string            `json:"notification_url"`
	BackURLs            map[string]string `json:"back_urls"`
	AutoReturn          string            `json:"auto_return"`
}

// cortarUTF16 es .slice(0, n) de JS: cuenta unidades UTF-16.
func cortarUTF16(s string, n int) string {
	u := utf16.Encode([]rune(s))
	if len(u) <= n {
		return s
	}
	return string(utf16.Decode(u[:n]))
}

// ArmarPreferencia es el cuerpo que armaba crearPreferencia.
func ArmarPreferencia(s SolicitudPreferencia) CuerpoPreferencia {
	items := make([]itemMP, len(s.Items))
	for i, it := range s.Items {
		items[i] = itemMP{
			ID: s.Referencia, Title: cortarUTF16(it.Titulo, 250), Quantity: math.Max(1, jsmath.Round(it.Cantidad)),
			UnitPrice: jsmath.Numero(jsmath.ToFixed(it.PrecioUnitario, 2)), CurrencyID: "ARS",
		}
	}
	var payer *payerMP
	if s.Pagador != nil && s.Pagador.Email != nil && *s.Pagador.Email != "" {
		payer = &payerMP{Name: s.Pagador.Nombre, Email: *s.Pagador.Email}
	}
	return CuerpoPreferencia{
		Items: items, Payer: payer, ExternalReference: s.Referencia, StatementDescriptor: "MADERERA JBJ",
		NotificationURL: s.URLWebhook,
		BackURLs:        map[string]string{"success": s.URLRetorno, "pending": s.URLRetorno, "failure": s.URLRetorno},
		AutoReturn:      "approved",
	}
}

// PagoRemoto es lo que el proveedor dice de un pago.
type PagoRemoto struct {
	ID            string       `json:"id"`
	Estado        EstadoRemoto `json:"estado"`
	Monto         *float64     `json:"monto"`
	Medio         *string      `json:"medio"`
	Referencia    *string      `json:"referencia"`
	MotivoRechazo *string      `json:"motivoRechazo"`
	// Reintegrado es lo devuelto hasta ahora (transaction_amount_refunded de
	// Mercado Pago): con el pago aprobado, es un reintegro parcial.
	Reintegrado float64         `json:"reintegrado,omitempty"`
	Crudo       json.RawMessage `json:"crudo"`
}

func cadena(v any) (string, bool) {
	s, ok := v.(string)
	return s, ok
}

// PagoDeMercadoPago traduce la respuesta de GET /v1/payments/{id}; nil si
// no trae id.
func PagoDeMercadoPago(crudo json.RawMessage) *PagoRemoto {
	var p map[string]any
	if json.Unmarshal(crudo, &p) != nil || p == nil {
		return nil
	}
	id, esta := p["id"]
	switch x := id.(type) {
	case nil:
		return nil
	case string:
		if x == "" {
			return nil
		}
	case float64:
		if x == 0 {
			return nil
		}
	case bool:
		if !x {
			return nil
		}
	}
	if !esta {
		return nil
	}
	estado, _ := cadena(p["status"])
	detalle, hayDetalle := cadena(p["status_detail"])
	monto := 0.0
	if v, esta := p["transaction_amount"]; esta && v != nil {
		monto = zodjs.NumeroJS(v, true)
	}
	r := &PagoRemoto{ID: zodjs.TextoJS(id), Estado: TraducirEstado(estado, detalle), Monto: &monto, Crudo: crudo}
	if m, ok := cadena(p["payment_method_id"]); ok {
		r.Medio = &m
	} else if m, ok := cadena(p["payment_type_id"]); ok {
		r.Medio = &m
	}
	if ref, ok := cadena(p["external_reference"]); ok {
		r.Referencia = &ref
	}
	if estado != "approved" && hayDetalle {
		r.MotivoRechazo = &detalle
	}
	if v, esta := p["transaction_amount_refunded"]; esta && v != nil {
		if n := zodjs.NumeroJS(v, true); n > 0 && !math.IsNaN(n) && !math.IsInf(n, 0) {
			r.Reintegrado = n
		}
	}
	return r
}

// ReintegroParcial es cuánto de un reintegro parcial falta devolver: Mercado
// Pago deja el pago aprobado y acumula lo devuelto en
// transaction_amount_refunded (status_detail «partially_refunded»). Se aplica
// solo la diferencia con lo que ya se devolvió, así el mismo aviso repetido,
// o el de un segundo reintegro, devuelve cada peso una sola vez. Cero si no
// hay nada nuevo; lo devuelto nunca pasa del importe del pago.
func ReintegroParcial(actual string, nuestro float64, r *PagoRemoto, yaDevuelto float64) float64 {
	if r == nil || actual != Aprobado || r.Estado != Aprobado || r.Reintegrado <= 0 {
		return 0
	}
	acumulado := math.Min(r.Reintegrado, nuestro)
	falta := jsmath.Round(float64(float64(acumulado-yaDevuelto)*100)) / 100
	if falta < 0.01 {
		return 0
	}
	return falta
}

// AvisoEntrante es qué pago hay que ir a consultar.
type AvisoEntrante struct {
	EventoID     string `json:"eventoId"`
	Tipo         string `json:"tipo"`
	PagoRemotoID string `json:"pagoRemotoId"`
}

func objeto(v any) map[string]any {
	m, _ := v.(map[string]any)
	if m == nil {
		return map[string]any{}
	}
	return m
}

func primero(q url.Values, k string) (string, bool) {
	vs, ok := q[k]
	if !ok || len(vs) == 0 {
		return "", false
	}
	return vs[0], true
}

// InterpretarAvisoMP es interpretarAviso de Mercado Pago: nil si no es de
// un pago.
func InterpretarAvisoMP(cuerpo any, query url.Values) *AvisoEntrante {
	d := objeto(cuerpo)
	tipo := ""
	if v, esta := d["type"]; esta && v != nil {
		s, ok := v.(string)
		if !ok {
			return nil
		}
		tipo = s
	} else if s, ok := primero(query, "type"); ok {
		tipo = s
	}
	if tipo != "" && tipo != "payment" {
		return nil
	}
	var pago string
	hay := false
	if data, ok := d["data"].(map[string]any); ok {
		if v := data["id"]; v != nil {
			pago, hay = zodjs.TextoJS(v), true
		}
	}
	if !hay {
		if s, ok := primero(query, "data.id"); ok {
			pago, hay = s, true
		} else if s, ok := primero(query, "id"); ok {
			pago, hay = s, true
		}
	}
	if !hay || pago == "" {
		return nil
	}
	accion, hayAccion := d["action"].(string)
	evento := pago + "-payment"
	if hayAccion {
		evento = pago + "-" + accion
	}
	if v := d["id"]; v != nil {
		evento = zodjs.TextoJS(v)
	}
	t := tipo
	if hayAccion {
		t = accion
	}
	return &AvisoEntrante{EventoID: evento, Tipo: t, PagoRemotoID: pago}
}

// --- lib/pagos/proveedor-demo.ts ---

const prefijoDemo = "demo-"

// IDSimulado es el id del pago de demostración: el estado va adentro.
func IDSimulado(pagoID string, estado EstadoRemoto) string {
	return prefijoDemo + pagoID + "-" + estado
}

// ConsultarDemo lee el estado del id simulado; nil si no es uno.
func ConsultarDemo(id string) *PagoRemoto {
	if !strings.HasPrefix(id, prefijoDemo) {
		return nil
	}
	resto := id[len(prefijoDemo):]
	corte := strings.LastIndex(resto, "-")
	if corte < 0 {
		return nil
	}
	pagoID, estado := resto[:corte], resto[corte+1:]
	switch estado {
	case Pendiente, Aprobado, Rechazado, Reintegrado, Cancelado:
	default:
		return nil
	}
	medio := "simulado"
	r := &PagoRemoto{ID: id, Estado: estado, Medio: &medio, Referencia: &pagoID}
	if estado == Rechazado {
		m := "Rechazo simulado desde la demo"
		r.MotivoRechazo = &m
	}
	r.Crudo, _ = json.Marshal(map[string]any{"demo": true, "id": id, "estado": estado})
	return r
}

// InterpretarAvisoDemo es interpretarAviso del proveedor de demostración.
func InterpretarAvisoDemo(cuerpo any) *AvisoEntrante {
	d := objeto(cuerpo)
	data, ok := d["data"].(map[string]any)
	if !ok || data["id"] == nil {
		return nil
	}
	pago := zodjs.TextoJS(data["id"])
	evento := pago
	if v := d["id"]; v != nil {
		evento = zodjs.TextoJS(v)
	}
	return &AvisoEntrante{EventoID: evento, Tipo: "payment", PagoRemotoID: pago}
}

// --- lib/pagos/acreditar.ts ---

// Tolerancia es la diferencia de importe que se acepta.
const Tolerancia = 0.5

// Decision es qué hace acreditarPago con un aviso.
type Decision string

const (
	Igual    Decision = "igual"    // ya estaba en ese estado: reintento
	Ignorar  Decision = "ignorar"  // aprobado que no pasa a reintegrado
	Revision Decision = "revision" // el importe no coincide
	Aplicar  Decision = "aplicar"
)

// Decidir es la primera mitad de acreditarPago, sin la base.
func Decidir(actual string, nuestro float64, estado EstadoRemoto, monto *float64) (Decision, string) {
	if actual == estado {
		return Igual, ""
	}
	if actual == Aprobado && estado != Reintegrado {
		return Ignorar, ""
	}
	if estado == Aprobado && monto != nil && math.Abs(float64(*monto-nuestro)) > Tolerancia {
		return Revision, "El proveedor informó $" + jsmath.ToFixed(*monto, 2) + " y el cobro es de $" + jsmath.ToFixed(nuestro, 2) + "."
	}
	return Aplicar, ""
}
