package reportes

import (
	"context"
	"sort"
	"time"

	"mjbj/internal/jsmath"
)

// La posición de IVA del mes (revisión del comité, T6). Antes era débito −
// crédito y nada más: no restaba las percepciones ni las retenciones de IVA
// que nos hicieron, no arrastraba el saldo a favor del mes anterior y podía
// dar negativa. ARCA separa dos saldos que no se mezclan:
//
//   - el **técnico**: el crédito fiscal que supera al débito. Solo se usa
//     contra débito de los meses que vienen;
//   - el de **libre disponibilidad**: las percepciones y retenciones que
//     sobran después de cubrir el impuesto. Pasa al mes siguiente también.
//
// A depositar nunca es negativo: lo que sobra queda en uno de los dos saldos.

// PosicionDeIva es la cuenta del mes, con lo que viene del anterior y lo que
// pasa al siguiente.
type PosicionDeIva struct {
	Debito               float64 `json:"debito"`
	Credito              float64 `json:"credito"`
	SaldoTecnicoAnterior float64 `json:"saldoTecnicoAnterior"`
	Percepciones         float64 `json:"percepciones"`
	Retenciones          float64 `json:"retenciones"`
	SaldoLibreAnterior   float64 `json:"saldoLibreAnterior"`
	ADepositar           float64 `json:"aDepositar"`
	// SaldoTecnico y SaldoLibre son los saldos a favor que quedan.
	SaldoTecnico float64 `json:"saldoTecnico"`
	SaldoLibre   float64 `json:"saldoLibre"`
}

// CalcularPosicionDeIva hace la cuenta de un mes: el impuesto determinado
// (débito − crédito − saldo técnico anterior) y, contra él, los pagos a
// cuenta (percepciones, retenciones y el saldo de libre disponibilidad).
func CalcularPosicionDeIva(debito, credito, tecnicoAnterior, percepciones, retenciones, libreAnterior float64) PosicionDeIva {
	r := jsmath.Redondear2
	p := PosicionDeIva{Debito: r(debito), Credito: r(credito), SaldoTecnicoAnterior: r(tecnicoAnterior), Percepciones: r(percepciones),
		Retenciones: r(retenciones), SaldoLibreAnterior: r(libreAnterior)}
	determinado := r(float64(p.Debito-p.Credito) - p.SaldoTecnicoAnterior)
	if determinado < 0 {
		p.SaldoTecnico, determinado = -determinado, 0
	}
	aPagar := r(float64(float64(determinado-p.Percepciones)-p.Retenciones) - p.SaldoLibreAnterior)
	if aPagar < 0 {
		p.SaldoLibre, aPagar = -aPagar, 0
	}
	p.ADepositar = aPagar
	return p
}

type ivaDelMes struct{ debito, credito, percepciones, retenciones float64 }

// PosicionDeIvaDelMes recorre los meses desde el primero con movimiento
// hasta el del cierre, arrastrando los dos saldos. `desde` es el comienzo del
// mes del cierre (en UTC, como PeriodoDelCierre).
func (s *Servicio) PosicionDeIvaDelMes(ctx context.Context, desde, hasta time.Time) (PosicionDeIva, error) {
	_, ihasta := instantes(desde, hasta)
	meses := map[string]*ivaDelMes{}
	mes := func(m string) *ivaDelMes {
		if meses[m] == nil {
			meses[m] = &ivaDelMes{}
		}
		return meses[m]
	}
	// Las ventas se cortan en el mes argentino (son instantes); las compras y
	// las retenciones, en UTC (son días a las 0 UTC). Las notas de crédito
	// restan.
	rs, err := s.pool.Query(ctx, `
		SELECT to_char(fecha_emision AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM'),
		  coalesce(sum(CASE WHEN tipo::text LIKE 'nota_credito%' THEN -1 ELSE 1 END * (iva21 + iva105 + iva27)), 0)::float8
		FROM invoices WHERE fecha_emision <= $1 AND `+conCae+` GROUP BY 1`, ihasta)
	if err != nil {
		return PosicionDeIva{}, err
	}
	for rs.Next() {
		var m string
		var v float64
		if err := rs.Scan(&m, &v); err != nil {
			rs.Close()
			return PosicionDeIva{}, err
		}
		mes(m).debito = v
	}
	rs.Close()
	if err := rs.Err(); err != nil {
		return PosicionDeIva{}, err
	}
	rs, err = s.pool.Query(ctx, `
		SELECT to_char(fecha_emision AT TIME ZONE 'UTC', 'YYYY-MM'),
		  coalesce(sum(CASE WHEN tipo::text LIKE 'nota_credito%' THEN -1 ELSE 1 END * (iva21 + iva105 + iva27))
		    FILTER (WHERE tipo::text IN ('factura_a','factura_m','nota_credito_a','nota_debito_a')), 0)::float8,
		  coalesce(sum(CASE WHEN tipo::text LIKE 'nota_credito%' THEN -1 ELSE 1 END * coalesce(percepcion_iva, 0)), 0)::float8
		FROM purchase_invoices WHERE fecha_emision <= $1 AND anulada_at IS NULL GROUP BY 1`, hasta)
	if err != nil {
		return PosicionDeIva{}, err
	}
	for rs.Next() {
		var m string
		var c, p float64
		if err := rs.Scan(&m, &c, &p); err != nil {
			rs.Close()
			return PosicionDeIva{}, err
		}
		mes(m).credito, mes(m).percepciones = c, p
	}
	rs.Close()
	if err := rs.Err(); err != nil {
		return PosicionDeIva{}, err
	}
	rs, err = s.pool.Query(ctx, `
		SELECT to_char(fecha AT TIME ZONE 'UTC', 'YYYY-MM'), coalesce(sum(importe), 0)::float8
		FROM retenciones_sufridas WHERE impuesto = 'iva' AND anulada_at IS NULL AND fecha <= $1 GROUP BY 1`, hasta)
	if err != nil {
		return PosicionDeIva{}, err
	}
	for rs.Next() {
		var m string
		var v float64
		if err := rs.Scan(&m, &v); err != nil {
			rs.Close()
			return PosicionDeIva{}, err
		}
		mes(m).retenciones = v
	}
	rs.Close()
	if err := rs.Err(); err != nil {
		return PosicionDeIva{}, err
	}

	objetivo := desde.UTC().Format("2006-01")
	orden := make([]string, 0, len(meses)+1)
	for m := range meses {
		if m <= objetivo {
			orden = append(orden, m)
		}
	}
	if meses[objetivo] == nil {
		orden = append(orden, objetivo)
		mes(objetivo)
	}
	sort.Strings(orden)
	// Los meses sin nada en el medio no cambian los saldos: alcanza con
	// recorrer los que tienen algo.
	var p PosicionDeIva
	for _, m := range orden {
		x := meses[m]
		p = CalcularPosicionDeIva(x.debito, x.credito, p.SaldoTecnico, x.percepciones, x.retenciones, p.SaldoLibre)
	}
	return p, nil
}
