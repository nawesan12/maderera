/**
 * La placa que ocupa el lugar de la foto mientras el producto no tenga una
 * propia (hallazgo 25 del comité, 18/11/2026).
 *
 * Tiene que leerse como **etiqueta y no como foto**: un tono plano de madera,
 * una veta apenas sugerida y el rubro estampado como protagonista. Si la veta
 * fuera verosímil, el cliente creería que esa es la madera que se lleva; si
 * todas fueran iguales, que «no tienen nada cargado». Por eso el tono sigue al
 * rubro y nada más: variar la veta por producto era un esfuerzo que nadie iba
 * a percibir (lo dijo la diseñadora del comité).
 *
 * Los colores viven acá y no en el CSS para que `tests/placa-de-producto.test.ts`
 * pueda medir el contraste del texto con el mismo valor que se dibuja.
 */

export type TonoDePlaca = "pino" | "saligna" | "intemperie" | "neutro";

export interface ColoresDePlaca {
  fondo: string;
  texto: string;
}

/**
 * Claro y oscuro. En oscuro la madera baja de tono y el texto pasa a claro:
 * una placa clara en medio de la página oscura encandila.
 *
 * La veta solo la llevan las tres maderas. Ferretería y construcción en seco
 * van lisas: una bisagra sobre madera es un dibujo que no corresponde.
 */
export const TONOS: Record<TonoDePlaca, { claro: ColoresDePlaca; oscuro: ColoresDePlaca; veta: boolean }> = {
  // Pino claro: placas y molduras.
  pino: { claro: { fondo: "#ead9bb", texto: "#3a2a16" }, oscuro: { fondo: "#41352a", texto: "#f1e6d2" }, veta: true },
  // Saligna, rojiza: techos y pisos.
  saligna: { claro: { fondo: "#dcb592", texto: "#3a2213" }, oscuro: { fondo: "#47302a", texto: "#f3e1d4" }, veta: true },
  // Gris de madera a la intemperie: decks y cubiertas.
  intemperie: { claro: { fondo: "#cfccc5", texto: "#2a2926" }, oscuro: { fondo: "#383734", texto: "#ebeae6" }, veta: true },
  // Neutro y liso: ferretería y construcción en seco.
  neutro: { claro: { fondo: "#e7e3dc", texto: "#2d2a26" }, oscuro: { fondo: "#2e2c29", texto: "#ebe7e0" }, veta: false },
};

const POR_RUBRO: Record<string, TonoDePlaca> = {
  placas: "pino",
  molduras: "pino",
  techos: "saligna",
  pisos: "saligna",
  "decks-y-escaleras": "intemperie",
  cubiertas: "intemperie",
  ferreteria: "neutro",
  "construccion-en-seco": "neutro",
};

/** El tono de la categoría. Un rubro nuevo, hasta que alguien lo elija, va neutro. */
export function tonoDePlaca(categoriaSlug: string | null | undefined): TonoDePlaca {
  return (categoriaSlug && POR_RUBRO[categoriaSlug]) || "neutro";
}

/**
 * La marca que vale la pena estampar. Solo Moldava: es una línea propia, con
 * página propia, y se busca por nombre. La marca de la casa en cada tarjeta
 * era la misma firma 29 veces en una página que ya la lleva arriba.
 */
export function marcaDePlaca(marca: string | null | undefined): string | null {
  return marca && /moldava/i.test(marca) ? "MOLDAVA" : null;
}

/** Luminancia relativa de WCAG 2.x de un color «#rrggbb». */
function luminancia(hex: string): number {
  const n = parseInt(hex.replace("#", ""), 16);
  const canal = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal((n >> 16) & 255) + 0.7152 * canal((n >> 8) & 255) + 0.0722 * canal(n & 255);
}

/** Contraste de WCAG entre dos colores «#rrggbb»: de 1 a 21. */
export function contraste(a: string, b: string): number {
  const [claro, oscuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (oscuro + 0.05);
}

/*
 * El largo del rubro estampado (corrección de T5).
 *
 * El rubro va en extrabold mayúscula y una palabra sola no se parte:
 * «TERMINACIONES» a 72 px ocupaba unos 650 px en los 416 útiles de la imagen
 * para compartir, y en la grilla de cuatro columnas se cortaba contra el
 * borde. El tamaño se calcula por la **palabra más larga** y no por el largo
 * total: «Pisos flotantes» tiene 15 letras y entra en dos renglones cómodos;
 * «Terminaciones» tiene 13 y no entra en uno.
 *
 * ANCHO_DE_LETRA es el ancho medio de una mayúscula extrabold, en em, con
 * margen para las anchas (M, W).
 */
export const ANCHO_DE_LETRA = 0.72;

/** Cuántas letras entran en un renglón al tamaño base de cada placa. */
export const LETRAS_POR_RENGLON = { tarjeta: 9, ficha: 13 } as const;

/** El ancho útil del panel de la imagen para compartir: 520 − 2 × 52. */
export const ANCHO_UTIL_OG = 416;

export function palabraMasLarga(rubro: string): number {
  return Math.max(0, ...rubro.split(/\s+/).map((p) => [...p].length));
}

/** Por cuánto achicar el tamaño base para que la palabra más larga entre. */
export function escalaDelRubro(rubro: string, tamano: keyof typeof LETRAS_POR_RENGLON): number {
  const largo = palabraMasLarga(rubro);
  return largo <= LETRAS_POR_RENGLON[tamano] ? 1 : LETRAS_POR_RENGLON[tamano] / largo;
}

/** El tamaño del rubro en la imagen para compartir, en px. */
export function tamanoDelRubroEnOg(rubro: string): number {
  const largo = Math.max(1, palabraMasLarga(rubro));
  return Math.min(72, Math.floor(ANCHO_UTIL_OG / (largo * ANCHO_DE_LETRA)));
}
