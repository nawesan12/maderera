/**
 * De quién es lo que sobra de una placa, dicho igual en la ficha, el plano,
 * la hoja de corte y sus PDF.
 *
 * `seVendeEntera` llega de Go ya resuelto para el pedido que vende todas las
 * placas de sus cortes (mes simulado, H184). Lo que falta acá es la
 * reposición sin cargo, que no vende nada y cuyo retal queda en la maderera
 * («Se cobra el corte» de algo que no se cobra), y la media placa, que se
 * vende como media y no «entera» (mes simulado, ítem 10).
 */
export interface QuienSeQueda {
  /** La reposición sin cargo, atada al pedido que la originó. */
  sinCargo?: boolean;
  /** El trabajo sale de media placa. */
  media?: boolean;
  /**
   * La placa la trae el cliente (escrita a mano, sin catálogo): lo que sobra
   * es suyo, no va al stock (mes simulado, M3S2-009).
   */
  placaDelCliente?: boolean;
}

export function sobraDelCliente(seVendeEntera: boolean, q: QuienSeQueda): boolean {
  if (q.placaDelCliente) return true;
  return seVendeEntera && !q.sinCargo;
}

/** El rótulo corto de la placa: «Se vende entera», «Sin cargo»… */
export function queSeHaceConLaPlaca(seVendeEntera: boolean, q: QuienSeQueda): string {
  if (q.sinCargo) return "Sin cargo";
  if (q.placaDelCliente) return "Placa del cliente";
  if (!seVendeEntera) return "Se cobra el corte";
  return q.media ? "Se vende la media" : "Se vende entera";
}
