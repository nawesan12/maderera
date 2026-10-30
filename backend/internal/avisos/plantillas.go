package avisos

import (
	"math"
	"strings"

	"mjbj/internal/email"
	"mjbj/internal/formato"
)

// Las plantillas de los avisos de cobros y de facturación
// (lib/email/plantillas.ts: reciboEmitido, chequeRechazado y
// facturaEmitida), comparadas con el TS en el golden de avisos.

func base(sitio string) string { return strings.TrimSuffix(sitio, "/") }

func armar(sitio, asunto string, o email.Opciones) Correo {
	html, texto := email.Envolver(sitio, o)
	return Correo{Asunto: asunto, HTML: html, Texto: texto}
}

// ReciboEmitido es el correo del recibo; saldo nil si el recibo no movió
// la cuenta.
func ReciboEmitido(sitio, nombre, numero string, total float64, medios string, saldo *float64) Correo {
	datos := []email.Bloque{{Etiqueta: "Recibo", Valor: numero}, {Etiqueta: "Importe", Valor: formato.Precio(total)},
		{Etiqueta: "Forma de pago", Valor: medios}}
	if saldo != nil {
		etiqueta := "Saldo de tu cuenta"
		if *saldo < -0.005 {
			etiqueta = "A tu favor"
		}
		datos = append(datos, email.Bloque{Etiqueta: etiqueta, Valor: formato.Precio(math.Abs(*saldo))})
	}
	return armar(sitio, "Recibo "+numero+" · "+formato.Precio(total), email.Opciones{
		Titulo:   "Recibimos tu pago",
		Adelanto: "Recibo " + numero + " por " + formato.Precio(total) + ".",
		Saludo:   nombre,
		Parrafos: []string{"Te adjuntamos el recibo. Ya está imputado en tu cuenta, y lo vas a encontrar también en Mi cuenta → Movimientos."},
		Datos:    datos,
		CTA:      &email.Enlace{Texto: "Ver mis movimientos", URL: base(sitio) + "/mi-cuenta/movimientos"},
	})
}

// ChequeRechazado es el correo de un cheque que no se pudo tomar o que el
// banco rechazó.
func ChequeRechazado(sitio, nombre, cheque string, importe float64, motivo string, porElBanco bool) Correo {
	titulo, parrafo, asunto := "No pudimos tomar un cheque",
		"Revisamos el cheque que nos informaste y no lo pudimos tomar. Tu cuenta no cambió: el importe sigue pendiente.",
		"No pudimos tomar tu cheque · "+cheque
	if porElBanco {
		titulo, parrafo, asunto = "El banco rechazó un cheque",
			"El banco rechazó este cheque, así que su importe volvió a tu cuenta corriente. Escribinos para ver cómo lo reponés.",
			"Cheque rechazado · "+cheque
	}
	datos := []email.Bloque{{Etiqueta: "Cheque", Valor: cheque}, {Etiqueta: "Importe", Valor: formato.Precio(importe)}}
	if motivo != "" {
		datos = append(datos, email.Bloque{Etiqueta: "Motivo", Valor: motivo})
	}
	return armar(sitio, asunto, email.Opciones{
		Titulo:   titulo,
		Adelanto: cheque + " por " + formato.Precio(importe) + ".",
		Saludo:   nombre,
		Parrafos: []string{parrafo},
		Datos:    datos,
		CTA:      &email.Enlace{Texto: "Ver mi cuenta", URL: base(sitio) + "/mi-cuenta/movimientos"},
	})
}

// FacturaEmitida es el correo con el comprobante adjunto.
func FacturaEmitida(sitio, nombre, comprobante string, total float64, conCae bool) Correo {
	parrafos := []string{"Te lo adjuntamos en PDF. También queda disponible en tu cuenta, junto con todos los anteriores."}
	if !conCae {
		parrafos = append(parrafos, "<strong>Atención:</strong> este comprobante todavía no tiene autorización de ARCA y no tiene validez fiscal. Te enviamos el definitivo apenas se autorice.")
	}
	return armar(sitio, "Comprobante "+comprobante, email.Opciones{
		Titulo:   "Tu comprobante " + comprobante,
		Adelanto: "Adjuntamos el comprobante " + comprobante + ".",
		Saludo:   nombre,
		Parrafos: parrafos,
		Datos:    []email.Bloque{{Etiqueta: "Comprobante", Valor: comprobante}, {Etiqueta: "Total", Valor: formato.Precio(total)}},
		CTA:      &email.Enlace{Texto: "Ver mis comprobantes", URL: base(sitio) + "/mi-cuenta/comprobantes"},
	})
}
