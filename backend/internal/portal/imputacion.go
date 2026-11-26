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
	for i, a := range libro {
		if a.Monto > 0 && a.Revierte {
			revertido = float64(revertido + a.Monto)
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
	var libre float64
	for _, a := range libro {
		if a.Monto >= 0 {
			continue
		}
		credito := -a.Monto
		if d, ok := debe[a.Referencia]; ok && a.Referencia != "" {
			aplica := math.Min(d, credito)
			debe[a.Referencia] = float64(d - aplica)
			credito = float64(credito - aplica)
		}
		libre = float64(libre + credito)
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
	r := map[string]float64{}
	for k, v := range debe {
		if !strings.HasPrefix(k, "#") {
			r[k] = math.Max(jsmath.Redondear2(v), 0)
		}
	}
	return r
}

// pendientesDeLaCuenta es Imputar sobre el libro del cliente.
func (s *Servicio) pendientesDeLaCuenta(ctx context.Context, c *Cliente) (map[string]float64, error) {
	// Revierte: un débito atado a un recibo cuyo pago está en este libro (el
	// cheque rechazado de ese recibo, su anulación). El cheque de una venta de
	// contado que rebotó no deshace ningún pago de la cuenta: es deuda nueva.
	//
	// La nota de crédito de una devolución con comprobante fiscal lleva en la
	// cuenta la etiqueta de la factura («Factura A 0015-00000002»), que es lo
	// que el cliente lee en Movimientos. Para imputar es del pedido: sin esto
	// el crédito iba a la deuda más vieja y el pedido devuelto en parte
	// seguía diciendo que faltaba el total (simulación del mes, H302).
	filas, err := s.pool.Query(ctx, `SELECT m.monto::float8,
		  coalesce((SELECT o.numero FROM devoluciones dv JOIN orders o ON o.id = dv.order_id
		            WHERE dv.account_movement_id = m.id LIMIT 1), m.referencia, ''),
		  m.monto > 0 AND m.receipt_id IS NOT NULL AND EXISTS (SELECT 1 FROM account_movements p
		    WHERE p.customer_id = m.customer_id AND p.receipt_id = m.receipt_id AND p.monto < 0)
		FROM account_movements m WHERE m.customer_id = $1 ORDER BY m.created_at, m.id`, c.ID)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	var libro []Asiento
	for filas.Next() {
		var a Asiento
		if err := filas.Scan(&a.Monto, &a.Referencia, &a.Revierte); err != nil {
			return nil, err
		}
		libro = append(libro, a)
	}
	return Imputar(libro), filas.Err()
}
