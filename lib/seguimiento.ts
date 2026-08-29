/**
 * La forma del enlace de seguimiento de un pedido.
 *
 * Vive suelto, sin `server-only` ni acceso a la base, porque lo arman cuatro
 * lugares distintos —la redirección del checkout, las plantillas de correo, la
 * vuelta de Mercado Pago y la pantalla de pago de demostración— y la forma en
 * que esto se rompe de verdad es que alguien escriba la URL a mano en un lugar
 * nuevo y se olvide el token.
 *
 * El número de pedido **no autoriza**: es consecutivo y sin huecos porque se
 * dice por teléfono y va en el remito. El token es lo que autoriza.
 */
export function enlaceDeSeguimiento(numero: string, token: string): string {
  return `/pedido/${encodeURIComponent(numero)}?t=${token}`;
}
