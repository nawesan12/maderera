package reportes

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/jsmath"
)

// Las cobranzas del período (/admin/pagos).
//
// La pantalla se llamaba «Cobros» y mostraba solo los cobros en línea (la
// tabla payments): lo que se cobraba en el mostrador, desde la ficha de un
// cliente o con un cheque no aparecía, y el total del mes no era el de
// nadie. Ahora es toda la plata que entró de clientes:
//
//   - **Los recibos** emitidos en el período, de cualquier origen (el panel,
//     el mostrador, el portal, Mercado Pago, el cobro de una factura), con sus
//     partes: cada medio con su importe y, si es un cheque, el cheque. Los
//     anulados se listan marcados y no suman.
//   - **Los cobros en línea que ningún recibo nombra**: el pedido pagado en
//     el sitio con Mercado Pago o con una transferencia informada y
//     acreditada. No emiten recibo, pero son plata cobrada.
//
// Lo que no está: la venta del mostrador cobrada al contado. Es una venta
// (está en Caja, «Emitido en el mostrador», y en su cierre Z), no una
// cobranza de algo que se debía.

// ParteDeCobranza es un medio de un cobro.
type ParteDeCobranza struct {
	Medio    string  `json:"medio"`
	Importe  float64 `json:"importe"`
	ChequeID *string `json:"chequeId"`
}

// Cobranza es un renglón: un recibo o un cobro en línea sin recibo.
type Cobranza struct {
	ID         string            `json:"id"`
	Tipo       string            `json:"tipo"` // «recibo» o «en-linea»
	Numero     *string           `json:"numero"`
	Fecha      time.Time         `json:"fecha"`
	Cliente    string            `json:"cliente"`
	CustomerID *string           `json:"customerId"`
	OrderID    *string           `json:"orderId"`
	Origen     string            `json:"origen"`
	Anulado    bool              `json:"anulado"`
	Total      float64           `json:"total"`
	Partes     []ParteDeCobranza `json:"partes"`
}

// TotalPorMedio es lo cobrado por un medio en el período.
type TotalPorMedio struct {
	Medio    string  `json:"medio"`
	Total    float64 `json:"total"`
	Cantidad int     `json:"cantidad"`
}

// Cobranzas es la página pedida y los totales del período entero (sumados
// en la base, no en la página).
type Cobranzas struct {
	Filas    []Cobranza      `json:"filas"`
	Total    int             `json:"total"`
	Cobrado  float64         `json:"cobrado"`
	PorMedio []TotalPorMedio `json:"porMedio"`
}

// cobranzasDelPeriodo: los recibos y los cobros en línea sin recibo, en un
// solo orden de fecha. Las fechas son instantes: el período en hora
// argentina.
const cobranzasDelPeriodo = `
	SELECT 'recibo' AS tipo, r.id, r.numero, r.created_at AS fecha, r.recibido_de AS cliente, r.customer_id, NULL::uuid AS order_id,
	       r.origen::text AS origen, r.estado = 'anulado' AS anulado, r.total
	FROM receipts r
	WHERE ($1::timestamptz IS NULL OR r.created_at >= $1) AND ($2::timestamptz IS NULL OR r.created_at < $2)
	UNION ALL
	SELECT 'en-linea', p.id, NULL, coalesce(p.acreditado_at, p.created_at), coalesce(cu.nombre, o.contacto_nombre, 'Sin ficha'),
	       p.customer_id, p.order_id, p.proveedor::text, false, p.monto
	FROM payments p LEFT JOIN customers cu ON cu.id = p.customer_id LEFT JOIN orders o ON o.id = p.order_id
	WHERE p.estado = 'aprobado' AND p.proveedor IN ('mercado_pago', 'transferencia')
	  AND NOT EXISTS (SELECT 1 FROM receipt_parts rp WHERE rp.payment_id = p.id)
	  AND ($1::timestamptz IS NULL OR coalesce(p.acreditado_at, p.created_at) >= $1)
	  AND ($2::timestamptz IS NULL OR coalesce(p.acreditado_at, p.created_at) < $2)`

// Cobranzas arma la página y los totales por medio.
func (s *Servicio) Cobranzas(ctx context.Context, p Periodo, limite, desplazamiento int) (Cobranzas, error) {
	out := Cobranzas{Filas: []Cobranza{}, PorMedio: []TotalPorMedio{}}
	var cobrado jsmath.Num
	if err := s.pool.QueryRow(ctx, `SELECT count(*)::int, coalesce(sum(total) FILTER (WHERE NOT anulado), 0) FROM (`+cobranzasDelPeriodo+`) c`,
		p.Desde, p.Hasta).Scan(&out.Total, &cobrado); err != nil {
		return out, err
	}
	out.Cobrado = cobrado.F()

	// Por medio: las partes de los recibos emitidos y, de los cobros en
	// línea, el proveedor (mercado_pago o transferencia).
	rs, err := s.pool.Query(ctx, `
		SELECT medio, sum(importe), count(*)::int FROM (
		  SELECT rp.medio::text AS medio, rp.importe FROM receipt_parts rp JOIN receipts r ON r.id = rp.receipt_id
		  WHERE r.estado = 'emitido' AND ($1::timestamptz IS NULL OR r.created_at >= $1) AND ($2::timestamptz IS NULL OR r.created_at < $2)
		  UNION ALL
		  SELECT origen, total FROM (`+cobranzasDelPeriodo+`) c WHERE tipo = 'en-linea'
		) x GROUP BY medio ORDER BY sum(importe) DESC`, p.Desde, p.Hasta)
	if err != nil {
		return out, err
	}
	var m TotalPorMedio
	var total jsmath.Num
	if _, err := pgx.ForEachRow(rs, []any{&m.Medio, &total, &m.Cantidad}, func() error {
		m.Total = total.F()
		out.PorMedio = append(out.PorMedio, m)
		return nil
	}); err != nil {
		return out, err
	}

	rs, err = s.pool.Query(ctx, `SELECT tipo, id, numero, fecha, cliente, customer_id, order_id, origen, anulado, total FROM (`+cobranzasDelPeriodo+`) c
		ORDER BY fecha DESC, id LIMIT $3 OFFSET $4`, p.Desde, p.Hasta, limite, desplazamiento)
	if err != nil {
		return out, err
	}
	recibos := []string{}
	indice := map[string]int{}
	var c Cobranza
	if _, err := pgx.ForEachRow(rs, []any{&c.Tipo, &c.ID, &c.Numero, &c.Fecha, &c.Cliente, &c.CustomerID, &c.OrderID, &c.Origen, &c.Anulado, &total}, func() error {
		c.Total = total.F()
		c.Partes = []ParteDeCobranza{}
		if c.Tipo == "recibo" {
			indice[c.ID] = len(out.Filas)
			recibos = append(recibos, c.ID)
		} else {
			// El cobro en línea es una sola parte: su proveedor.
			c.Partes = append(c.Partes, ParteDeCobranza{Medio: c.Origen, Importe: c.Total})
		}
		out.Filas = append(out.Filas, c)
		return nil
	}); err != nil {
		return out, err
	}
	if len(recibos) == 0 {
		return out, nil
	}
	rs, err = s.pool.Query(ctx, `SELECT receipt_id, medio::text, importe, cheque_id FROM receipt_parts WHERE receipt_id = ANY($1::uuid[]) ORDER BY receipt_id, orden`, recibos)
	if err != nil {
		return out, err
	}
	var id string
	var parte ParteDeCobranza
	_, err = pgx.ForEachRow(rs, []any{&id, &parte.Medio, &total, &parte.ChequeID}, func() error {
		parte.Importe = total.F()
		f := &out.Filas[indice[id]]
		f.Partes = append(f.Partes, parte)
		return nil
	})
	return out, err
}
