/**
 * Los datos de identidad de la empresa que el sitio afirma en voz alta.
 *
 * Existe porque estaban escritos a mano en dieciséis lugares y algunos ya
 * habían quedado viejos: "Más de 40 años" cuando iban 45, y "distribución
 * nacional" de Moldava cuando el alcance real es la Provincia de Buenos Aires.
 * Un número o un alcance inventado en la página institucional es de lo poco
 * que un visitante puede verificar solo, y desmiente todo lo demás.
 *
 * No es `server-only` a propósito: el pie y el menú son componentes de cliente
 * y también los necesitan.
 */

/** Año en que abrió la maderera. Es la única fecha fija del sitio. */
export const ANIO_FUNDACION = 1981;

/**
 * Los años cumplidos, contra el calendario.
 *
 * Se calcula cada vez en vez de guardarse: una constante "45" es exactamente
 * lo que quedó viejo la última vez.
 */
export function aniosDeTrayectoria(hoy: Date = new Date()): number {
  return hoy.getFullYear() - ANIO_FUNDACION;
}

/** "Más de 45 años", ya redactado, para meter en un texto corrido. */
export function masDeAnios(hoy: Date = new Date()): string {
  return `Más de ${aniosDeTrayectoria(hoy)} años`;
}

/**
 * Hasta dónde llega Moldava.
 *
 * El brief del cliente es explícito: se vende a consumidores finales y a
 * mayoristas **de toda la Provincia de Buenos Aires**, con entrega en puerta.
 * El sitio decía "distribución nacional", que era del prototipo.
 */
export const ALCANCE_MOLDAVA = "toda la Provincia de Buenos Aires";
