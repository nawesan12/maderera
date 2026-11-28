/**
 * Qué camino de pago muestra el seguimiento de un pedido que falta cobrar.
 *
 * Solo el pedido de Mercado Pago con con qué cobrar en línea ofrece «Pagar».
 * Uno tomado con débito o crédito (por teléfono o en el local) se paga con la
 * tarjeta al retirar: ofrecerle Mercado Pago era cobrarle por otro medio que
 * el que eligió (mes simulado, M2S3-051). El de Mercado Pago sin pago en
 * línea se transfiere si hay datos bancarios y, si no, se paga como el
 * efectivo (M2S2-002, M2S2-049).
 */
export type CaminoDelPago = "al_retirar" | "transferencia" | "en_linea";

export function caminoDelPago(
  medioPago: string | null,
  disponible: boolean,
  hayBanco: boolean,
): CaminoDelPago {
  if (medioPago === "transferencia") return "transferencia";
  if (medioPago === "mercado_pago") {
    if (disponible) return "en_linea";
    return hayBanco ? "transferencia" : "al_retirar";
  }
  // Sin medio cargado (pedidos viejos) se sigue el criterio de antes: en
  // línea si se puede, si no transferencia.
  if (medioPago === null) return disponible ? "en_linea" : "transferencia";
  return "al_retirar";
}
