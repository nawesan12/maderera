package portal

import (
	"context"
	"math"
	"strconv"
	"strings"

	"mjbj/internal/jsmath"
)

// Asiento es un renglón del libro de la cuenta corriente, en orden.
type Asiento struct {
	Monto      float64
	Referencia string
	// Revierte: un débito que deshace un pago (la nota de débito de un
	// cheque rechazado, la anulación de un recibo). No es deuda nueva: le
	// saca al pago lo que había cubierto, y el pedido vuelve a deber (H302).
	Revierte bool
	// Nota: una nota de crédito (una devolución, una cancelación). Con su
	// referencia baja lo que el pedido cuesta, no es un pago: el pedido
	// bajado por una devolución, sin ningún pago, decía «Pagado en parte»
	// (tercera prueba, PED-1218).
	Nota bool
}

// Imputar dice cuánto queda por pagar de cada comprobante del libro.
//
// El resumen de la cuenta dice «los pagos se imputan a la deuda más antigua»,
// pero el portal mostraba «Pago pendiente» en todos los pedidos a cuenta
// aunque el cliente hubiera pagado casi todo (mes simulado, H208). Esto hace
// la misma cuenta que el resumen:
//
//  1. Un crédito con la referencia de un débito (la nota de crédito de un
//     faltante o de una anulación) baja primero ese débito: es de ese pedido.
//  2. El resto de los créditos (pagos, saldo a favor) cubre los débitos del
//     más viejo al más nuevo, menos lo que se revirtió (un cheque que
//     rebotó): eso vuelve a quedar en el pedido que había pagado.
//
// Devuelve lo que falta pagar por referencia (solo de las que tienen débito).
// No mueve plata: es una lectura del libro, que sigue siendo la verdad.
func Imputar(libro []Asiento) map[string]float64 {
	debe, _ := ImputarConNeto(libro)
	return debe
}

// ImputarConNeto es Imputar, y además lo que cuesta cada comprobante
// después de sus notas de crédito: si lo que falta es menos que eso, se
// pagó una parte.
func ImputarConNeto(libro []Asiento) (map[string]float64, map[string]float64) {
	// Un débito sin referencia (un ajuste suelto) también es deuda, con su
	// lugar en la fila: lleva una clave propia que no se devuelve.
	clave := func(i int, a Asiento) string {
		if a.Referencia == "" {
			return "#" + strconv.Itoa(i)
		}
		return a.Referencia
	}
	debe := map[string]float64{}
	var orden []string
	var revertido float64
	var reversiones []Asiento
	for i, a := range libro {
		if a.Monto > 0 && a.Revierte {
			reversiones = append(reversiones, a)
			continue
		}
		if a.Monto > 0 {
			k := clave(i, a)
			if _, ok := debe[k]; !ok {
				orden = append(orden, k)
			}
			debe[k] = float64(debe[k] + a.Monto)
		}
	}
	neto := map[string]float64{}
	for k, v := range debe {
		neto[k] = v
	}
	var libre float64
	for _, a := range libro {
		if a.Monto >= 0 {
			continue
		}
		credito := -a.Monto
		if d, ok := debe[a.Referencia]; ok && a.Referencia != "" {
			aplica := math.Min(d, credito)
			debe[a.Referencia] = float64(d - aplica)
			if a.Nota {
				neto[a.Referencia] = float64(neto[a.Referencia] - aplica)
			}
			credito = float64(credito - aplica)
		}
		libre = float64(libre + credito)
	}
	// Lo que se revierte de un pago dirigido (el recibo de un pedido que se
	// anula, su cheque que rebota) vuelve sobre ese pedido; el resto, sobre
	// lo libre.
	for _, a := range reversiones {
		monto := a.Monto
		if d, ok := debe[a.Referencia]; ok && a.Referencia != "" {
			vuelve := math.Min(monto, math.Max(float64(neto[a.Referencia]-d), 0))
			debe[a.Referencia] = float64(d + vuelve)
			monto = float64(monto - vuelve)
		}
		revertido = float64(revertido + monto)
	}
	// Lo revertido que supera lo libre (el pago ya se había aplicado a un
	// débito con su referencia) queda como deuda suelta, al final.
	libre = float64(libre - revertido)
	for _, k := range orden {
		if libre <= 0 {
			break
		}
		aplica := math.Min(debe[k], libre)
		debe[k] = float64(debe[k] - aplica)
		libre = float64(libre - aplica)
	}
	r, n := map[string]float64{}, map[string]float64{}
	for k, v := range debe {
		if !strings.HasPrefix(k, "#") {
			r[k] = math.Max(jsmath.Redondear2(v), 0)
			n[k] = math.Max(jsmath.Redondear2(neto[k]), 0)
		}
	}
	return r, n
}

// pendientesDeLaCuenta es Imputar sobre el libro del cliente.
func (s *Servicio) pendientesDeLaCuenta(ctx context.Context, c *Cliente) (map[string]float64, map[string]float64, error) {
	// Revierte: un débito atado a un recibo cuyo pago está en este libro (el
	// cheque rechazado de ese recibo, su anulación). El cheque de una venta de
	// contado que rebotó no deshace ningún pago de la cuenta: es deuda nueva.
	//
	// La nota de crédito de una devolución con comprobante fiscal lleva en la
	// cuenta la etiqueta de la factura («Factura A 0015-00000002»), que es lo
	// que el cliente lee en Movimientos. Para imputar es del pedido: sin esto
	// el crédito iba a la deuda más vieja y el pedido devuelto en parte
	// seguía diciendo que faltaba el total (simulación del mes, H302).
	//
	// Un pago con destino (el recibo del pedido, el que cobra la factura de
	// un pedido, o el que lo nombra en el concepto) va primero a ese pedido,
	// y lo que sobra a la deuda más vieja; su anulación o su cheque
	// rechazado vuelven sobre el mismo pedido. Sin esto, el pago de PED-1019
	// cubría primero PED-1004 y cada pedido mostraba lo que se debía del
	// otro (mes simulado, M2S1-017), y el pedido con la factura cobrada
	// seguía debiendo todo (M3S3-012).
	filas, err := s.pool.Query(ctx, `WITH libro AS (
		SELECT m.id, m.created_at, m.monto, m.referencia, m.tipo, m.receipt_id,
		  m.monto > 0 AND m.receipt_id IS NOT NULL AND EXISTS (SELECT 1 FROM account_movements p
		    WHERE p.customer_id = m.customer_id AND p.receipt_id = m.receipt_id AND p.monto < 0) AS revierte
		FROM account_movements m WHERE m.customer_id = $1)
		SELECT l.monto::float8,
		  coalesce((SELECT o.numero FROM devoluciones dv JOIN orders o ON o.id = dv.order_id
		            WHERE dv.account_movement_id = l.id LIMIT 1),
		    CASE WHEN l.receipt_id IS NOT NULL AND (l.monto < 0 OR l.revierte) THEN
		      (SELECT coalesce(
		         (SELECT o.numero FROM orders o WHERE o.id = r.order_id),
		         (SELECT o.numero FROM invoice_payments ip JOIN invoices i ON i.id = ip.invoice_id
		            JOIN orders o ON o.id = i.order_id WHERE ip.receipt_id = r.id ORDER BY ip.monto DESC LIMIT 1),
		         substring(r.concepto from 'PED-[0-9]+'))
		       FROM receipts r WHERE r.id = l.receipt_id) END,
		    l.referencia, ''),
		  l.revierte,
		  l.tipo = 'nota_credito'
		FROM libro l ORDER BY l.created_at, l.id`, c.ID)
	if err != nil {
		return nil, nil, err
	}
	defer filas.Close()
	var libro []Asiento
	for filas.Next() {
		var a Asiento
		if err := filas.Scan(&a.Monto, &a.Referencia, &a.Revierte, &a.Nota); err != nil {
			return nil, nil, err
		}
		libro = append(libro, a)
	}
	if err := filas.Err(); err != nil {
		return nil, nil, err
	}
	debe, neto := ImputarConNeto(libro)
	return debe, neto, nil
}
