package cobros

import (
	"sort"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
)

// Los pendientes de un recibo son lo que el cliente tenía por facturar al
// emitirse, con su importe: las facturas que ese día esperaban el CAE y los
// pedidos abiertos ese día sin factura emitida. Sin cliente, la factura que
// cobra si ese día no tenía CAE, o el pedido que cobra y sus facturas. Los
// destinos de la seña salen de acá (Bolsa.sirve), y también hasta cuánto
// puede ser seña (RepartoDeRecibo).
//
// Antes era un LATERAL por recibo dentro de eventosSQL: por cada recibo
// recorría todos los pedidos y las facturas del cliente, cada uno con sus
// subconsultas al historial y a arca_log. Con una cuenta de 5.000 pedidos
// eran 65 ms por recibo, y cada emisión de esa cuenta repasaba sus 400
// señas con el candado de recibos tomado. Ahora pendientesSQL lee una vez
// cada pedido y cada factura, con lo que de ellos no depende del recibo
// (cuándo llegó el CAE, cuándo se facturó el pedido, su historial), y Go
// cruza cada recibo con los de su cliente. La regla es la misma, condición
// por condición: TestElRecorteNoCambiaElReparto la compara contra el SQL de
// antes, con el LATERAL.

// pendientesSQL trae, en una sola lectura, los recibos que piden sus
// pendientes ({F}, de las ramas {R}) y los pedidos y las facturas que les
// pueden tocar. `que` dice qué es cada fila:
//
//   - 0, el recibo: su cliente, su pedido y cuándo se emitió;
//   - 1, una factura que cobró un recibo sin cliente (invoice_payments);
//   - 2, una factura que puede estar pendiente: ni nota de crédito ni
//     borrador. `hasta` es cuándo llegó el CAE: la última llamada a ARCA
//     que respondió por ella (después del CAE no hay otra), o su fecha si
//     no hay registro; sin CAE, `estado` dice si lo espera (emitida o
//     rechazada);
//   - 3, un pedido: `hasta` es la primera factura que lo saca de
//     pendiente (una factura, con CAE o esperándolo), y su historial en
//     orden, con `estado` el de hoy.
//
// El historial, la primera factura de cada pedido y el CAE de cada factura
// se juntan con un GROUP BY sobre los pedidos y las facturas que entran, y no
// con una subconsulta por fila: en la cuenta de 5.000 pedidos, la mitad del
// tiempo de esta lectura eran esas 9.000 idas a los índices.
const pendientesSQL = `
WITH rec AS MATERIALIZED (
  SELECT r.id, r.customer_id, r.order_id, r.created_at FROM receipts r WHERE r.created_at <= $1 AND {R} AND {F}
), sin_cliente AS MATERIALIZED (
  SELECT ip.receipt_id, ip.invoice_id FROM invoice_payments ip JOIN rec ON rec.id = ip.receipt_id WHERE {S} AND rec.customer_id IS NULL
), fac AS MATERIALIZED (
  SELECT i.id, i.customer_id, i.order_id, i.created_at, i.total, i.cae, i.estado, i.fecha_emision FROM invoices i
  WHERE i.tipo::text NOT LIKE 'nota_credito%' AND i.estado <> 'borrador'
    AND (i.customer_id {C} OR ({S} AND (i.id IN (SELECT invoice_id FROM sin_cliente)
         OR i.order_id IN (SELECT order_id FROM rec WHERE customer_id IS NULL))))
), ped AS MATERIALIZED (
  SELECT o.id, o.customer_id, o.created_at, o.total, o.estado FROM orders o
  WHERE o.customer_id {C} OR ({S} AND o.id IN (SELECT order_id FROM rec WHERE customer_id IS NULL))
)
SELECT 0 AS que, rec.id::text AS id, coalesce(rec.customer_id::text, '') AS cliente, coalesce(rec.order_id::text, '') AS pedido,
  rec.created_at AS desde, NULL::timestamptz AS hasta, 0::bigint AS centavos, '' AS estado,
  '{}'::timestamptz[] AS cambios, '{}'::text[] AS estados
FROM rec
UNION ALL
SELECT 1, s.invoice_id::text, '', s.receipt_id::text, NULL, NULL, 0, '', '{}', '{}' FROM sin_cliente s
UNION ALL
-- Cuándo llegó el CAE, con el máximo de arca_log de cada factura juntado de una vez.
SELECT 2, i.id::text, coalesce(i.customer_id::text, ''), coalesce(i.order_id::text, ''), i.created_at,
  CASE WHEN i.cae IS NOT NULL THEN coalesce(l.cae, i.fecha_emision) END, (i.total * 100)::bigint,
  CASE WHEN i.cae IS NOT NULL THEN 'cae' WHEN i.estado IN ('emitida', 'rechazada') THEN 'espera' ELSE '' END, '{}', '{}'
FROM fac i
LEFT JOIN (SELECT l.invoice_id, max(l.created_at) AS cae FROM arca_log l
           WHERE l.invoice_id IN (SELECT id FROM fac) AND l.exito AND l.operacion IN ('FECAESolicitar', 'FECompConsultar')
           GROUP BY l.invoice_id) l ON l.invoice_id = i.id
UNION ALL
SELECT 3, o.id::text, coalesce(o.customer_id::text, ''), '', o.created_at, f.desde, (o.total * 100)::bigint, o.estado::text,
  coalesce(h.cambios, '{}'), coalesce(h.estados, '{}')
FROM ped o
LEFT JOIN (SELECT h.order_id, array_agg(h.created_at ORDER BY h.created_at, h.estado) AS cambios,
                  array_agg(h.estado::text ORDER BY h.created_at, h.estado) AS estados
           FROM order_status_history h WHERE h.order_id IN (SELECT id FROM ped) GROUP BY h.order_id) h ON h.order_id = o.id
LEFT JOIN (SELECT i.order_id, min(i.created_at) AS desde FROM invoices i
           WHERE i.order_id IN (SELECT id FROM ped) AND i.tipo::text LIKE 'factura%' AND (i.cae IS NOT NULL OR i.estado IN ('emitida', 'rechazada'))
           GROUP BY i.order_id) f ON f.order_id = o.id`

type reciboConPendientes struct {
	id, cliente, pedido string
	emitido             time.Time
}

type facturaPendiente struct {
	id, pedido string
	creada     time.Time
	// cae es cuándo llegó el CAE; nil si no lo tiene.
	cae      *time.Time
	espera   bool
	centavos int64
}

type pedidoPendiente struct {
	id        string
	creado    time.Time
	facturado *time.Time
	centavos  int64
	estado    string
	cambios   []time.Time
	estados   []string
}

type pendientes struct {
	recibos map[string]reciboConPendientes
	// Las facturas y los pedidos por cliente, y por id para los recibos sin
	// cliente.
	facturasDe, facturasDelPedido map[string][]*facturaPendiente
	facturas                      map[string]*facturaPendiente
	pedidosDe                     map[string][]*pedidoPendiente
	pedidos                       map[string]*pedidoPendiente
	// cobradas son las facturas que cobró cada recibo sin cliente.
	cobradas map[string][]string
}

func leerPendientes(rs pgx.Rows) (*pendientes, error) {
	p := &pendientes{recibos: map[string]reciboConPendientes{}, facturasDe: map[string][]*facturaPendiente{},
		facturasDelPedido: map[string][]*facturaPendiente{}, facturas: map[string]*facturaPendiente{},
		pedidosDe: map[string][]*pedidoPendiente{}, pedidos: map[string]*pedidoPendiente{}, cobradas: map[string][]string{}}
	var que int
	var id, cliente, pedido, estado string
	var desde, hasta *time.Time
	var centavos int64
	var cambios []time.Time
	var estados []string
	_, err := pgx.ForEachRow(rs, []any{&que, &id, &cliente, &pedido, &desde, &hasta, &centavos, &estado, &cambios, &estados}, func() error {
		switch que {
		case 0:
			p.recibos[id] = reciboConPendientes{id: id, cliente: cliente, pedido: pedido, emitido: *desde}
		case 1:
			p.cobradas[pedido] = append(p.cobradas[pedido], id)
		case 2:
			f := &facturaPendiente{id: id, pedido: pedido, creada: *desde, espera: estado == "espera", centavos: centavos}
			if estado == "cae" {
				cae := *hasta
				f.cae = &cae
			}
			p.facturas[id] = f
			if cliente != "" {
				p.facturasDe[cliente] = append(p.facturasDe[cliente], f)
			}
			if pedido != "" {
				p.facturasDelPedido[pedido] = append(p.facturasDelPedido[pedido], f)
			}
		case 3:
			o := &pedidoPendiente{id: id, creado: *desde, centavos: centavos, estado: estado,
				cambios: append([]time.Time(nil), cambios...), estados: append([]string(nil), estados...)}
			if hasta != nil {
				h := *hasta
				o.facturado = &h
			}
			p.pedidos[id] = o
			if cliente != "" {
				p.pedidosDe[cliente] = append(p.pedidosDe[cliente], o)
			}
		}
		return nil
	})
	return p, err
}

// delRecibo son los destinos del recibo, en orden, y cuánto suman.
func (p *pendientes) delRecibo(r reciboConPendientes) ([]string, float64) {
	t := r.emitido
	var destinos []string
	var suma int64
	// Las facturas: las del cliente; sin cliente, las que cobró y las de su
	// pedido (una sola vez cada una).
	var facturas []*facturaPendiente
	if r.cliente != "" {
		facturas = p.facturasDe[r.cliente]
	} else {
		vistas := map[string]bool{}
		for _, id := range p.cobradas[r.id] {
			if f := p.facturas[id]; f != nil && !vistas[id] {
				vistas[id] = true
				facturas = append(facturas, f)
			}
		}
		if r.pedido != "" {
			for _, f := range p.facturasDelPedido[r.pedido] {
				if !vistas[f.id] {
					vistas[f.id] = true
					facturas = append(facturas, f)
				}
			}
		}
	}
	for _, f := range facturas {
		// Creada hasta el recibo, y ese día sin CAE: lo esperaba, o le llegó
		// después.
		if f.creada.After(t) {
			continue
		}
		if (f.cae == nil && f.espera) || (f.cae != nil && f.cae.After(t)) {
			destinos = append(destinos, "i:"+f.id)
			suma += f.centavos
		}
	}
	// Los pedidos: los del cliente; sin cliente, el que cobra.
	pedidos := p.pedidosDe[r.cliente]
	if r.cliente == "" {
		pedidos = nil
		if o := p.pedidos[r.pedido]; r.pedido != "" && o != nil {
			pedidos = []*pedidoPendiente{o}
		}
	}
	for _, o := range pedidos {
		if o.creado.After(t) || (o.facturado != nil && !o.facturado.After(t)) || !o.abiertoA(t) {
			continue
		}
		destinos = append(destinos, "o:"+o.id)
		suma += o.centavos
	}
	if len(destinos) == 0 {
		return nil, 0
	}
	sort.Strings(destinos)
	return destinos, deCentavos(suma)
}

// abiertoA dice si el pedido seguía abierto en t: el último estado de su
// historial hasta t si después cambió, o el de hoy si no cambió desde
// entonces. Sin historial anterior pero con cambios después, estaba en su
// estado inicial (abierto): ante la duda, anticipo.
//
// Dos cambios en el mismo instante son de una misma transacción (el
// mostrador que crea y entrega el pedido a la vez): cuenta el cerrado. El
// LATERAL de antes elegía cualquiera de los dos.
func (o *pedidoPendiente) abiertoA(t time.Time) bool {
	estado := o.estado
	n := len(o.cambios)
	if n > 0 && o.cambios[n-1].After(t) {
		// El primer cambio después de t.
		k := sort.Search(n, func(i int) bool { return o.cambios[i].After(t) })
		estado = "pendiente"
		if k > 0 {
			estado = o.estados[k-1]
			for i := k - 1; i >= 0 && o.cambios[i].Equal(o.cambios[k-1]); i-- {
				if cerrado(o.estados[i]) {
					estado = o.estados[i]
				}
			}
		}
	}
	return !cerrado(estado)
}

func cerrado(estado string) bool { return estado == "cancelado" || estado == "entregado" }

// deCentavos es la suma como la daba sum(numeric)::float8: el decimal exacto
// redondeado al float64 más cercano (ParseFloat redondea igual que Postgres
// al pasar de numeric a float8).
func deCentavos(c int64) float64 {
	signo := ""
	if c < 0 {
		signo, c = "-", -c
	}
	f, _ := strconv.ParseFloat(signo+strconv.FormatInt(c/100, 10)+"."+strconv.FormatInt(100+c%100, 10)[1:], 64)
	return f
}
