package reportes

import (
	"context"
	"errors"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"

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
//
// **La cuenta arranca de lo presentado** (revisión del comité, T6): el
// contador carga el mes que sigue a la última DDJJ y los dos saldos que dejó
// (configuracion_fiscal.iva_desde y los saldos), y los vuelve a cargar cuando
// presenta. Antes se recorría desde el primer registro de la base: un saldo a
// favor del sistema anterior no estaba, las compras de la puesta en marcha
// (con las ventas en homologación, sin débito) se acumulaban como saldo
// técnico, y el saldo de libre disponibilidad compensado con otro impuesto
// crecía para siempre. Lo que se carga después de anclar con fecha de un mes
// ya presentado (la factura de compra que llegó tarde) cuenta en el mes en
// que se cargó, que es donde el estudio la va a computar. Sin arranque, la
// posición se calcula igual pero dice que no tiene de dónde partir y el
// cierre lo pide.

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
	// SinArranque: no hay saldo de arranque cargado para este mes; los
	// saldos anteriores son los de la base y no los de la última DDJJ.
	SinArranque bool `json:"sinArranque"`
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
	// El arranque: "" si no está cargado.
	var arranque string
	var tecnico, libre float64
	var anclado *time.Time
	err := s.pool.QueryRow(ctx, `SELECT coalesce(to_char(iva_desde, 'YYYY-MM'), ''), iva_saldo_tecnico::float8, iva_saldo_libre::float8, iva_anclado_at
		FROM configuracion_fiscal LIMIT 1`).Scan(&arranque, &tecnico, &libre, &anclado)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return PosicionDeIva{}, err
	}
	// El mes de lo que se cargó después de anclar con fecha de un mes ya
	// presentado: el de la carga (argentino), y nunca antes del arranque.
	tarde := func(fecha string) string {
		return `CASE WHEN $2::text <> '' AND ` + fecha + ` < to_date(nullif($2, ''), 'YYYY-MM') AND created_at > $3
			THEN greatest($2, to_char(created_at AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM'))
			ELSE to_char(` + fecha + ` AT TIME ZONE 'UTC', 'YYYY-MM') END`
	}
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
		SELECT `+tarde("fecha_emision")+`,
		  coalesce(sum(CASE WHEN tipo::text LIKE 'nota_credito%' THEN -1 ELSE 1 END * (iva21 + iva105 + iva27))
		    FILTER (WHERE tipo::text IN ('factura_a','factura_m','nota_credito_a','nota_debito_a')), 0)::float8,
		  coalesce(sum(CASE WHEN tipo::text LIKE 'nota_credito%' THEN -1 ELSE 1 END * coalesce(percepcion_iva, 0)), 0)::float8
		FROM purchase_invoices WHERE fecha_emision <= $1 AND anulada_at IS NULL GROUP BY 1`, hasta, arranque, anclado)
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
		// Dos grupos pueden caer en el mismo mes (el del mes y lo cargado
		// tarde): se suman.
		mes(m).credito, mes(m).percepciones = mes(m).credito+c, mes(m).percepciones+p
	}
	rs.Close()
	if err := rs.Err(); err != nil {
		return PosicionDeIva{}, err
	}
	rs, err = s.pool.Query(ctx, `
		SELECT `+tarde("fecha")+`, coalesce(sum(importe), 0)::float8
		FROM retenciones_sufridas WHERE impuesto = 'iva' AND anulada_at IS NULL AND fecha <= $1 GROUP BY 1`, hasta, arranque, anclado)
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
		mes(m).retenciones += v
	}
	rs.Close()
	if err := rs.Err(); err != nil {
		return PosicionDeIva{}, err
	}

	objetivo := desde.UTC().Format("2006-01")
	anclada := arranque != "" && arranque <= objetivo
	orden := make([]string, 0, len(meses)+1)
	for m := range meses {
		if m <= objetivo && (!anclada || m >= arranque) {
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
	if anclada {
		p.SaldoTecnico, p.SaldoLibre = tecnico, libre
	}
	for _, m := range orden {
		x := meses[m]
		p = CalcularPosicionDeIva(x.debito, x.credito, p.SaldoTecnico, x.percepciones, x.retenciones, p.SaldoLibre)
	}
	p.SinArranque = !anclada
	return p, nil
}
