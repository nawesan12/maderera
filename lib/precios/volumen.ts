/**
 * Descuentos por volumen (cláusula 1.7).
 *
 * "Comprás más, pagás menos" es la forma en que se vende a un profesional, y
 * tiene que verse aplicado en el carrito, no prometido en una landing.
 *
 * Sin `server-only` y sin consultar nada: es aritmética y reglas de precedencia,
 * y así se puede probar. Quien llama trae las escalas de la lista.
 */

export interface EscalaDeVolumen {
  id: string;
  /** Null en las dos = la escala vale para todo el catálogo. */
  variantId: string | null;
  categoryId: string | null;
  desdeCantidad: number;
  porcentaje: number;
}

export interface ContextoDescuento {
  variantId: string | null;
  categoryId: string | null;
  cantidad: number;
}

/**
 * Qué tan específica es una escala. La más específica gana.
 *
 * Es la regla que uno espera de una lista de precios: una excepción cargada
 * para un producto concreto tiene que ganarle a la política general de su
 * categoría, aunque el porcentaje de la general sea mayor. Elegir "el mejor
 * porcentaje" haría imposible cargar una excepción a la baja.
 */
function especificidad(escala: EscalaDeVolumen): number {
  if (escala.variantId) return 2;
  if (escala.categoryId) return 1;
  return 0;
}

function aplica(escala: EscalaDeVolumen, contexto: ContextoDescuento): boolean {
  if (contexto.cantidad < escala.desdeCantidad) return false;
  if (escala.variantId) return escala.variantId === contexto.variantId;
  if (escala.categoryId) return escala.categoryId === contexto.categoryId;
  return true;
}

/**
 * Porcentaje de descuento que corresponde, o cero.
 *
 * Entre escalas del mismo nivel de especificidad gana la de mayor `desde`: son
 * los tramos de una misma escalera —10 % desde 10 unidades, 15 % desde 50— y a
 * 60 unidades corresponde el tramo de arriba.
 */
export function descuentoPorVolumen(
  escalas: EscalaDeVolumen[],
  contexto: ContextoDescuento,
): number {
  let mejor: EscalaDeVolumen | null = null;

  for (const escala of escalas) {
    if (!aplica(escala, contexto)) continue;
    if (!(escala.porcentaje > 0)) continue;

    if (!mejor) {
      mejor = escala;
      continue;
    }

    const nivel = especificidad(escala);
    const nivelMejor = especificidad(mejor);

    if (nivel > nivelMejor) {
      mejor = escala;
    } else if (nivel === nivelMejor && escala.desdeCantidad > mejor.desdeCantidad) {
      mejor = escala;
    }
  }

  return mejor?.porcentaje ?? 0;
}

/** Aplica el descuento a un precio unitario, redondeado a dos decimales. */
export function precioConDescuento(
  precio: number,
  porcentaje: number,
): number {
  if (!(porcentaje > 0)) return precio;

  // Un descuento del 100 % o más dejaría el producto en cero o en negativo. Se
  // acota acá y no en la carga: una escala mal tipeada no puede regalar
  // mercadería.
  const efectivo = Math.min(porcentaje, 90);

  return Math.round(precio * (1 - efectivo / 100) * 100) / 100;
}
