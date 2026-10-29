package fiscal

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"mjbj/internal/jsmath"
)

// WSFEv1, la emisión de comprobantes electrónicos (arca.ts). SOAP armado a
// mano, como el TS, con los mismos bytes: el golden compara el sobre entero.
//
// Reglas de ARCA que están acá: los importes con dos decimales y que cierren
// (ImpTotal = ImpNeto + ImpIVA + ImpTrib + ImpOpEx), sin IVA en la C, el
// comprobante asociado en toda nota y CondicionIVAReceptorId.

const nsFev1 = "http://ar.gov.afip.dif.FEV1/"

// SobreWsfe es el sobre SOAP de un método.
func SobreWsfe(metodo, cuerpo string) string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">
  <soap:Body>
    <ar:` + metodo + `>
` + cuerpo + `
    </ar:` + metodo + `>
  </soap:Body>
</soap:Envelope>`
}

// AuthXML es el encabezado que llevan todos los métodos menos FEDummy.
func AuthXML(t Ticket, cuit string) string {
	return `      <ar:Auth>
        <ar:Token>` + t.Token + `</ar:Token>
        <ar:Sign>` + t.Sign + `</ar:Sign>
        <ar:Cuit>` + cuit + `</ar:Cuit>
      </ar:Auth>`
}

// Asociado es el comprobante que corrige una nota.
type Asociado struct {
	Tipo       string    `json:"tipo"`
	PuntoVenta int64     `json:"puntoVenta"`
	Numero     int64     `json:"numero"`
	Fecha      time.Time `json:"fecha"`
}

// AAutorizar es ComprobanteAAutorizar.
type AAutorizar struct {
	Tipo                 string          `json:"tipo"`
	PuntoVenta           int64           `json:"puntoVenta"`
	Numero               int64           `json:"numero"`
	FechaEmision         time.Time       `json:"fechaEmision"`
	ReceptorCuit         *string         `json:"receptorCuit"`
	ReceptorCondicionIva string          `json:"receptorCondicionIva"`
	Neto                 float64         `json:"neto"`
	Exento               float64         `json:"exento"`
	Iva                  []IvaDeAlicuota `json:"iva"`
	Tributos             []Tributo       `json:"tributos"`
	Total                float64         `json:"total"`
	Asociado             *Asociado       `json:"asociado"`
}

func importe(v float64) string { return jsmath.ToFixed(v, 2) }

func entero(n int64) string { return strconv.FormatInt(n, 10) }

// definido es `${x}` de un valor de un Record que puede no estar.
func definido(m map[string]int, k string) string {
	if v, ok := m[k]; ok {
		return strconv.Itoa(v)
	}
	return "undefined"
}

// CuerpoAutorizar es el cuerpo de FECAESolicitar, byte a byte el del TS.
func CuerpoAutorizar(c AAutorizar, cuitEmisor, auth string) string {
	codigo := definido(CodigoComprobante, c.Tipo)
	docTipo, docNro := DocumentoReceptor(c.ReceptorCuit)
	esC := strings.HasSuffix(c.Tipo, "_c")
	neto := c.Neto
	totalIva := 0.0
	if esC {
		neto = c.Total
	} else {
		for _, i := range c.Iva {
			totalIva += i.Importe
		}
	}
	totalTributos := 0.0
	for _, t := range c.Tributos {
		totalTributos += t.Importe
	}

	detalleIva := ""
	if !esC && len(c.Iva) > 0 {
		partes := make([]string, len(c.Iva))
		for k, i := range c.Iva {
			id := 5
			if v, ok := CodigoAlicuotaArca[i.Alicuota]; ok {
				id = v
			}
			partes[k] = `          <ar:AlicIva>
            <ar:Id>` + strconv.Itoa(id) + `</ar:Id>
            <ar:BaseImp>` + importe(i.Base) + `</ar:BaseImp>
            <ar:Importe>` + importe(i.Importe) + `</ar:Importe>
          </ar:AlicIva>`
		}
		detalleIva = `        <ar:Iva>
` + strings.Join(partes, "\n") + `
        </ar:Iva>`
	}

	detalleTributos := ""
	if len(c.Tributos) > 0 {
		partes := make([]string, len(c.Tributos))
		for k, t := range c.Tributos {
			partes[k] = `          <ar:Tributo>
            <ar:Id>` + escapar(t.Codigo) + `</ar:Id>
            <ar:Desc>` + escapar(t.Descripcion) + `</ar:Desc>
            <ar:BaseImp>` + importe(t.Base) + `</ar:BaseImp>
            <ar:Alic>` + importe(t.Alicuota) + `</ar:Alic>
            <ar:Importe>` + importe(t.Importe) + `</ar:Importe>
          </ar:Tributo>`
		}
		detalleTributos = `        <ar:Tributos>
` + strings.Join(partes, "\n") + `
        </ar:Tributos>`
	}

	asociados := ""
	if a := c.Asociado; a != nil && EsRectificativo(c.Tipo) {
		asociados = `        <ar:CbtesAsoc>
          <ar:CbteAsoc>
            <ar:Tipo>` + definido(CodigoComprobante, a.Tipo) + `</ar:Tipo>
            <ar:PtoVta>` + entero(a.PuntoVenta) + `</ar:PtoVta>
            <ar:Nro>` + entero(a.Numero) + `</ar:Nro>
            <ar:Cuit>` + cuitEmisor + `</ar:Cuit>
            <ar:CbteFch>` + FechaArca(a.Fecha) + `</ar:CbteFch>
          </ar:CbteAsoc>
        </ar:CbtesAsoc>`
	}

	return auth + `
      <ar:FeCAEReq>
        <ar:FeCabReq>
          <ar:CantReg>1</ar:CantReg>
          <ar:PtoVta>` + entero(c.PuntoVenta) + `</ar:PtoVta>
          <ar:CbteTipo>` + codigo + `</ar:CbteTipo>
        </ar:FeCabReq>
        <ar:FeDetReq>
          <ar:FECAEDetRequest>
            <ar:Concepto>1</ar:Concepto>
            <ar:DocTipo>` + strconv.Itoa(docTipo) + `</ar:DocTipo>
            <ar:DocNro>` + jsmath.Texto(docNro) + `</ar:DocNro>
            <ar:CbteDesde>` + entero(c.Numero) + `</ar:CbteDesde>
            <ar:CbteHasta>` + entero(c.Numero) + `</ar:CbteHasta>
            <ar:CbteFch>` + FechaArca(c.FechaEmision) + `</ar:CbteFch>
            <ar:ImpTotal>` + importe(c.Total) + `</ar:ImpTotal>
            <ar:ImpTotConc>0.00</ar:ImpTotConc>
            <ar:ImpNeto>` + importe(neto) + `</ar:ImpNeto>
            <ar:ImpOpEx>` + importe(c.Exento) + `</ar:ImpOpEx>
            <ar:ImpTrib>` + importe(totalTributos) + `</ar:ImpTrib>
            <ar:ImpIVA>` + importe(totalIva) + `</ar:ImpIVA>
            <ar:MonId>PES</ar:MonId>
            <ar:MonCotiz>1</ar:MonCotiz>
            <ar:CondicionIVAReceptorId>` + definido(CondicionIvaReceptor, c.ReceptorCondicionIva) + `</ar:CondicionIVAReceptorId>
` + asociados + `
` + detalleTributos + `
` + detalleIva + `
          </ar:FECAEDetRequest>
        </ar:FeDetReq>
      </ar:FeCAEReq>`
}

// CuerpoUltimo es el de FECompUltimoAutorizado.
func CuerpoUltimo(auth string, puntoVenta int64, tipo string) string {
	return auth + `
      <ar:PtoVta>` + entero(puntoVenta) + `</ar:PtoVta>
      <ar:CbteTipo>` + definido(CodigoComprobante, tipo) + `</ar:CbteTipo>`
}

// CuerpoConsultar es el de FECompConsultar (el TS no lo usaba: es lo que
// permite recuperar un CAE que ARCA dio y que no llegó a guardarse).
func CuerpoConsultar(auth string, puntoVenta int64, tipo string, numero int64) string {
	return auth + `
      <ar:FeCompConsReq>
        <ar:CbteTipo>` + definido(CodigoComprobante, tipo) + `</ar:CbteTipo>
        <ar:CbteNro>` + entero(numero) + `</ar:CbteNro>
        <ar:PtoVta>` + entero(puntoVenta) + `</ar:PtoVta>
      </ar:FeCompConsReq>`
}

// mensajesDe junta Err, Obs y Evt: «[código] mensaje · …». "" si no hay.
func mensajesDe(n *nodo) string {
	if n == nil || n.esTexto() {
		return ""
	}
	var salida []string
	for _, clave := range []string{"Err", "Obs", "Evt"} {
		for _, item := range n.lista(clave) {
			if item.esTexto() {
				continue // un string: item?.Code y item?.Msg son undefined
			}
			codigo := ""
			if c := item.lista("Code"); len(c) > 0 {
				codigo = valorJS(c)
			} else if c := item.lista("Codigo"); len(c) > 0 {
				codigo = valorJS(c)
			}
			mensaje := ""
			if m := item.lista("Msg"); len(m) > 0 {
				mensaje = valorJS(m)
			} else if m := item.lista("Mensaje"); len(m) > 0 {
				mensaje = valorJS(m)
			}
			if mensaje == "" {
				continue
			}
			if codigo != "" {
				salida = append(salida, "["+codigo+"] "+mensaje)
			} else {
				salida = append(salida, mensaje)
			}
		}
	}
	return strings.Join(salida, " · ")
}

// valorJS es `${v}` de lo que fast-xml-parser dejó en una clave: un texto, un
// objeto, o una lista (que JS une con comas).
func valorJS(l []*nodo) string {
	if len(l) == 1 {
		return l[0].cadena()
	}
	partes := make([]string, len(l))
	for i, n := range l {
		partes[i] = n.cadena()
	}
	return strings.Join(partes, ",")
}

// Resultado es ResultadoAutorizacion.
type Resultado struct {
	Autorizado     bool       `json:"autorizado"`
	Cae            string     `json:"cae,omitempty"`
	CaeVencimiento *time.Time `json:"caeVencimiento,omitempty"`
	Observaciones  string     `json:"observaciones,omitempty"`
	Error          string     `json:"error,omitempty"`
}

// LeerAutorizacion interpreta el Body de FECAESolicitar.
func LeerAutorizacion(body *nodo) Resultado {
	r := body.h("FECAESolicitarResponse").h("FECAESolicitarResult")
	if e := mensajesDe(r.h("Errors")); e != "" {
		return Resultado{Observaciones: e}
	}
	d := r.h("FeDetResp").h("FECAEDetResponse")
	obs := mensajesDe(d.h("Observaciones"))
	res := d.h("Resultado")
	cae := d.h("CAE")
	if res == nil || res.cadena() != "A" || cae == nil || cae.cadena() == "" || !d.h("Resultado").esTexto() {
		if obs == "" {
			obs = "ARCA rechazó el comprobante sin detallar el motivo."
		}
		return Resultado{Observaciones: obs}
	}
	vto := ""
	if v := d.h("CAEFchVto"); v != nil {
		vto = v.cadena()
	}
	return Resultado{Autorizado: true, Cae: cae.cadena(), CaeVencimiento: DesdeFechaArca(vto), Observaciones: obs}
}

// LeerDummy: los tres servidores en OK.
func LeerDummy(body *nodo) bool {
	d := body.h("FEDummyResponse").h("FEDummyResult")
	ok := func(n string) bool { x := d.h(n); return x != nil && x.esTexto() && x.texto == "OK" }
	return ok("AppServer") && ok("DbServer") && ok("AuthServer")
}

// LeerUltimo es CbteNro de FECompUltimoAutorizado, o nil.
func LeerUltimo(body *nodo) (*int64, string) {
	r := body.h("FECompUltimoAutorizadoResponse").h("FECompUltimoAutorizadoResult")
	if e := mensajesDe(r.h("Errors")); e != "" {
		return nil, e
	}
	n := r.h("CbteNro")
	if n == nil {
		return nil, ""
	}
	v := jsmath.Numero(n.cadena())
	if v != v || v < 0 {
		return nil, ""
	}
	x := int64(v)
	return &x, ""
}

// Consulta es lo que ARCA tiene de un comprobante (FECompConsultar).
type Consulta struct {
	Existe         bool
	Resultado      string
	Cae            string
	CaeVencimiento *time.Time
	DocTipo        int64
	DocNro         float64
	ImpTotal       float64
	CbteFch        string
	Errores        string
}

// LeerConsulta interpreta FECompConsultar. El código 602 es «no existe».
func LeerConsulta(body *nodo) Consulta {
	r := body.h("FECompConsultarResponse").h("FECompConsultarResult")
	g := r.h("ResultGet")
	if g == nil {
		return Consulta{Errores: mensajesDe(r.h("Errors"))}
	}
	texto := func(n string) string {
		if x := g.h(n); x != nil {
			return x.cadena()
		}
		return ""
	}
	tipo, _ := strconv.ParseInt(texto("DocTipo"), 10, 64)
	return Consulta{Existe: true, Resultado: texto("Resultado"), Cae: texto("CodAutorizacion"),
		CaeVencimiento: DesdeFechaArca(texto("FchVto")), DocTipo: tipo, DocNro: jsmath.Numero(texto("DocNro")),
		ImpTotal: jsmath.Numero(texto("ImpTotal")), CbteFch: texto("CbteFch")}
}

// NoExiste dice si el error de la consulta es el 602 («no existen datos»).
func (c Consulta) NoExiste() bool { return !c.Existe && strings.Contains(c.Errores, "[602]") }

// Bitacora deja cada llamada en arca_log. Antes se anota el pedido (así
// queda aunque el proceso muera esperando la respuesta) y después la
// respuesta.
type Bitacora interface {
	Antes(ctx context.Context, invoiceID *string, operacion, ambiente, solicitud string) string
	Despues(ctx context.Context, id string, exito bool, respuesta string)
}

// HTTP es el cliente que habla con ARCA (las pruebas usan el del simulador).
var HTTP = &http.Client{}

const tiempoWsfe = 25 * time.Second

// ErrSinRespuesta es que no se pudo hablar con ARCA o la respuesta no se
// pudo leer: no se sabe qué pasó del otro lado.
var ErrSinRespuesta = errors.New("ARCA no respondió")

// Llamar manda un método al WSFEv1 y devuelve el Body.
func Llamar(ctx context.Context, cfg *Config, bit Bitacora, metodo, cuerpo string, invoiceID *string) (*nodo, error) {
	sobre := SobreWsfe(metodo, cuerpo)
	id := ""
	if bit != nil {
		id = bit.Antes(ctx, invoiceID, metodo, cfg.Ambiente, recortar(sobre))
	}
	texto, exito := "", false
	defer func() {
		if bit != nil {
			bit.Despues(context.WithoutCancel(ctx), id, exito, recortar(texto))
		}
	}()
	ctx, cancelar := context.WithTimeout(ctx, tiempoWsfe)
	defer cancelar()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.URLWsfe, bytes.NewReader([]byte(sobre)))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "text/xml; charset=utf-8")
	req.Header.Set("SOAPAction", nsFev1+metodo)
	resp, err := HTTP.Do(req)
	if err != nil {
		return nil, errors.Join(ErrSinRespuesta, err)
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	texto = string(b)
	if err != nil {
		return nil, errors.Join(ErrSinRespuesta, err)
	}
	exito = resp.StatusCode >= 200 && resp.StatusCode < 300
	if !exito {
		return nil, errors.New("ARCA respondió " + strconv.Itoa(resp.StatusCode))
	}
	raiz, err := leerXML(texto)
	if err != nil {
		return nil, errors.Join(ErrSinRespuesta, err)
	}
	body := raiz.h("Envelope").h("Body")
	if body == nil {
		body = &nodo{hijos: map[string][]*nodo{"_": nil}}
	}
	return body, nil
}

// recortar es .slice(0, 20_000) de JS (en unidades UTF-16).
func recortar(s string) string {
	n := 0
	for i, r := range s {
		u := 1
		if r >= 0x10000 {
			u = 2
		}
		if n+u > 20_000 {
			return s[:i]
		}
		n += u
	}
	return s
}
