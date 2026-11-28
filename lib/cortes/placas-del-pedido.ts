/**
 * Las placas que vende un pedido contra las que usan sus cortes, dichas igual
 * en el alta y en la ficha.
 *
 * Usar menos de las que vende es lo normal (un acopio de tres del que se
 * corta una): es un dato, no un aviso. Solo usar más de las que vende es un
 * problema, y lo dice Go en la ficha con el mismo texto que acá.
 */

/** «1 placa», «media placa», «2,5 placas», como lo dice Go. */
export function placasEnTexto(n: number): string {
  if (n === 0.5) return "media placa";
  if (n === 1) return "1 placa";
  return `${String(n).replace(".", ",")} placas`;
}

/**
 * El aviso del alta cuando los cortes del pedido usan más placas de las que
 * vende; `null` si usan las mismas o menos (mes 23: el alta seguía en rojo
 * con «usan 2 y el pedido vende 3»).
 */
export function avisoDePlacasDelPedido(d: {
  numero: string;
  usadas: number;
  otras: number;
  vendidas: number;
}): string | null {
  const total = d.usadas + d.otras;
  if (total - d.vendidas <= 1e-6) return null;
  return d.otras > 0
    ? `Los cortes de ${d.numero} usan ${placasEnTexto(total)} y el pedido vende ${placasEnTexto(d.vendidas)}.`
    : `El plano usa ${placasEnTexto(d.usadas)} y el pedido ${d.numero} vende ${placasEnTexto(d.vendidas)}.`;
}

/**
 * El dato del renglón «Las placas» de la ficha: «1 de 3» si caben en lo que
 * vende el pedido; si usan más, solo las que usan («3 de 2» se leía mal, y
 * el exceso ya lo dice el aviso).
 */
export function placasDeLasDelPedido(usadas: number, vendidas: number, formatear: (n: number) => string): string {
  if (vendidas <= 0 || usadas - vendidas > 1e-6) return formatear(usadas);
  return `${formatear(usadas)} de ${formatear(vendidas)}`;
}
