package fiscal

import (
	"encoding/base64"
	"os"
	"regexp"
	"strings"
)

// Las credenciales de ARCA (lib/fiscal/proveedores/config-arca.ts). Se leen
// del entorno en cada uso, como el TS: el certificado montado puede aparecer
// después de arrancar, y la pantalla de ARCA tiene que verlo sin reiniciar.
//
//	ARCA_CUIT                    CUIT del emisor
//	ARCA_CERTIFICADO             certificado en PEM (o en base64)
//	ARCA_CLAVE_PRIVADA           clave privada en PEM (o en base64)
//	ARCA_CERTIFICADO_ARCHIVO     o la ruta a un archivo montado
//	ARCA_CLAVE_PRIVADA_ARCHIVO   ídem
//	ARCA_AMBIENTE                homologacion (por defecto) | produccion
//	ARCA_PROVEEDOR               interno: no habla con ARCA aunque haya certificado
//
// Solo en Go, para el simulador de las pruebas y el benchmark:
//
//	ARCA_URL_WSAA, ARCA_URL_WSFE  otra dirección para el WSAA y el WSFEv1

// Config son las credenciales y las direcciones.
type Config struct {
	Cuit         string
	Certificado  string
	ClavePrivada string
	Ambiente     string // homologacion | produccion
	URLWsaa      string
	URLWsfe      string
}

var endpoints = map[string][2]string{
	"homologacion": {"https://wsaahomo.afip.gov.ar/ws/services/LoginCms", "https://wswhomo.afip.gov.ar/wsfev1/service.asmx"},
	"produccion":   {"https://wsaa.afip.gov.ar/ws/services/LoginCms", "https://servicios1.afip.gov.ar/wsfev1/service.asmx"},
}

// Entorno lee una variable. Las pruebas lo reemplazan.
type Entorno func(string) string

// DelProceso es el entorno de verdad.
var DelProceso Entorno = os.Getenv

var noBase64 = regexp.MustCompile(`[^A-Za-z0-9+/]`)

// leerPem acepta el PEM tal cual (con los \n escritos como texto) o en base64.
func leerPem(valor string) string {
	if valor == "" {
		return ""
	}
	limpio := strings.TrimSpace(valor)
	if strings.Contains(limpio, "-----BEGIN") {
		return strings.ReplaceAll(limpio, `\n`, "\n")
	}
	// Buffer.from(x, "base64") ignora lo que no es base64 y el relleno (un
	// carácter suelto al final no alcanza para un byte).
	b64 := noBase64.ReplaceAllString(limpio, "")
	if len(b64)%4 == 1 {
		b64 = b64[:len(b64)-1]
	}
	dec, err := base64.RawStdEncoding.DecodeString(b64)
	if err != nil {
		return ""
	}
	if s := string(dec); strings.Contains(s, "-----BEGIN") {
		return s
	}
	return ""
}

func (e Entorno) credencial(variable string) string {
	if v := e(variable); v != "" {
		return v
	}
	ruta := e(variable + "_ARCHIVO")
	if ruta == "" {
		return ""
	}
	b, err := os.ReadFile(ruta)
	if err != nil {
		return ""
	}
	return string(b)
}

// Leer es configArca(): nil si falta algo.
func (e Entorno) Leer() *Config {
	cuit := SoloDigitos(e("ARCA_CUIT"))
	cert := leerPem(e.credencial("ARCA_CERTIFICADO"))
	clave := leerPem(e.credencial("ARCA_CLAVE_PRIVADA"))
	if len(cuit) != 11 || cert == "" || clave == "" {
		return nil
	}
	ambiente := "homologacion"
	if e("ARCA_AMBIENTE") == "produccion" {
		ambiente = "produccion"
	}
	c := &Config{Cuit: cuit, Certificado: cert, ClavePrivada: clave, Ambiente: ambiente,
		URLWsaa: endpoints[ambiente][0], URLWsfe: endpoints[ambiente][1]}
	if u := e("ARCA_URL_WSAA"); u != "" {
		c.URLWsaa = u
	}
	if u := e("ARCA_URL_WSFE"); u != "" {
		c.URLWsfe = u
	}
	return c
}

// HayCertificado y HayClave, cada uno por su lado (los pasos de /admin/arca).
func (e Entorno) HayCertificado() bool { return leerPem(e.credencial("ARCA_CERTIFICADO")) != "" }

// HayClave dice si la clave privada está cargada.
func (e Entorno) HayClave() bool { return leerPem(e.credencial("ARCA_CLAVE_PRIVADA")) != "" }

// UsaArca es proveedorFiscal(): ARCA si hay credenciales y no se pidió el
// interno.
func (e Entorno) UsaArca() bool {
	if e("ARCA_PROVEEDOR") == "interno" {
		return false
	}
	return e.Leer() != nil
}

// FaltaParaArca es qué falta, en castellano ("" si nada).
func (e Entorno) FaltaParaArca() string {
	var faltan []string
	if len(SoloDigitos(e("ARCA_CUIT"))) != 11 {
		faltan = append(faltan, "el CUIT del emisor (ARCA_CUIT)")
	}
	if !e.HayCertificado() {
		if r := e("ARCA_CERTIFICADO_ARCHIVO"); r != "" {
			faltan = append(faltan, "el certificado digital ("+r+")")
		} else {
			faltan = append(faltan, "el certificado digital (ARCA_CERTIFICADO)")
		}
	}
	if !e.HayClave() {
		if r := e("ARCA_CLAVE_PRIVADA_ARCHIVO"); r != "" {
			faltan = append(faltan, "la clave privada ("+r+")")
		} else {
			faltan = append(faltan, "la clave privada (ARCA_CLAVE_PRIVADA)")
		}
	}
	if len(faltan) == 0 {
		return ""
	}
	return "Falta cargar " + strings.Join(faltan, ", ") + "."
}
