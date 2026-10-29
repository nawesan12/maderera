package fiscal

import (
	"bytes"
	"context"
	"crypto"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"errors"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/smallstep/pkcs7"
)

// WSAA, el ticket de acceso (wsaa.ts). Se arma un TRA con el servicio y una
// ventana de validez, se firma como CMS/PKCS#7 con el certificado de la
// empresa y se canjea por un token y una firma que viajan en cada llamada al
// WSFEv1. El ticket dura 12 horas y ARCA no da otro mientras haya uno
// vigente: se guarda (arca_tokens) y se reusa.

// Ticket es el ticket de acceso.
type Ticket struct {
	Token  string
	Sign   string
	Expira time.Time
}

// isoJS es Date.toISOString(): UTC con milisegundos.
func isoJS(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000Z") }

// ArmarTra es el Ticket de Requerimiento de Acceso. La ventana arranca diez
// minutos antes de ahora: un reloj adelantado haría que ARCA lo rechace por
// venir del futuro.
func ArmarTra(servicio string, ahora time.Time) string {
	ms := ahora.UnixMilli()
	desde := time.UnixMilli(ms - 10*60_000)
	hasta := time.UnixMilli(ms + 12*3_600_000)
	return `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>` + strconv.FormatInt(pisoDiv(ms, 1000), 10) + `</uniqueId>
    <generationTime>` + isoJS(desde) + `</generationTime>
    <expirationTime>` + isoJS(hasta) + `</expirationTime>
  </header>
  <service>` + servicio + `</service>
</loginTicketRequest>`
}

func pisoDiv(a, b int64) int64 {
	q := a / b
	if (a%b != 0) && ((a < 0) != (b < 0)) {
		q--
	}
	return q
}

// FirmarTra firma el TRA: CMS SignedData *attached* (lleva el TRA adentro),
// SHA-256, con el certificado y los atributos firmados de siempre
// (contentType, messageDigest, signingTime). Es `openssl cms -sign -nodetach`.
func FirmarTra(tra string, cfg *Config) (string, error) {
	cert, clave, err := Credenciales(cfg)
	if err != nil {
		return "", err
	}
	sd, err := pkcs7.NewSignedData([]byte(tra))
	if err != nil {
		return "", err
	}
	sd.SetDigestAlgorithm(pkcs7.OIDDigestAlgorithmSHA256)
	if err := sd.AddSigner(cert, clave, pkcs7.SignerInfoConfig{}); err != nil {
		return "", err
	}
	der, err := sd.Finish()
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(der), nil
}

// Credenciales lee el certificado y la clave del PEM (PKCS#1, PKCS#8 o EC).
func Credenciales(cfg *Config) (*x509.Certificate, crypto.Signer, error) {
	bc, _ := pem.Decode([]byte(cfg.Certificado))
	if bc == nil {
		return nil, nil, errors.New("El certificado de ARCA no es un PEM válido.")
	}
	cert, err := x509.ParseCertificate(bc.Bytes)
	if err != nil {
		return nil, nil, errors.New("El certificado de ARCA no se pudo leer: " + err.Error())
	}
	bk, _ := pem.Decode([]byte(cfg.ClavePrivada))
	if bk == nil {
		return nil, nil, errors.New("La clave privada de ARCA no es un PEM válido.")
	}
	var clave any
	if k, err := x509.ParsePKCS1PrivateKey(bk.Bytes); err == nil {
		clave = k
	} else if k, err := x509.ParsePKCS8PrivateKey(bk.Bytes); err == nil {
		clave = k
	} else if k, err := x509.ParseECPrivateKey(bk.Bytes); err == nil {
		clave = k
	} else {
		return nil, nil, errors.New("La clave privada de ARCA no se pudo leer.")
	}
	s, ok := clave.(crypto.Signer)
	if !ok {
		return nil, nil, errors.New("La clave privada de ARCA no sirve para firmar.")
	}
	return cert, s, nil
}

// SobreLoginCms es el sobre de loginCms.
func SobreLoginCms(cms string) string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desa.afip.gov">
  <soapenv:Header/>
  <soapenv:Body>
    <wsaa:loginCms>
      <wsaa:in0>` + cms + `</wsaa:in0>
    </wsaa:loginCms>
  </soapenv:Body>
</soapenv:Envelope>`
}

var faultstring = regexp.MustCompile(`(?i)<faultstring>([\s\S]*?)</faultstring>`)

// MotivoDeFalla saca el mensaje de un SOAP Fault ("" si no hay).
func MotivoDeFalla(xml string) string {
	if m := faultstring.FindStringSubmatch(xml); m != nil {
		return strings.TrimSpace(m[1])
	}
	return ""
}

// LeerTicket interpreta la respuesta de loginCms (status es el HTTP).
func LeerTicket(texto string, status int, ahora time.Time) (Ticket, error) {
	falla := func(porDefecto string) error {
		if m := MotivoDeFalla(texto); m != "" {
			return errors.New(m)
		}
		return errors.New(porDefecto)
	}
	if status < 200 || status >= 300 {
		return Ticket{}, falla("WSAA respondió " + strconv.Itoa(status))
	}
	raiz, err := leerXML(texto)
	if err != nil {
		return Ticket{}, err
	}
	ret := raiz.h("Envelope").h("Body").h("loginCmsResponse").h("loginCmsReturn")
	if ret == nil || !ret.esTexto() {
		return Ticket{}, falla("WSAA devolvió una respuesta que no se pudo leer.")
	}
	ticket, err := leerXML(ret.texto)
	if err != nil {
		return Ticket{}, err
	}
	r := ticket.h("loginTicketResponse")
	cred := r.h("credentials")
	token, sign := cred.h("token"), cred.h("sign")
	if token == nil || sign == nil || token.cadena() == "" || sign.cadena() == "" {
		return Ticket{}, errors.New("El ticket de ARCA vino sin token.")
	}
	expira := ahora.Add(11 * time.Hour)
	if e := r.h("header").h("expirationTime"); e != nil && e.cadena() != "" {
		if t, err := time.Parse(time.RFC3339Nano, e.cadena()); err == nil {
			expira = t
		}
	}
	return Ticket{Token: token.cadena(), Sign: sign.cadena(), Expira: expira}, nil
}

// PedirTicket le pide uno nuevo al WSAA.
func PedirTicket(ctx context.Context, cfg *Config, servicio string, ahora time.Time) (Ticket, error) {
	cms, err := FirmarTra(ArmarTra(servicio, ahora), cfg)
	if err != nil {
		return Ticket{}, err
	}
	ctx, cancelar := context.WithTimeout(ctx, 20*time.Second)
	defer cancelar()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.URLWsaa, bytes.NewReader([]byte(SobreLoginCms(cms))))
	if err != nil {
		return Ticket{}, err
	}
	req.Header.Set("Content-Type", "text/xml; charset=utf-8")
	req.Header.Set("SOAPAction", "")
	resp, err := HTTP.Do(req)
	if err != nil {
		return Ticket{}, errors.Join(ErrSinRespuesta, err)
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return Ticket{}, errors.Join(ErrSinRespuesta, err)
	}
	return LeerTicket(string(b), resp.StatusCode, ahora)
}
