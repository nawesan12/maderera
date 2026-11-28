package cobros

import (
	"context"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/jsmath"
)

// ParteCobrada es una parte de un recibo, para saber a qué circuito va cada
// peso: con qué se pagó, cuánto, si es un cheque marcado del B y, si es un
// cheque, cuál.
type ParteCobrada struct {
	Medio   string  `json:"medio"`
	Importe float64 `json:"importe"`
	Negro   bool    `json:"negro"`
	Cheque  string  `json:"cheque"`
}

func centavo(v float64) float64 { return jsmath.Round(float64(v*100)) / 100 }

// bancarizada: la que deja rastro en un banco o en ARCA (ver
// reportes.ParteDeRecibo.Bancarizado).
func (p ParteCobrada) bancarizada() bool {
	return p.Medio != "efectivo" && p.Medio != "retencion" && !p.Negro
}

// BlancoDeCadaParte es cuánto de cada parte va al archivo del estudio cuando
// el recibo manda `blanco` ahí: las retenciones primero, después lo
// bancarizado y al final el efectivo; un cheque del B nunca. Es la regla de
// reportes.PartesPorCircuito, que la usa: el asiento del recibo, el de su
// cheque cuando se deposita o rebota, y el pase de lo cobrado en el B al
// archivo del estudio cuando el pedido se factura, reparten igual.
func BlancoDeCadaParte(partes []ParteCobrada, blanco float64) []float64 {
	falta := blanco
	asignado := make([]float64, len(partes))
	for _, orden := range []func(ParteCobrada) bool{
		func(p ParteCobrada) bool { return p.Medio == "retencion" },
		func(p ParteCobrada) bool { return p.bancarizada() },
		func(p ParteCobrada) bool { return p.Medio == "efectivo" && !p.Negro },
	} {
		for i, p := range partes {
			if orden(p) && asignado[i] == 0 {
				x := min(p.Importe, max(falta, 0))
				asignado[i] = centavo(x)
				falta = centavo(falta - asignado[i])
			}
		}
	}
	return asignado
}

// chequesDelReparto: lo que cada cheque del recibo lleva al blanco con su
// reparto.
func chequesDelReparto(partes []ParteCobrada, blanco float64) map[string]float64 {
	out := map[string]float64{}
	for i, x := range BlancoDeCadaParte(partes, blanco) {
		if partes[i].Cheque != "" {
			out[partes[i].Cheque] = centavo(out[partes[i].Cheque] + x)
		}
	}
	return out
}

// marcarCheques guarda en cada cheque del recibo el circuito que le dio el
// reparto (cheques.circuito_reparto): «negro» si va entero al B, «blanco» si
// va entero al archivo del estudio y «partido» si se reparte. Así el
// depósito, el endoso y el rechazo del cheque que cobró una venta sin factura
// van al mismo archivo por el que entró (mes simulado, M3S3-001): antes el
// cheque quedaba «blanco» aunque el recibo lo mandara entero al B, y su
// acreditación o su rechazo salían del archivo del estudio, que nunca lo
// había recibido.
func marcarCheques(ctx context.Context, tx pgx.Tx, recibo string, blanco float64) error {
	rs, err := tx.Query(ctx, `SELECT x.medio::text, x.importe::float8, coalesce(ch.circuito = 'negro', false), coalesce(x.cheque_id::text, '')
		FROM receipt_parts x LEFT JOIN cheques ch ON ch.id = x.cheque_id WHERE x.receipt_id = $1 ORDER BY x.orden, x.id`, recibo)
	if err != nil {
		return err
	}
	var partes []ParteCobrada
	var p ParteCobrada
	if _, err := pgx.ForEachRow(rs, []any{&p.Medio, &p.Importe, &p.Negro, &p.Cheque}, func() error {
		partes = append(partes, p)
		return nil
	}); err != nil {
		return err
	}
	importe := map[string]float64{}
	for _, x := range partes {
		if x.Cheque != "" {
			importe[x.Cheque] = centavo(importe[x.Cheque] + x.Importe)
		}
	}
	lote := &pgx.Batch{}
	for id, bl := range chequesDelReparto(partes, blanco) {
		circuito := "partido"
		switch {
		case bl <= 0.005:
			circuito = "negro"
		case bl >= importe[id]-0.005:
			circuito = "blanco"
		}
		lote.Queue(`UPDATE cheques SET circuito_reparto = $2 WHERE id = $1`, id, circuito)
	}
	if lote.Len() == 0 {
		return nil
	}
	return tx.SendBatch(ctx, lote).Close()
}
