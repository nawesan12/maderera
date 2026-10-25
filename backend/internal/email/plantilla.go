package email

import (
	"net/url"
	"regexp"
	"strings"

	"mjbj/internal/formato"
)

// La plantilla de los correos (lib/email/plantillas.ts → envolver): HTML con
// tablas y estilos en línea, que es lo único que se ve igual en Gmail, en
// Outlook y en el Mail del iPhone, y su versión en texto plano, que los
// filtros de spam piden. El golden (testdata/golden/email) la compara byte a
// byte con la del TS.

const (
	naranja       = "#F16A00"
	naranjaOscuro = "#B83300"
	gris          = "#1E1A16"
	grisSuave     = "#6B625A"
	crema         = "#F9F4EE"
	borde         = "#E4DCD1"
	blanco        = "#FFFFFF"
	fuente        = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
)

// Escapar prepara texto de afuera para meterlo en el HTML. Los párrafos y el
// cierre van crudos (las plantillas propias mandan <strong>), así que lo que
// escribe cualquiera —el formulario de contacto— pasa por acá antes.
func Escapar(t string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;").Replace(t)
}

// Bloque es una fila etiqueta/valor.
type Bloque struct{ Etiqueta, Valor string }

// LineaCorreo es un renglón de un pedido o un remito. Importe nil: sin
// precio (un remito no lleva).
type LineaCorreo struct {
	Descripcion string
	Cantidad    string
	Unidad      string
	Importe     *float64
}

// Enlace es el botón.
type Enlace struct{ Texto, URL string }

// Imagen va arriba del título (las campañas).
type Imagen struct{ URL, Alt string }

// Pie es algo más para el pie: el enlace de baja.
type Pie struct{ HTML, Texto string }

// Opciones del correo.
type Opciones struct {
	Titulo   string
	Adelanto string // la primera línea que se ve en la bandeja
	Saludo   string
	Parrafos []string
	Datos    []Bloque
	Lineas   []LineaCorreo
	Total    *float64
	CTA      *Enlace
	Cierre   string
	Imagen   *Imagen
	Pie      *Pie
}

var etiquetas = regexp.MustCompile(`<[^>]+>`)

func sinEtiquetas(s string) string { return etiquetas.ReplaceAllString(s, "") }

func filaDato(b Bloque) string {
	return `<tr>
    <td style="padding:6px 0;font-size:14px;color:` + grisSuave + `;">` + Escapar(b.Etiqueta) + `</td>
    <td style="padding:6px 0;font-size:14px;color:` + gris + `;font-weight:600;text-align:right;">` + Escapar(b.Valor) + `</td>
  </tr>`
}

func cantidadDe(l LineaCorreo) string {
	if l.Unidad != "" {
		return l.Cantidad + " " + l.Unidad
	}
	return l.Cantidad
}

func filaLinea(l LineaCorreo) string {
	importe := ""
	if l.Importe != nil {
		importe = `<td style="padding:10px 0;border-bottom:1px solid ` + borde + `;font-size:14px;color:` + gris + `;text-align:right;white-space:nowrap;">
      ` + Escapar(formato.Precio(*l.Importe)) + `
    </td>`
	}
	return `<tr>
    <td style="padding:10px 0;border-bottom:1px solid ` + borde + `;font-size:14px;color:` + gris + `;">
      ` + Escapar(l.Descripcion) + `<br>
      <span style="font-size:12px;color:` + grisSuave + `;">` + Escapar(cantidadDe(l)) + `</span>
    </td>
    ` + importe + `
  </tr>`
}

func unir[T any](xs []T, f func(T) string) string {
	var b strings.Builder
	for _, x := range xs {
		b.WriteString(f(x))
	}
	return b.String()
}

func si(c bool, s string) string {
	if c {
		return s
	}
	return ""
}

// Envolver arma el correo completo; sitio es la URL pública (APP_URL).
func Envolver(sitio string, o Opciones) (html, texto string) {
	sitio = strings.TrimSuffix(sitio, "/")
	host := sitio
	if u, err := url.Parse(sitio); err == nil {
		host = u.Host
	}

	parrafos := unir(o.Parrafos, func(p string) string {
		return `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:` + gris + `;">` + p + `</p>`
	})
	datos := si(len(o.Datos) > 0, `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;padding:16px;background:`+crema+`;border-radius:10px;">
        `+unir(o.Datos, filaDato)+`
       </table>`)
	lineas := ""
	if len(o.Lineas) > 0 {
		total := ""
		if o.Total != nil {
			total = `<tr>
                <td style="padding:14px 0 0;font-size:16px;font-weight:700;color:` + gris + `;">Total</td>
                <td style="padding:14px 0 0;font-size:18px;font-weight:700;color:` + gris + `;text-align:right;">` + Escapar(formato.Precio(*o.Total)) + `</td>
              </tr>`
		}
		lineas = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;">
        ` + unir(o.Lineas, filaLinea) + `
        ` + total + `
       </table>`
	}
	cta := ""
	if o.CTA != nil {
		cta = `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0;">
        <tr><td style="border-radius:8px;background:` + naranja + `;">
          <a href="` + o.CTA.URL + `" style="display:inline-block;padding:14px 26px;font-family:` + fuente + `;font-size:15px;font-weight:600;color:` + blanco + `;text-decoration:none;">` + Escapar(o.CTA.Texto) + `</a>
        </td></tr>
       </table>`
	}
	imagen := ""
	if o.Imagen != nil {
		imagen = `<tr><td><img src="` + Escapar(o.Imagen.URL) + `" alt="` + Escapar(o.Imagen.Alt) + `" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;"></td></tr>`
	}
	pie := ""
	if o.Pie != nil {
		pie = `<br><br>` + o.Pie.HTML
	}

	html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>` + Escapar(o.Titulo) + `</title></head>
<body style="margin:0;padding:0;background:` + crema + `;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">` + Escapar(o.Adelanto) + `</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:` + crema + `;padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:` + blanco + `;border-radius:14px;overflow:hidden;border:1px solid ` + borde + `;">
    <tr><td style="background:` + gris + `;padding:20px 28px;">
      <span style="font-family:` + fuente + `;font-size:17px;font-weight:700;color:` + blanco + `;letter-spacing:-0.2px;">Maderera Juan B. Justo</span><br>
      <span style="font-family:` + fuente + `;font-size:12px;color:#B9AFA4;">Tu proyecto. Nuestra madera.</span>
    </td></tr>
    ` + imagen + `
    <tr><td style="padding:28px;font-family:` + fuente + `;">
      <h1 style="margin:0 0 16px;font-size:21px;line-height:1.3;color:` + gris + `;">` + Escapar(o.Titulo) + `</h1>
      ` + si(o.Saludo != "", `<p style="margin:0 0 14px;font-size:15px;color:`+gris+`;">Hola `+Escapar(o.Saludo)+`,</p>`) + `
      ` + parrafos + `
      ` + datos + `
      ` + lineas + `
      ` + cta + `
      ` + si(o.Cierre != "", `<p style="margin:18px 0 0;font-size:14px;color:`+grisSuave+`;line-height:1.6;">`+o.Cierre+`</p>`) + `
    </td></tr>
    <tr><td style="padding:18px 28px;background:` + crema + `;border-top:1px solid ` + borde + `;font-family:` + fuente + `;font-size:12px;color:` + grisSuave + `;line-height:1.6;">
      Casa Central · Av. Juan B. Justo 4153 · (0223) 474-3328<br>
      Aserradero · Canosa 61 · (0223) 483-0535<br>
      <a href="` + sitio + `" style="color:` + naranjaOscuro + `;text-decoration:none;">` + host + `</a>
      ` + pie + `
    </td></tr>
  </table>
</td></tr></table>
</body></html>`

	t := []string{o.Titulo, ""}
	if o.Saludo != "" {
		t = append(t, "Hola "+o.Saludo+",")
	}
	for _, p := range o.Parrafos {
		t = append(t, sinEtiquetas(p))
	}
	if len(o.Datos) > 0 {
		filas := make([]string, len(o.Datos))
		for i, d := range o.Datos {
			filas[i] = d.Etiqueta + ": " + d.Valor
		}
		t = append(t, "\n"+strings.Join(filas, "\n"))
	}
	if len(o.Lineas) > 0 {
		filas := make([]string, len(o.Lineas))
		for i, l := range o.Lineas {
			filas[i] = "- " + l.Descripcion + " (" + cantidadDe(l) + ")"
			if l.Importe != nil {
				filas[i] += " " + formato.Precio(*l.Importe)
			}
		}
		t = append(t, "\n"+strings.Join(filas, "\n"))
	}
	if o.Total != nil {
		t = append(t, "\nTotal: "+formato.Precio(*o.Total))
	}
	if o.CTA != nil {
		t = append(t, "\n"+o.CTA.Texto+": "+o.CTA.URL)
	}
	if o.Cierre != "" {
		t = append(t, "\n"+sinEtiquetas(o.Cierre))
	}
	t = append(t, "\n—\nMaderera Juan B. Justo · Mar del Plata\nCasa Central (0223) 474-3328 · Aserradero (0223) 483-0535")
	if o.Pie != nil {
		t = append(t, "\n"+o.Pie.Texto)
	}
	return html, strings.Join(t, "\n")
}
