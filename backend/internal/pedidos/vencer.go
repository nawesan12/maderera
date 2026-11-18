package pedidos

import (
	"context"
	"time"
)

// GraciaDeVencidos es cuánto queda «Esperando respuesta» un presupuesto
// enviado después de vencer su validez.
//
// Hasta acá ninguno pasaba solo a «vencido» (el estado existía y nadie lo
// usaba): cada presupuesto que el cliente no contestaba quedaba abierto para
// siempre, sumando en el «esperando respuesta por $…» del encabezado plata
// de presupuestos muertos hace meses. El primer mes después de vencer sigue
// abierto, con su marca de vencido en la tarjeta: es cuando todavía conviene
// llamar y rehacerlo con los precios nuevos. Pasado eso ya no se espera nada.
const GraciaDeVencidos = 30 * 24 * time.Hour

// VencerPresupuestos pasa a «vencido» los enviados cuya validez venció hace
// más de GraciaDeVencidos, y devuelve cuántos. Los pendientes y en revisión
// no: esos esperan algo de la maderera, no del cliente. Lo corre la tarea
// diaria del worker; con la fila en «vencido», el portal ya no deja
// aceptarlo y el cliente lee «escribinos y lo vemos».
func (s *Servicio) VencerPresupuestos(ctx context.Context) (int64, error) {
	tag, err := s.pool.Exec(ctx, `UPDATE quotes SET estado = 'vencido', updated_at = now()
		WHERE estado = 'enviado' AND valido_hasta < $1`, s.ahora().Add(-GraciaDeVencidos))
	return tag.RowsAffected(), err
}
