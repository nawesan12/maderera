// Package simulador es un ARCA de mentira para las pruebas y el benchmark:
// el WSAA (loginCms) y el WSFEv1 (FEDummy, FECompUltimoAutorizado,
// FECAESolicitar, FECompConsultar) contestando los XML de homologación.
//
// No es un ARCA completo: controla lo que el sistema puede hacer mal y ARCA
// rechazaría —el CMS mal firmado, pedir un ticket nuevo con uno vigente, un
// número que no es el siguiente, importes que no cierran, IVA en una C, una
// nota sin comprobante asociado, sin CondicionIVAReceptorId— con la forma de
// respuesta de la documentación de ARCA (manual del desarrollador de
// WSFEv1, RG 4291, y el de WSAA). Los mensajes son los de homologación; los
// códigos marcados con «sim» no están confirmados contra ARCA.
package simulador

import (
	"bytes"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/asn1"
	"encoding/base64"
	"encoding/pem"
	"encoding/xml"
	"errors"
	"io"
	"math"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/smallstep/pkcs7"
)

// Simulador guarda lo autorizado por punto de venta y tipo.
type Simulador struct {
	// Demora es lo que tarda cada respuesta (ARCA tarda 100–600 ms), más un
	// azar de hasta Variacion: con la demora pareja los pedidos llegan siempre
	// en orden, y con ARCA de verdad no.
	Demora    time.Duration
	Variacion time.Duration
	// DuracionTicket es la vigencia del ticket (12 h en ARCA).
	DuracionTicket time.Duration
	// Ahora es el reloj (para vencer tickets en las pruebas).
	Ahora func() time.Time

	mu         sync.Mutex
	ultimos    map[clave]int64
	emitidos   map[claveCbte]Emitido
	tickets    map[string]time.Time // token → vence
	porServ    map[string]string    // certificado+servicio → token vigente
	llamadas   map[string]int
	siguiente  int64
	srv        *httptest.Server
	antesDeCAE func(metodo string) // para cortar la conexión en las pruebas
}

type clave struct{ pv, tipo int64 }

type claveCbte struct{ pv, tipo, nro int64 }

// Emitido es un comprobante que ARCA autorizó.
type Emitido struct {
	Tipo, PuntoVenta, Numero int64
	DocTipo                  int64
	DocNro                   string
	CbteFch                  string
	ImpTotal                 string
	Cae                      string
	Vence                    string
}

// Nuevo arranca el simulador en un puerto local.
func Nuevo() *Simulador {
	s := Armar()
	s.srv = httptest.NewServer(s)
	return s
}

// Armar lo crea sin servidor (para montarlo en otro, como el comando del
// benchmark).
func Armar() *Simulador {
	return &Simulador{DuracionTicket: 12 * time.Hour, Ahora: time.Now, ultimos: map[clave]int64{},
		emitidos: map[claveCbte]Emitido{}, tickets: map[string]time.Time{}, porServ: map[string]string{},
		llamadas: map[string]int{}, siguiente: 76_000_000_000_000}
}

// Cerrar apaga el servidor.
func (s *Simulador) Cerrar() {
	if s.srv != nil {
		s.srv.Close()
	}
}

// URLWsaa y URLWsfe son las direcciones para ARCA_URL_WSAA y ARCA_URL_WSFE.
func (s *Simulador) URLWsaa() string { return s.srv.URL + "/ws/services/LoginCms" }

// URLWsfe es la del WSFEv1.
func (s *Simulador) URLWsfe() string { return s.srv.URL + "/wsfev1/service.asmx" }

// Llamadas cuenta los pedidos por método.
func (s *Simulador) Llamadas(metodo string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.llamadas[metodo]
}

// Ultimo es el último autorizado de un punto de venta y tipo.
func (s *Simulador) Ultimo(pv, tipo int64) int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.ultimos[clave{pv, tipo}]
}

// Fijar pone el último autorizado (lo que ARCA ya traía de otro sistema).
func (s *Simulador) Fijar(pv, tipo, ultimo int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ultimos[clave{pv, tipo}] = ultimo
}

// Emitido devuelve lo que ARCA tiene de un comprobante.
func (s *Simulador) Emitido(pv, tipo, nro int64) (Emitido, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.emitidos[claveCbte{pv, tipo, nro}]
	return e, ok
}

// AntesDeResponder corre f justo antes de contestar cada método (después de
// autorizar): sirve para simular que la respuesta se pierde.
func (s *Simulador) AntesDeResponder(f func(metodo string)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.antesDeCAE = f
}

func (s *Simulador) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if s.Demora > 0 || s.Variacion > 0 {
		d := s.Demora
		if s.Variacion > 0 {
			n, _ := rand.Int(rand.Reader, big.NewInt(int64(s.Variacion)))
			d += time.Duration(n.Int64())
		}
		time.Sleep(d)
	}
	b, _ := io.ReadAll(r.Body)
	if strings.Contains(r.URL.Path, "LoginCms") {
		s.loginCms(w, b)
		return
	}
	metodo := strings.TrimPrefix(r.Header.Get("SOAPAction"), "http://ar.gov.afip.dif.FEV1/")
	s.mu.Lock()
	s.llamadas[metodo]++
	s.mu.Unlock()
	var cuerpo string
	switch metodo {
	case "FEDummy":
		cuerpo = `<FEDummyResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FEDummyResult><AppServer>OK</AppServer><DbServer>OK</DbServer><AuthServer>OK</AuthServer></FEDummyResult></FEDummyResponse>`
	case "FECompUltimoAutorizado":
		cuerpo = s.ultimoAutorizado(b)
	case "FECAESolicitar":
		cuerpo = s.solicitar(b)
	case "FECompConsultar":
		cuerpo = s.consultar(b)
	default:
		falla(w, "soap:Client", "Método desconocido: "+metodo)
		return
	}
	s.mu.Lock()
	f := s.antesDeCAE
	s.mu.Unlock()
	if f != nil {
		f(metodo)
	}
	w.Header().Set("Content-Type", "text/xml; charset=utf-8")
	_, _ = io.WriteString(w, `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><soap:Body>`+
		cuerpo+`</soap:Body></soap:Envelope>`)
}

func falla(w http.ResponseWriter, codigo, mensaje string) {
	w.Header().Set("Content-Type", "text/xml; charset=utf-8")
	w.WriteHeader(http.StatusInternalServerError)
	_, _ = io.WriteString(w, `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><soapenv:Fault><faultcode xmlns:ns1="http://xml.apache.org/axis/">ns1:`+
		codigo+`</faultcode><faultstring>`+esc(mensaje)+`</faultstring></soapenv:Fault></soapenv:Body></soapenv:Envelope>`)
}

func esc(s string) string {
	var b strings.Builder
	_ = xml.EscapeText(&b, []byte(s))
	return b.String()
}

// --- WSAA ---

type sobreLogin struct {
	Body struct {
		Login struct {
			In0 string `xml:"in0"`
		} `xml:"loginCms"`
	} `xml:"Body"`
}

type tra struct {
	Header struct {
		UniqueID       string `xml:"uniqueId"`
		GenerationTime string `xml:"generationTime"`
		ExpirationTime string `xml:"expirationTime"`
	} `xml:"header"`
	Service string `xml:"service"`
}

func (s *Simulador) loginCms(w http.ResponseWriter, b []byte) {
	s.mu.Lock()
	s.llamadas["loginCms"]++
	s.mu.Unlock()
	var sobre sobreLogin
	if err := xml.Unmarshal(b, &sobre); err != nil {
		falla(w, "xml.bad", "No se pudo leer el pedido.")
		return
	}
	der, err := base64.StdEncoding.DecodeString(strings.TrimSpace(sobre.Body.Login.In0))
	if err != nil {
		falla(w, "cms.bad", "CMS no es base64.")
		return
	}
	p7, err := pkcs7.Parse(der)
	if err != nil {
		falla(w, "cms.bad", "No se pudo decodificar el CMS: "+err.Error())
		return
	}
	if err := p7.Verify(); err != nil && verificarComoOpenSSL(der, p7) != nil {
		falla(w, "cms.sign.invalid", "Firma inválida o algoritmo no soportado")
		return
	}
	var t tra
	if err := xml.Unmarshal(p7.Content, &t); err != nil || t.Service == "" {
		falla(w, "xml.bad", "No se pudo leer el TRA.")
		return
	}
	ahora := s.Ahora()
	gen, err1 := time.Parse(time.RFC3339Nano, t.Header.GenerationTime)
	exp, err2 := time.Parse(time.RFC3339Nano, t.Header.ExpirationTime)
	if err1 != nil || err2 != nil || gen.After(ahora) || exp.Before(ahora) {
		falla(w, "xml.generationTime.invalid", "generationTime posee formato o dato inválido")
		return
	}
	if t.Service != "wsfe" {
		falla(w, "coe.notAuthorized", "Computador no autorizado a acceder al servicio")
		return
	}
	cert := p7.GetOnlySigner()
	if cert == nil {
		falla(w, "cms.cert.notFound", "No se encontró certificado de firma.")
		return
	}
	llave := cert.SerialNumber.String() + "|" + t.Service
	s.mu.Lock()
	defer s.mu.Unlock()
	if tok, ok := s.porServ[llave]; ok && s.tickets[tok].After(ahora) {
		w.Header().Set("Content-Type", "text/xml; charset=utf-8")
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = io.WriteString(w, `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><soapenv:Fault><faultcode xmlns:ns1="http://xml.apache.org/axis/">ns1:coe.alreadyAuthenticated</faultcode><faultstring>El CEE ya posee un TA valido para el acceso al WSN solicitado</faultstring></soapenv:Fault></soapenv:Body></soapenv:Envelope>`)
		return
	}
	var r [24]byte
	_, _ = rand.Read(r[:])
	token := base64.StdEncoding.EncodeToString(r[:])
	_, _ = rand.Read(r[:])
	sign := base64.StdEncoding.EncodeToString(r[:])
	vence := ahora.Add(s.DuracionTicket)
	s.tickets[token] = vence
	s.porServ[llave] = token
	art := time.FixedZone("-03", -3*3600)
	ta := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<loginTicketResponse version="1.0">
    <header>
        <source>CN=wsaahomo, O=AFIP, C=AR, SERIALNUMBER=CUIT 33693450239</source>
        <destination>` + esc(cert.Subject.String()) + `</destination>
        <uniqueId>` + strconv.FormatInt(ahora.Unix(), 10) + `</uniqueId>
        <generationTime>` + ahora.In(art).Format("2006-01-02T15:04:05.000-07:00") + `</generationTime>
        <expirationTime>` + vence.In(art).Format("2006-01-02T15:04:05.000-07:00") + `</expirationTime>
    </header>
    <credentials>
        <token>` + token + `</token>
        <sign>` + sign + `</sign>
    </credentials>
</loginTicketResponse>`
	w.Header().Set("Content-Type", "text/xml; charset=utf-8")
	_, _ = io.WriteString(w, `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><soapenv:Body><loginCmsResponse xmlns="http://wsaa.view.sua.dvadac.desa.afip.gov"><loginCmsReturn>`+
		esc(ta)+`</loginCmsReturn></loginCmsResponse></soapenv:Body></soapenv:Envelope>`)
}

// verificarComoOpenSSL verifica la firma sobre los atributos firmados tal
// como vinieron. smallstep/pkcs7 los vuelve a codificar ordenados (DER) antes
// de verificar, y node-forge —el TS— los manda en el orden en que se cargaron:
// OpenSSL (y ARCA) verifican los bytes recibidos, así que acá también.
func verificarComoOpenSSL(der []byte, p7 *pkcs7.PKCS7) error {
	var ci struct {
		Tipo      asn1.ObjectIdentifier
		Contenido asn1.RawValue `asn1:"explicit,tag:0"`
	}
	if _, err := asn1.Unmarshal(der, &ci); err != nil {
		return err
	}
	var sd struct {
		Version   int
		Digests   asn1.RawValue
		Encap     asn1.RawValue
		Certs     asn1.RawValue `asn1:"optional,tag:0"`
		CRLs      asn1.RawValue `asn1:"optional,tag:1"`
		Firmantes []struct {
			Version   int
			Sid       asn1.RawValue
			Digest    asn1.RawValue
			Atributos asn1.RawValue `asn1:"optional,tag:0"`
			Algoritmo asn1.RawValue
			Firma     []byte
		} `asn1:"set"`
	}
	if _, err := asn1.Unmarshal(ci.Contenido.Bytes, &sd); err != nil {
		return err
	}
	cert := p7.GetOnlySigner()
	if len(sd.Firmantes) != 1 || cert == nil {
		return errors.New("un firmante")
	}
	f := sd.Firmantes[0]
	var resumen []byte
	if err := p7.UnmarshalSignedAttribute(pkcs7.OIDAttributeMessageDigest, &resumen); err != nil {
		return err
	}
	if h := sha256.Sum256(p7.Content); !bytes.Equal(h[:], resumen) {
		return errors.New("el messageDigest no es el del contenido")
	}
	atributos := append([]byte{0x31}, f.Atributos.FullBytes[1:]...)
	h := sha256.Sum256(atributos)
	clave, ok := cert.PublicKey.(*rsa.PublicKey)
	if !ok {
		return errors.New("solo RSA")
	}
	return rsa.VerifyPKCS1v15(clave, crypto.SHA256, h[:], f.Firma)
}

// --- WSFEv1 ---

type auth struct {
	Token string `xml:"Token"`
	Sign  string `xml:"Sign"`
	Cuit  string `xml:"Cuit"`
}

type alicIva struct {
	ID      int64  `xml:"Id"`
	BaseImp string `xml:"BaseImp"`
	Importe string `xml:"Importe"`
}

type tributo struct {
	ID      string `xml:"Id"`
	Importe string `xml:"Importe"`
}

type detalle struct {
	Concepto     int64  `xml:"Concepto"`
	DocTipo      int64  `xml:"DocTipo"`
	DocNro       string `xml:"DocNro"`
	CbteDesde    int64  `xml:"CbteDesde"`
	CbteHasta    int64  `xml:"CbteHasta"`
	CbteFch      string `xml:"CbteFch"`
	ImpTotal     string `xml:"ImpTotal"`
	ImpTotConc   string `xml:"ImpTotConc"`
	ImpNeto      string `xml:"ImpNeto"`
	ImpOpEx      string `xml:"ImpOpEx"`
	ImpTrib      string `xml:"ImpTrib"`
	ImpIVA       string `xml:"ImpIVA"`
	MonID        string `xml:"MonId"`
	CondicionIVA string `xml:"CondicionIVAReceptorId"`
	CbtesAsoc    *struct {
		Asoc []struct {
			Tipo   int64 `xml:"Tipo"`
			PtoVta int64 `xml:"PtoVta"`
			Nro    int64 `xml:"Nro"`
		} `xml:"CbteAsoc"`
	} `xml:"CbtesAsoc"`
	Tributos *struct {
		Lista []tributo `xml:"Tributo"`
	} `xml:"Tributos"`
	Iva *struct {
		Lista []alicIva `xml:"AlicIva"`
	} `xml:"Iva"`
}

type pedido struct {
	Body struct {
		Inner struct {
			Auth   auth `xml:"Auth"`
			PtoVta int64
			Tipo   int64 `xml:"CbteTipo"`
			Req    struct {
				Cab struct {
					CantReg int64 `xml:"CantReg"`
					PtoVta  int64 `xml:"PtoVta"`
					Tipo    int64 `xml:"CbteTipo"`
				} `xml:"FeCabReq"`
				Det struct {
					Lista []detalle `xml:"FECAEDetRequest"`
				} `xml:"FeDetReq"`
			} `xml:"FeCAEReq"`
			Cons struct {
				Tipo   int64 `xml:"CbteTipo"`
				Nro    int64 `xml:"CbteNro"`
				PtoVta int64 `xml:"PtoVta"`
			} `xml:"FeCompConsReq"`
		} `xml:",any"`
	} `xml:"Body"`
}

func (s *Simulador) leer(b []byte) (pedido, string) {
	var p pedido
	if err := xml.Unmarshal(b, &p); err != nil {
		return p, errores("[sim] 500", "No se pudo leer el pedido: "+err.Error())
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	vence, ok := s.tickets[p.Body.Inner.Auth.Token]
	if !ok || !vence.After(s.Ahora()) {
		return p, errores("600", "ValidacionDeToken: No validaron las credenciales ingresadas")
	}
	if len(p.Body.Inner.Auth.Cuit) != 11 {
		return p, errores("1000", "Usuario no autorizado a realizar esta operacion. ValidacionDeToken: CUIT inválido")
	}
	return p, ""
}

func errores(codigo, mensaje string) string {
	return `<Errors><Err><Code>` + codigo + `</Code><Msg>` + esc(mensaje) + `</Msg></Err></Errors>`
}

func (s *Simulador) ultimoAutorizado(b []byte) string {
	p, e := s.leer(b)
	envolver := func(x string) string {
		return `<FECompUltimoAutorizadoResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECompUltimoAutorizadoResult>` + x + `</FECompUltimoAutorizadoResult></FECompUltimoAutorizadoResponse>`
	}
	if e != "" {
		return envolver(e)
	}
	in := p.Body.Inner
	s.mu.Lock()
	n := s.ultimos[clave{in.PtoVta, in.Tipo}]
	s.mu.Unlock()
	return envolver(`<PtoVta>` + strconv.FormatInt(in.PtoVta, 10) + `</PtoVta><CbteTipo>` + strconv.FormatInt(in.Tipo, 10) +
		`</CbteTipo><CbteNro>` + strconv.FormatInt(n, 10) + `</CbteNro>`)
}

func centavos(t string) (int64, bool) {
	f, err := strconv.ParseFloat(strings.TrimSpace(t), 64)
	if err != nil {
		return 0, false
	}
	return int64(math.Round(f * 100)), true
}

func (s *Simulador) solicitar(b []byte) string {
	p, e := s.leer(b)
	envolver := func(cab, det, errs string) string {
		return `<FECAESolicitarResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECAESolicitarResult>` + cab + det + errs + `</FECAESolicitarResult></FECAESolicitarResponse>`
	}
	if e != "" {
		return envolver("", "", e)
	}
	req := p.Body.Inner.Req
	if req.Cab.CantReg != 1 || len(req.Det.Lista) != 1 {
		return envolver("", "", errores("10001", "La cantidad de registros a autorizar no coincide con el detalle."))
	}
	pv, tipo := req.Cab.PtoVta, req.Cab.Tipo
	d := req.Det.Lista[0]
	var obs []string
	agregar := func(codigo, msg string) {
		obs = append(obs, `<Obs><Code>`+codigo+`</Code><Msg>`+esc(msg)+`</Msg></Obs>`)
	}

	s.mu.Lock()
	ultimo := s.ultimos[clave{pv, tipo}]
	s.mu.Unlock()
	if d.CbteDesde != ultimo+1 || d.CbteHasta != d.CbteDesde {
		agregar("10016", "El numero o fecha del comprobante no se corresponde con el proximo a autorizar. Consultar metodo FECompUltimoAutorizado.")
	}
	total, ok1 := centavos(d.ImpTotal)
	neto, ok2 := centavos(d.ImpNeto)
	iva, ok3 := centavos(d.ImpIVA)
	trib, ok4 := centavos(d.ImpTrib)
	opex, ok5 := centavos(d.ImpOpEx)
	conc, ok6 := centavos(d.ImpTotConc)
	if !(ok1 && ok2 && ok3 && ok4 && ok5 && ok6) {
		agregar("10013", "Los importes deben ser numéricos con hasta dos decimales.")
	} else if total != neto+iva+trib+opex+conc {
		agregar("10048", "El campo 'Importe Total' ImpTotal, debe ser igual a la suma de ImpTotConc + ImpNeto + ImpOpEx + ImpTrib + ImpIVA.")
	}
	esC := tipo == 11 || tipo == 12 || tipo == 13
	if esC && d.Iva != nil {
		agregar("10071", "Para comprobantes tipo C el objeto IVA no debe informarse.")
	}
	if !esC && neto > 0 && (d.Iva == nil || len(d.Iva.Lista) == 0) {
		agregar("10070", "Si ImpNeto es mayor a 0 el objeto IVA es obligatorio.")
	}
	if d.Iva != nil {
		suma, bases := int64(0), int64(0)
		for _, a := range d.Iva.Lista {
			c, _ := centavos(a.Importe)
			suma += c
			b, _ := centavos(a.BaseImp)
			bases += b
			if a.ID < 3 || a.ID > 9 {
				agregar("10019", "El Id de la alícuota de IVA no es válido.")
			}
		}
		if suma != iva {
			agregar("10023", "La suma de los importes de IVA (AlicIva.Importe) debe ser igual a ImpIVA.")
		}
		if bases != neto {
			agregar("10061", "[sim] La suma de las bases imponibles de IVA (AlicIva.BaseImp) debe ser igual a ImpNeto.")
		}
	}
	if d.Tributos != nil {
		suma := int64(0)
		for _, t := range d.Tributos.Lista {
			c, _ := centavos(t.Importe)
			suma += c
		}
		if suma != trib {
			agregar("10029", "La suma de los importes de tributos debe ser igual a ImpTrib.")
		}
	}
	nota := tipo == 2 || tipo == 3 || tipo == 7 || tipo == 8 || tipo == 12 || tipo == 13
	if nota && (d.CbtesAsoc == nil || len(d.CbtesAsoc.Asoc) == 0) {
		agregar("10151", "[sim] Para notas de crédito y débito es obligatorio informar el comprobante asociado (CbtesAsoc).")
	}
	if nota && d.CbtesAsoc != nil {
		for _, a := range d.CbtesAsoc.Asoc {
			s.mu.Lock()
			_, existe := s.emitidos[claveCbte{a.PtoVta, a.Tipo, a.Nro}]
			s.mu.Unlock()
			if !existe {
				agregar("10153", "[sim] El comprobante asociado no existe o no está autorizado.")
			}
		}
	}
	if strings.TrimSpace(d.CondicionIVA) == "" {
		agregar("10242", "El campo Condicion Frente al IVA del receptor es obligatorio conforme a la RG 5616.")
	}
	if d.MonID != "PES" {
		agregar("10032", "[sim] Solo se aceptan comprobantes en pesos.")
	}
	if _, err := time.Parse("20060102", d.CbteFch); err != nil {
		agregar("10016", "El numero o fecha del comprobante no se corresponde con el proximo a autorizar. Consultar metodo FECompUltimoAutorizado.")
	}

	cab := `<FeCabResp><Cuit>` + p.Body.Inner.Auth.Cuit + `</Cuit><PtoVta>` + strconv.FormatInt(pv, 10) + `</PtoVta><CbteTipo>` + strconv.FormatInt(tipo, 10) +
		`</CbteTipo><FchProceso>` + s.Ahora().Format("20060102150405") + `</FchProceso><CantReg>1</CantReg>`
	base := `<Concepto>` + strconv.FormatInt(d.Concepto, 10) + `</Concepto><DocTipo>` + strconv.FormatInt(d.DocTipo, 10) + `</DocTipo><DocNro>` +
		esc(d.DocNro) + `</DocNro><CbteDesde>` + strconv.FormatInt(d.CbteDesde, 10) + `</CbteDesde><CbteHasta>` + strconv.FormatInt(d.CbteHasta, 10) +
		`</CbteHasta><CbteFch>` + esc(d.CbteFch) + `</CbteFch>`
	if len(obs) > 0 {
		return envolver(cab+`<Resultado>R</Resultado><Reproceso>N</Reproceso></FeCabResp>`,
			`<FeDetResp><FECAEDetResponse>`+base+`<Resultado>R</Resultado><Observaciones>`+strings.Join(obs, "")+
				`</Observaciones><CAE></CAE><CAEFchVto></CAEFchVto></FECAEDetResponse></FeDetResp>`, "")
	}
	s.mu.Lock()
	if s.ultimos[clave{pv, tipo}] != ultimo { // otro pedido ganó mientras tanto
		s.mu.Unlock()
		return envolver(cab+`<Resultado>R</Resultado><Reproceso>N</Reproceso></FeCabResp>`,
			`<FeDetResp><FECAEDetResponse>`+base+`<Resultado>R</Resultado><Observaciones><Obs><Code>10016</Code><Msg>El numero o fecha del comprobante no se corresponde con el proximo a autorizar. Consultar metodo FECompUltimoAutorizado.</Msg></Obs></Observaciones><CAE></CAE><CAEFchVto></CAEFchVto></FECAEDetResponse></FeDetResp>`, "")
	}
	s.siguiente++
	cae := strconv.FormatInt(s.siguiente, 10)
	fch, _ := time.Parse("20060102", d.CbteFch)
	vence := fch.AddDate(0, 0, 10).Format("20060102")
	s.ultimos[clave{pv, tipo}] = d.CbteDesde
	s.emitidos[claveCbte{pv, tipo, d.CbteDesde}] = Emitido{Tipo: tipo, PuntoVenta: pv, Numero: d.CbteDesde, DocTipo: d.DocTipo,
		DocNro: d.DocNro, CbteFch: d.CbteFch, ImpTotal: d.ImpTotal, Cae: cae, Vence: vence}
	s.mu.Unlock()
	return envolver(cab+`<Resultado>A</Resultado><Reproceso>N</Reproceso></FeCabResp>`,
		`<FeDetResp><FECAEDetResponse>`+base+`<Resultado>A</Resultado><CAE>`+cae+`</CAE><CAEFchVto>`+vence+
			`</CAEFchVto></FECAEDetResponse></FeDetResp>`, "")
}

func (s *Simulador) consultar(b []byte) string {
	p, e := s.leer(b)
	envolver := func(x string) string {
		return `<FECompConsultarResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECompConsultarResult>` + x + `</FECompConsultarResult></FECompConsultarResponse>`
	}
	if e != "" {
		return envolver(e)
	}
	c := p.Body.Inner.Cons
	s.mu.Lock()
	em, ok := s.emitidos[claveCbte{c.PtoVta, c.Tipo, c.Nro}]
	s.mu.Unlock()
	if !ok {
		return envolver(errores("602", "No existen datos en nuestros registros para los parametros ingresados."))
	}
	return envolver(`<ResultGet><Concepto>1</Concepto><DocTipo>` + strconv.FormatInt(em.DocTipo, 10) + `</DocTipo><DocNro>` + esc(em.DocNro) +
		`</DocNro><CbteDesde>` + strconv.FormatInt(em.Numero, 10) + `</CbteDesde><CbteHasta>` + strconv.FormatInt(em.Numero, 10) +
		`</CbteHasta><CbteFch>` + em.CbteFch + `</CbteFch><ImpTotal>` + esc(em.ImpTotal) + `</ImpTotal><MonId>PES</MonId><MonCotiz>1</MonCotiz>` +
		`<Resultado>A</Resultado><CodAutorizacion>` + em.Cae + `</CodAutorizacion><EmisionTipo>CAE</EmisionTipo><FchVto>` + em.Vence +
		`</FchVto><FchProceso>` + s.Ahora().Format("20060102150405") + `</FchProceso><PtoVta>` + strconv.FormatInt(em.PuntoVenta, 10) +
		`</PtoVta><CbteTipo>` + strconv.FormatInt(em.Tipo, 10) + `</CbteTipo></ResultGet>`)
}

// CertificadoDePrueba arma un certificado autofirmado y su clave (PEM), con
// el CUIT en el número de serie del sujeto como los de ARCA. Sirve solo para
// el simulador: ARCA de verdad no lo acepta.
func CertificadoDePrueba(cuit string) (certPEM, clavePEM string, err error) {
	k, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return "", "", err
	}
	serie, _ := rand.Int(rand.Reader, big.NewInt(1<<62))
	plantilla := &x509.Certificate{
		SerialNumber: serie,
		Subject:      pkix.Name{CommonName: "mjbj-prueba", Organization: []string{"Maderera de prueba"}, SerialNumber: "CUIT " + cuit},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().AddDate(2, 0, 0),
		KeyUsage:     x509.KeyUsageDigitalSignature,
	}
	der, err := x509.CreateCertificate(rand.Reader, plantilla, plantilla, &k.PublicKey, k)
	if err != nil {
		return "", "", err
	}
	certPEM = string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}))
	clavePEM = string(pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(k)}))
	return certPEM, clavePEM, nil
}
