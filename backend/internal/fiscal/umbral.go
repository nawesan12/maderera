package fiscal

import (
	"time"

	"mjbj/internal/formato"
)

// El monto desde el que una factura B a consumidor final tiene que
// identificar al comprador (DNI o CUIT). ARCA rechaza la que llega sin
// documento, y un rechazo traba la serie entera: por eso se mira antes de
// numerar, no al pedir el CAE.
//
// Va con su vigencia: cuando ARCA lo suba se agrega un renglón, y los
// comprobantes con fecha anterior siguen con el monto de su día. Es sobre el
// total con impuestos (ImpTotal), que es lo que ARCA compara.
//
// Hoy: $10.000.000, RG 5700/2025. El contador lo confirma
// (docs/CONTADOR-SIN-CAE.md); si dice otra cosa, se cambia acá y en
// lib/fiscal/umbral.ts (tests/umbral-b.test.ts los compara).
var umbralesIdentificacion = []struct {
	desde time.Time
	monto float64
}{
	{time.Time{}, 10_000_000},
}

// MontoIdentificarConsumidorFinal es el umbral vigente en esa fecha.
func MontoIdentificarConsumidorFinal(fecha time.Time) float64 {
	monto := umbralesIdentificacion[0].monto
	for _, u := range umbralesIdentificacion {
		if !fecha.Before(u.desde) {
			monto = u.monto
		}
	}
	return monto
}

// FaltaIdentificarComprador es el motivo para no numerar una B sin documento
// que llega al umbral, o "" si se puede.
func FaltaIdentificarComprador(tipo string, total float64, cuit *string, fecha time.Time) string {
	if LetraDe(tipo) != "B" {
		return ""
	}
	umbral := MontoIdentificarConsumidorFinal(fecha)
	if total < umbral {
		return ""
	}
	if tipoDoc, _ := DocumentoReceptor(cuit); tipoDoc != DocConsumidorFinal {
		return ""
	}
	return "Desde " + formato.MonedaEntera(umbral) + " hay que cargar el DNI o CUIT del comprador."
}
