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

/**
 * El logo con el nombre, para los papeles: factura, remito, recibo,
 * presupuesto, resumen de cuenta.
 *
 * De la clienta (30/9/2026): «agregar logo al remito». Es el del sitio que
 * tienen hoy (`mjbj.ar`), en gris y naranja sobre transparente: se lee igual
 * impreso en blanco y negro. Vive en `public/` porque lo usan las hojas HTML
 * por URL y los PDF leyéndolo del disco. Las medidas son las del archivo, para
 * dibujarlo sin deformar.
 */
export const LOGO_DOCUMENTOS = {
  ruta: "/marca/logo-maderera.png",
  ancho: 463,
  alto: 89,
  texto: "Maderera Juan B. Justo",
} as const;

/**
 * Las redes de la empresa.
 *
 * Son las que enlazaba el sitio viejo (`mjbj.ar`) en el encabezado y el pie,
 * y la de Instagram se verificó el 14/10/2026: es la cuenta
 * «MADERERA JUAN B. JUSTO». El sitio nuevo tenía otras dos escritas a mano
 * desde el prototipo (`madererajbjusto`) que no son de la empresa: una
 * llevaba a un perfil inexistente, y en el marcado (`sameAs`) le decían a
 * Google que la maderera era otra cuenta.
 *
 * Las usan el pie y los datos estructurados; tenerlas en un solo lugar es lo
 * que evita que vuelvan a diferir.
 */
export const REDES = {
  facebook: "https://www.facebook.com/juanbjustoplacasymaderas",
  instagram: "https://www.instagram.com/madererajuanbjusto/",
} as const;
