package fiscal

import (
	"math"

	"mjbj/internal/jsmath"
)

// ItemOriginal es un renglón del comprobante que se corrige (el subtotal es
// final, con IVA adentro).
type ItemOriginal struct {
	ID          string  `json:"id"`
	Descripcion string  `json:"descripcion"`
	Unidad      string  `json:"unidad"`
	Cantidad    float64 `json:"cantidad"`
	Subtotal    float64 `json:"subtotal"`
	AlicuotaIva float64 `json:"alicuotaIva"`
}

// CantidadAAcreditar es cuánto de un renglón.
type CantidadAAcreditar struct {
	ItemID   string  `json:"itemId"`
	Cantidad float64 `json:"cantidad"`
}

// LineaDeNota es un renglón de la nota.
type LineaDeNota struct {
	Descripcion         string  `json:"descripcion"`
	Unidad              string  `json:"unidad"`
	Cantidad            float64 `json:"cantidad"`
	PrecioFinalUnitario float64 `json:"precioFinalUnitario"`
	Alicuota            float64 `json:"alicuota"`
	ItemOrigenID        string  `json:"itemOrigenId"`
}

// ErrorDeNota es el `throw new Error(...)` de lineasDeLaNota: un motivo que
// se muestra tal cual.
type ErrorDeNota struct{ Mensaje string }

func (e *ErrorDeNota) Error() string { return e.Mensaje }

// LineasDeLaNota: el unitario sale del original (subtotal / cantidad de la
// factura), no de la cantidad parcial. parciales en nil es por el total.
func LineasDeLaNota(items []ItemOriginal, parciales []CantidadAAcreditar) ([]LineaDeNota, error) {
	unitario := func(i ItemOriginal) float64 {
		if i.Cantidad > 0 {
			return Redondear(i.Subtotal / i.Cantidad)
		}
		return 0
	}
	if parciales == nil {
		out := make([]LineaDeNota, len(items))
		for k, i := range items {
			out[k] = LineaDeNota{i.Descripcion, i.Unidad, i.Cantidad, unitario(i), i.AlicuotaIva, i.ID}
		}
		return out, nil
	}
	out := []LineaDeNota{}
	for _, p := range parciales {
		var item *ItemOriginal
		for k := range items {
			if items[k].ID == p.ItemID {
				item = &items[k]
				break
			}
		}
		if item == nil {
			continue
		}
		if math.IsNaN(p.Cantidad) || math.IsInf(p.Cantidad, 0) || p.Cantidad <= 0 {
			continue
		}
		if p.Cantidad > item.Cantidad {
			return nil, &ErrorDeNota{`No se puede acreditar más de lo facturado en "` + item.Descripcion + `".`}
		}
		out = append(out, LineaDeNota{item.Descripcion, item.Unidad, p.Cantidad, unitario(*item), item.AlicuotaIva, item.ID})
	}
	return out, nil
}

// Tributo es una percepción u otro tributo del comprobante.
type Tributo struct {
	Codigo      string  `json:"codigo"`
	Descripcion string  `json:"descripcion"`
	Base        float64 `json:"base"`
	Alicuota    float64 `json:"alicuota"`
	Importe     float64 `json:"importe"`
}

// ProrratearTributos copia los del original en proporción (la alícuota no se
// toca: es la que tuvo la factura).
func ProrratearTributos(tributos []Tributo, proporcion float64) []Tributo {
	if proporcion >= 1 {
		return tributos
	}
	out := make([]Tributo, len(tributos))
	for i, t := range tributos {
		t.Base = Redondear(float64(t.Base * proporcion))
		t.Importe = Redondear(float64(t.Importe * proporcion))
		out[i] = t
	}
	return out
}

const tolerancia = 0.005

// RevisarAcreditacion devuelve por qué no se puede acreditar ese monto, o "".
func RevisarAcreditacion(totalOriginal, acreditado, monto float64) string {
	if math.IsNaN(monto) || math.IsInf(monto, 0) || monto <= 0 {
		return "El monto a acreditar tiene que ser mayor a cero."
	}
	disponible := totalOriginal - acreditado
	if monto > disponible+tolerancia {
		return "Ya se acreditaron $" + jsmath.ToFixed(acreditado, 2) + " de $" + jsmath.ToFixed(totalOriginal, 2) +
			": quedan $" + jsmath.ToFixed(math.Max(0, disponible), 2) + "."
	}
	return ""
}

// --- las cuentas de emitir.ts, separadas de la base para el golden ---

// Emision son los importes que se guardan al emitir.
type Emision struct {
	Totales       Totales   `json:"totales"`
	Tributos      []Tributo `json:"tributos"`
	TotalTributos float64   `json:"totalTributos"`
	Total         float64   `json:"total"`
	Iva21         float64   `json:"iva21"`
	Iva105        float64   `json:"iva105"`
	Iva27         float64   `json:"iva27"`
}

// Importes es la parte de cuentas de emitirEnTransaccion: los totales, la
// percepción de IIBB (o los tributos ya dados de una nota) y el total.
func Importes(lineas []LineaEntrada, tributosDados []Tributo, percibeIibb bool, alicuotaIibb float64) Emision {
	t := CalcularTotales(lineas)
	tributos := []Tributo{}
	if tributosDados != nil {
		tributos = append(tributos, tributosDados...)
	} else if percibeIibb && alicuotaIibb > 0 {
		if imp := Redondear(float64(t.Neto*alicuotaIibb) / 100); imp > 0 {
			tributos = append(tributos, Tributo{Codigo: "02", Descripcion: "Percepción Ingresos Brutos", Base: t.Neto, Alicuota: alicuotaIibb, Importe: imp})
		}
	}
	suma := 0.0
	for _, x := range tributos {
		suma += x.Importe
	}
	totalTributos := Redondear(suma)
	return Emision{Totales: t, Tributos: tributos, TotalTributos: totalTributos, Total: Redondear(t.Total + totalTributos),
		Iva21: t.IvaDe(21), Iva105: t.IvaDe(10.5), Iva27: t.IvaDe(27)}
}

// Original son los importes guardados del comprobante que se corrige.
type Original struct {
	Neto, Iva21, Iva105, Iva27, Exento, Total, Acreditado float64
}

// CalculoDeNota es lo que emitirNotaDeCredito calcula antes de emitir.
type CalculoDeNota struct {
	Lineas        []LineaDeNota `json:"lineas"`
	Neto          float64       `json:"neto"`
	Proporcion    float64       `json:"proporcion"`
	TributosDados []Tributo     `json:"tributosDados"`
	Total         float64       `json:"total"`
	Problema      string        `json:"problema"`
}

// CalcularNota arma la nota de crédito: los renglones, la proporción sobre la
// mercadería, los tributos prorrateados y el tope de lo que queda por
// acreditar. Problema trae el motivo si no se puede.
func CalcularNota(o Original, items []ItemOriginal, parciales []CantidadAAcreditar, tributos []Tributo) CalculoDeNota {
	lineas, err := LineasDeLaNota(items, parciales)
	if err != nil {
		return CalculoDeNota{Problema: err.Error()}
	}
	if len(lineas) == 0 {
		return CalculoDeNota{Problema: "No hay nada que acreditar."}
	}
	suma := 0.0
	for _, l := range lineas {
		suma = suma + float64(l.Cantidad*l.PrecioFinalUnitario)
	}
	neto := Redondear(suma)
	base := o.Neto + o.Iva21 + o.Iva105 + o.Iva27 + o.Exento
	proporcion := 1.0
	if base > 0 {
		proporcion = jsMin(1, neto/base)
	}
	dados := ProrratearTributos(tributos, proporcion)
	st := 0.0
	for _, x := range dados {
		st += x.Importe
	}
	total := Redondear(neto + st)
	c := CalculoDeNota{Lineas: lineas, Neto: neto, Proporcion: proporcion, TributosDados: dados, Total: total}
	c.Problema = RevisarAcreditacion(o.Total, o.Acreditado, total)
	return c
}

// jsMin es Math.min de dos: NaN si alguno es NaN.
func jsMin(a, b float64) float64 {
	if math.IsNaN(a) || math.IsNaN(b) {
		return math.NaN()
	}
	return math.Min(a, b)
}

// TotalDeLineas es el reduce `t + l.cantidad * l.precioFinalUnitario`
// redondeado (lo que se suma a `debitado` en una nota de débito).
func TotalDeLineas(lineas []LineaEntrada) float64 {
	suma := 0.0
	for _, l := range lineas {
		suma = suma + float64(l.Cantidad*l.PrecioFinalUnitario)
	}
	return Redondear(suma)
}

// ClaveDeLock es claveDeLock de numeracion.ts: el entero del candado por
// punto de venta y tipo, (hash % 1e6) * 1e4 + pv. Mientras convivan los dos
// lados, tiene que dar lo mismo que el TS.
func ClaveDeLock(puntoVenta int64, tipo string) int64 {
	hash := int32(5381)
	for _, u := range utf16De(tipo) {
		// (hash * 33) ^ c en JS: el producto es un double exacto y el ^ lo
		// pasa a int32 (módulo 2^32).
		hash = int32(uint32(int64(hash)*33)) ^ int32(u)
	}
	return int64(uint32(hash)%1_000_000)*10_000 + puntoVenta%10_000
}

// utf16De es `for (const c of s) c.charCodeAt(0)`: por punto de código, su
// primera unidad UTF-16.
func utf16De(s string) []uint16 {
	out := []uint16{}
	for _, r := range s {
		if r >= 0x10000 {
			out = append(out, uint16(0xD800+((r-0x10000)>>10)))
			continue
		}
		out = append(out, uint16(r))
	}
	return out
}
