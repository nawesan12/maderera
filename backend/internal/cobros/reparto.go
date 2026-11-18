package cobros

import (
	"context"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/jsmath"
)

// El reparto de los cobros entre los dos circuitos, para el CSV del estudio.
//
// En el CSV, Deudores se debita solo con las facturas que ARCA autorizó. Un
// recibo se asentaba contra Deudores por el total, y lo que pagaba una venta
// sin factura dejaba Deudores en negativo: un Deudores que nunca se debitó.
// Cada recibo se reparte en tres:
//
//   - **Deudores** (blanco): lo que cancela facturas con CAE que siguen
//     abiertas, por cliente y en orden de fecha. Las retenciones van siempre
//     acá: son un crédito fiscal con su certificado, nunca del circuito B.
//   - **Anticipo** (blanco, Anticipos de clientes): lo que sobra cuando el
//     cliente tiene algo por facturar —un pedido abierto, una factura que
//     espera el CAE—. Es la seña: cuando la factura sale con CAE, el anticipo
//     se le aplica (Anticipos a Deudores) y Deudores cierra.
//   - **B**: lo que sobra sin nada pendiente, es decir, lo que pagó una venta
//     sin factura ya cerrada, y las partes en cheques del circuito B.
//
// **El reparto se fija al emitir el recibo y no se recalcula** (columnas
// reparto_* de receipts): una baja, un CAE que llega tarde o una nota de
// crédito del mes siguiente no pueden cambiar lo que ya se le mandó al
// estudio. La anulación usa el mismo reparto, al revés. Las aplicaciones de
// anticipo se calculan en orden de fecha con los hechos hasta cada una, así
// que tampoco cambian hacia atrás.
//
// Lo que no se sabe es qué venta es del circuito B: el pedido no lo guarda.
// La regla de arriba es la que se le propone al estudio
// (docs/CONTADOR-SIN-CAE.md): ante la duda, anticipo y no B.

// TipoDeEvento es qué pasó en la cuenta.
type TipoDeEvento int

// Los eventos, en el orden en que se aplican cuando caen en el mismo instante.
const (
	// EventoFactura es un comprobante con CAE (la nota de crédito, con el
	// monto en negativo).
	EventoFactura TipoDeEvento = iota
	// EventoCobro es un cobro que va directo contra Deudores sin recibo (o
	// un reintegro, en negativo).
	EventoCobro
	EventoRecibo
	EventoAnulacion
	// EventoTramo es un tramo de un reintegro parcial de un pago con recibo
	// (el ID es el del recibo): vuelve en la misma proporción que el recibo.
	EventoTramo
)

// Reparto es en qué se reparte un recibo.
type Reparto struct {
	Deudores float64 `json:"deudores"`
	Anticipo float64 `json:"anticipo"`
	B        float64 `json:"b"`
}

// Blanco es lo del recibo que va al CSV del estudio.
func (r Reparto) Blanco() float64 { return jsmath.Redondear2(r.Deudores + r.Anticipo) }

// EventoDeCuenta es un hecho de la cuenta de un cliente (o de una factura
// sin cliente: la clave es «c:<cliente>» o «f:<factura>»).
type EventoDeCuenta struct {
	Clave string
	Fecha time.Time
	Tipo  TipoDeEvento
	// ID de la factura, el cobro o el recibo.
	ID string
	// La factura con signo, el cobro, o el total del recibo.
	Monto float64
	// Del recibo: lo cobrado en retenciones y en cheques del circuito B.
	Retencion, Negro float64
	// Del recibo: si el cliente tenía algo por facturar o esperando el CAE.
	Pendiente bool
	// Del recibo: el reparto ya fijado.
	Guardado *Reparto
	// De la factura, para el asiento de la aplicación.
	TipoComprobante    string
	PuntoVenta, Numero int64
	Cliente            string
}

// Aplicacion es un anticipo que pasa a cancelar Deudores (o, en negativo,
// que vuelve a Anticipos porque se anuló el recibo que lo había dejado).
type Aplicacion struct {
	Fecha   time.Time
	Clave   string
	Evento  EventoDeCuenta
	Importe float64
}

// ResultadoDelReparto es lo que sale de recorrer las cuentas.
type ResultadoDelReparto struct {
	// El reparto de cada recibo.
	Recibos map[string]Reparto
	// Los recibos que no tenían el reparto fijado (los de antes): se fijan.
	Calculados []string
	// Las aplicaciones de anticipo, en orden.
	Aplicaciones []Aplicacion
	// Lo que queda en Deudores y en Anticipos de cada clave al final.
	Deudores, Anticipos map[string]float64
}

// RepartoDeRecibo reparte un recibo con lo que hay abierto en Deudores.
func RepartoDeRecibo(deudoresAbiertos, total, retencion, negro float64, pendiente bool) Reparto {
	libre := jsmath.Redondear2(total - negro)
	blanco := min(libre, max(deudoresAbiertos, 0))
	if blanco < retencion {
		blanco = min(retencion, libre)
	}
	blanco = jsmath.Redondear2(blanco)
	resto := jsmath.Redondear2(libre - blanco)
	r := Reparto{Deudores: blanco, B: jsmath.Redondear2(negro)}
	if pendiente {
		r.Anticipo = resto
	} else {
		r.B = jsmath.Redondear2(r.B + resto)
	}
	return r
}

// TramoPorCircuito reparte lo devuelto de un recibo en la proporción de su
// reparto; B se lleva el redondeo.
func TramoPorCircuito(rep Reparto, tramo float64) Reparto {
	total := jsmath.Redondear2(rep.Deudores + rep.Anticipo + rep.B)
	if !(total > 0) {
		return Reparto{Deudores: tramo}
	}
	d := jsmath.Redondear2(float64(tramo*rep.Deudores) / total)
	a := jsmath.Redondear2(float64(tramo*rep.Anticipo) / total)
	return Reparto{Deudores: d, Anticipo: a, B: jsmath.Redondear2(tramo - d - a)}
}

// RepartirCobros recorre cada cuenta en orden de fecha. Pura: la usan la
// emisión del recibo (para fijar el suyo) y el cierre (para las
// aplicaciones de anticipo y los recibos de antes).
func RepartirCobros(eventos []EventoDeCuenta) ResultadoDelReparto {
	ev := append([]EventoDeCuenta(nil), eventos...)
	sort.SliceStable(ev, func(i, j int) bool {
		a, b := ev[i], ev[j]
		if a.Clave != b.Clave {
			return a.Clave < b.Clave
		}
		if !a.Fecha.Equal(b.Fecha) {
			return a.Fecha.Before(b.Fecha)
		}
		if a.Tipo != b.Tipo {
			return a.Tipo < b.Tipo
		}
		return a.ID < b.ID
	})
	res := ResultadoDelReparto{Recibos: map[string]Reparto{}, Deudores: map[string]float64{}, Anticipos: map[string]float64{}}
	r2 := jsmath.Redondear2
	for _, e := range ev {
		deudores, anticipo := res.Deudores[e.Clave], res.Anticipos[e.Clave]
		switch e.Tipo {
		case EventoFactura:
			deudores = r2(deudores + e.Monto)
			if e.Monto > 0 && anticipo > 0.005 && deudores > 0.005 {
				ap := min(anticipo, deudores)
				anticipo, deudores = r2(anticipo-ap), r2(deudores-ap)
				res.Aplicaciones = append(res.Aplicaciones, Aplicacion{Fecha: e.Fecha, Clave: e.Clave, Evento: e, Importe: ap})
			}
		case EventoCobro:
			deudores = r2(deudores - e.Monto)
		case EventoRecibo:
			rep := RepartoDeRecibo(deudores, e.Monto, e.Retencion, e.Negro, e.Pendiente)
			if e.Guardado != nil {
				rep = *e.Guardado
			} else {
				res.Calculados = append(res.Calculados, e.ID)
			}
			res.Recibos[e.ID] = rep
			deudores, anticipo = r2(deudores-rep.Deudores), r2(anticipo+rep.Anticipo)
		case EventoTramo:
			if rep, ok := res.Recibos[e.ID]; ok {
				t := TramoPorCircuito(rep, e.Monto)
				deudores, anticipo = r2(deudores+t.Deudores), r2(anticipo-t.Anticipo)
			}
		case EventoAnulacion:
			rep, ok := res.Recibos[e.ID]
			if !ok {
				continue
			}
			deudores, anticipo = r2(deudores+rep.Deudores), r2(anticipo-rep.Anticipo)
			// Lo que el anticipo ya había cancelado de una factura vuelve a
			// deberse.
			if anticipo < -0.005 {
				falta := -anticipo
				deudores, anticipo = r2(deudores+falta), 0
				res.Aplicaciones = append(res.Aplicaciones, Aplicacion{Fecha: e.Fecha, Clave: e.Clave, Evento: e, Importe: -falta})
			}
		}
		res.Deudores[e.Clave], res.Anticipos[e.Clave] = deudores, anticipo
	}
	return res
}

// claveDeRecibo: el cliente, o la factura que cobra si no tiene cliente.
const claveDeRecibo = `coalesce('c:' || r.customer_id::text,
	(SELECT coalesce('c:' || i.customer_id::text, 'f:' || i.id::text) FROM invoice_payments ip JOIN invoices i ON i.id = ip.invoice_id
	 WHERE ip.receipt_id = r.id ORDER BY ip.created_at LIMIT 1),
	'r:' || r.id::text)`

// pendienteDelRecibo: el cliente tenía, al emitirse el recibo, una factura
// esperando el CAE o un pedido abierto sin factura con CAE. Sin cliente, la
// factura que cobra todavía no tiene CAE.
const pendienteDelRecibo = `CASE WHEN r.customer_id IS NOT NULL THEN
	  EXISTS (SELECT 1 FROM invoices i WHERE i.customer_id = r.customer_id AND i.cae IS NULL AND i.estado IN ('emitida', 'rechazada')
	          AND i.created_at <= r.created_at)
	  OR EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = r.customer_id AND o.created_at <= r.created_at
	          AND o.estado NOT IN ('cancelado', 'entregado')
	          AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id AND i.cae IS NOT NULL))
	ELSE EXISTS (SELECT 1 FROM invoice_payments ip JOIN invoices i ON i.id = ip.invoice_id
	          WHERE ip.receipt_id = r.id AND i.cae IS NULL AND i.estado <> 'anulada') END`

// eventosSQL son todos los hechos que mueven Deudores, hasta $1 y de la
// clave $2 (” es todas). Los cobros sin recibo son los mismos que asienta
// el cierre (reportes.asientosDeCobro): los de una factura de antes de los
// recibos, la venta pagada sin recibo de un pedido facturado y la deuda
// pagada antes de los recibos; los reintegros, en negativo.
const eventosSQL = `
SELECT * FROM (
  SELECT coalesce('c:' || i.customer_id::text, 'f:' || i.id::text) AS clave, i.fecha_emision AS fecha, 0 AS tipo, i.id::text AS id,
    (CASE WHEN i.tipo::text LIKE 'nota_credito%' THEN -1 ELSE 1 END * i.total)::float8 AS monto, 0::float8 AS retencion,
    0::float8 AS negro, false AS pendiente, NULL::float8 AS rd, NULL::float8 AS ra, NULL::float8 AS rb,
    i.tipo::text AS tipo_cbte, i.punto_venta::bigint AS pv, i.numero::bigint AS nro, i.receptor_nombre AS cliente
  FROM invoices i WHERE i.cae IS NOT NULL AND i.estado <> 'borrador' AND i.fecha_emision <= $1
  UNION ALL
  SELECT coalesce('c:' || i.customer_id::text, 'f:' || i.id::text), p.fecha, 1, p.id::text, p.monto::float8, 0, 0, false, NULL, NULL, NULL,
    '', 0, 0, ''
  FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id
  WHERE p.receipt_id IS NULL AND p.medio <> 'cuenta_corriente' AND p.fecha <= $1
  UNION ALL
  SELECT x.clave, x.fecha, 1, x.id, x.monto, 0, 0, false, NULL, NULL, NULL, '', 0, 0, '' FROM (
    SELECT CASE WHEN p.tipo = 'deuda' THEN 'c:' || p.customer_id::text ELSE coalesce('c:' || f.customer_id::text, 'f:' || f.id::text) END AS clave,
      greatest(coalesce(p.acreditado_at, CASE WHEN p.proveedor = 'mostrador' THEN coalesce(o.cobrada_at, o.created_at) END,
               p.conciliado_at, p.created_at), coalesce(f.fecha_emision, '-infinity')) AS fecha,
      p.id::text AS id, p.monto::float8 AS monto
    FROM payments p
    LEFT JOIN orders o ON o.id = p.order_id
    LEFT JOIN LATERAL (
      SELECT i.id, i.customer_id, i.fecha_emision FROM invoices i
      WHERE i.order_id = p.order_id AND i.tipo::text LIKE 'factura%' AND i.estado <> 'borrador' AND i.cae IS NOT NULL
      ORDER BY (i.estado = 'anulada'), i.fecha_emision LIMIT 1) f ON true
    WHERE p.estado IN ('aprobado', 'reintegrado')
      AND NOT EXISTS (SELECT 1 FROM receipt_parts x WHERE x.payment_id = p.id)
      AND ((p.tipo = 'pedido' AND f.id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM invoice_payments ip WHERE ip.invoice_id = f.id AND ip.medio <> 'cuenta_corriente'))
        OR (p.tipo = 'deuda' AND p.customer_id IS NOT NULL))
    UNION ALL
    SELECT CASE WHEN p.tipo = 'deuda' THEN 'c:' || p.customer_id::text ELSE coalesce('c:' || f.customer_id::text, 'f:' || f.id::text) END,
      greatest(p.updated_at, coalesce(f.fecha_emision, '-infinity')), p.id::text || ':reintegro', -p.monto::float8
    FROM payments p
    LEFT JOIN LATERAL (
      SELECT i.id, i.customer_id, i.fecha_emision FROM invoices i
      WHERE i.order_id = p.order_id AND i.tipo::text LIKE 'factura%' AND i.estado <> 'borrador' AND i.cae IS NOT NULL
      ORDER BY (i.estado = 'anulada'), i.fecha_emision LIMIT 1) f ON true
    WHERE p.estado = 'reintegrado'
      AND NOT EXISTS (SELECT 1 FROM receipt_parts x WHERE x.payment_id = p.id)
      AND ((p.tipo = 'pedido' AND f.id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM invoice_payments ip WHERE ip.invoice_id = f.id AND ip.medio <> 'cuenta_corriente'))
        OR (p.tipo = 'deuda' AND p.customer_id IS NOT NULL))
  ) x WHERE x.fecha <= $1
  UNION ALL
  SELECT ` + claveDeRecibo + `, t.created_at, 4, r.id::text, t.importe::float8, 0, 0, false, NULL, NULL, NULL, '', 0, 0, ''
  FROM payment_refunds t JOIN receipt_parts x ON x.payment_id = t.payment_id JOIN receipts r ON r.id = x.receipt_id
  WHERE t.account_movement_id IS NOT NULL AND t.created_at <= $1
  UNION ALL
  SELECT ` + claveDeRecibo + `, r.created_at, 2, r.id::text, r.total::float8,
    coalesce((SELECT sum(importe) FROM receipt_parts WHERE receipt_id = r.id AND medio = 'retencion'), 0)::float8,
    coalesce((SELECT sum(x.importe) FROM receipt_parts x JOIN cheques ch ON ch.id = x.cheque_id
              WHERE x.receipt_id = r.id AND ch.circuito = 'negro'), 0)::float8,
    ` + pendienteDelRecibo + `,
    r.reparto_deudores::float8, r.reparto_anticipo::float8, r.reparto_b::float8, '', 0, 0, r.recibido_de
  FROM receipts r WHERE r.created_at <= $1
  UNION ALL
  SELECT ` + claveDeRecibo + `, r.anulado_at, 3, r.id::text, r.total::float8, 0, 0, false, NULL, NULL, NULL, 'recibo', 0, 0, r.numero
  FROM receipts r WHERE r.anulado_at IS NOT NULL AND r.anulado_at <= $1
) e WHERE $2 = '' OR e.clave = $2`

// CargarEventos lee los hechos de las cuentas hasta `hasta` (de una clave,
// o de todas con "").
func CargarEventos(ctx context.Context, db interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}, hasta time.Time, clave string) ([]EventoDeCuenta, error) {
	rs, err := db.Query(ctx, eventosSQL, hasta, clave)
	if err != nil {
		return nil, err
	}
	var out []EventoDeCuenta
	var e EventoDeCuenta
	var tipo int
	var rd, ra, rb *float64
	_, err = pgx.ForEachRow(rs, []any{&e.Clave, &e.Fecha, &tipo, &e.ID, &e.Monto, &e.Retencion, &e.Negro, &e.Pendiente, &rd, &ra, &rb,
		&e.TipoComprobante, &e.PuntoVenta, &e.Numero, &e.Cliente}, func() error {
		x := e
		x.Tipo = TipoDeEvento(tipo)
		if rd != nil && ra != nil && rb != nil {
			x.Guardado = &Reparto{Deudores: *rd, Anticipo: *ra, B: *rb}
		}
		out = append(out, x)
		return nil
	})
	return out, err
}

// FijarReparto calcula y guarda el reparto de un recibo recién emitido, en
// la transacción que lo emite. Va después de que el recibo tiene sus partes
// y, si no tiene cliente, después de atarlo a la factura que cobra (la clave
// sale de ahí).
func FijarReparto(ctx context.Context, tx pgx.Tx, recibo string) (Reparto, error) {
	var clave string
	if err := tx.QueryRow(ctx, `SELECT `+claveDeRecibo+` FROM receipts r WHERE r.id = $1`, recibo).Scan(&clave); err != nil {
		return Reparto{}, err
	}
	ev, err := CargarEventos(ctx, tx, time.Date(9999, 1, 1, 0, 0, 0, 0, time.UTC), clave)
	if err != nil {
		return Reparto{}, err
	}
	rep := RepartirCobros(ev).Recibos[recibo]
	_, err = tx.Exec(ctx, `UPDATE receipts SET reparto_deudores = $2::numeric, reparto_anticipo = $3::numeric, reparto_b = $4::numeric
		WHERE id = $1`, recibo, jsmath.Fijo2(rep.Deudores), jsmath.Fijo2(rep.Anticipo), jsmath.Fijo2(rep.B))
	return rep, err
}
