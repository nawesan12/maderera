/**
 * Descuento por cómo se paga.
 *
 * El brief: *"Si pagan de contado/transferencia hay un -10% (si son compras de
 * mayor volumen se hace un -15%)"*. Hasta ahora esto vivía en la cabeza del
 * mostrador y se tipeaba a mano como un descuento suelto, así que dos
 * vendedores podían dar dos números distintos por la misma compra y nada
 * quedaba registrado como regla.
 *
 * Lógica pura y con tests, como todo lo que mueve plata en este proyecto: la
 * consulta a la base la hace el DAL y acá solo se elige la escala.
 */

export interface EscalaDePago {
  medio: string;
  desdeMonto: number;
  porcentaje: number;
  etiqueta: string;
}

/**
 * El tope duro, igual que en los descuentos por volumen.
 *
 * Un 100 % cargado por error —una escala con el porcentaje en el campo del
 * monto, por ejemplo— convertiría cada venta en cero pesos. Noventa deja lugar
 * a cualquier promoción real y frena el error de tipeo.
 */
const TOPE = 90;

/**
 * Qué descuento corresponde. Gana el escalón más alto que el total alcance.
 *
 * Con escalas de 0 y de 500.000, una compra de 600.000 toma la de 500.000. Si
 * dos filas tuvieran el mismo piso —que el índice único impide—, gana la de
 * mayor porcentaje, que es lo que el cliente esperaría que pase.
 */
export function descuentoPorMedioDePago(
  escalas: EscalaDePago[],
  medio: string,
  total: number,
): EscalaDePago | null {
  const aplicables = escalas
    .filter((e) => e.medio === medio && total >= e.desdeMonto)
    .sort((a, b) => b.desdeMonto - a.desdeMonto || b.porcentaje - a.porcentaje);

  const elegida = aplicables[0];
  if (!elegida || elegida.porcentaje <= 0) return null;

  return { ...elegida, porcentaje: Math.min(elegida.porcentaje, TOPE) };
}

/** Cuánto se descuenta, en pesos, ya redondeado a centavos. */
export function montoDelDescuentoDePago(
  total: number,
  porcentaje: number,
): number {
  if (total <= 0 || porcentaje <= 0) return 0;
  return Math.round(total * Math.min(porcentaje, TOPE)) / 100;
}
