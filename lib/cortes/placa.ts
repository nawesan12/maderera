/**
 * De qué medida es la placa que se va a cortar.
 *
 * Tres fuentes, en este orden: lo que se cargó a mano en el trabajo, lo que
 * dice la variante del catálogo, y —si no hay ninguna de las dos— la medida de
 * plaza más común, que es un supuesto y la pantalla lo dice.
 *
 * Y encima, la mitad. La maderera vende media placa, y no es lo mismo partirla
 * a lo largo que al ancho: de una 2750 × 1830 salen dos de 2750 × 915 o dos de
 * 1375 × 1830. Qué piezas entran cambia por completo, así que el sentido lo
 * elige quien carga el trabajo —depende de la placa que haya en el depósito y
 * de cómo corre el dibujo cuando es de color— y no lo adivina el sistema.
 *
 * Es lógica pura: la usa el panel, el mostrador, la hoja impresa y el sitio.
 */

import { MEDIDAS_DE_PLACA } from "@/lib/calculations";

/** En qué sentido se parte la placa. Nulo es placa entera. */
export type Mitad = "largo" | "ancho" | null;

export interface MedidaDePlaca {
  /** Corre en el sentido de la veta. Es el eje horizontal del plano. */
  largo: number;
  ancho: number;
  /** Si estos números son un supuesto y no un dato cargado. */
  supuesta: boolean;
  /** La mitad aplicada, si el trabajo sale de media placa. */
  mitad: Mitad;
}

export function medidaDePlaca({
  propiaLargo,
  propiaAncho,
  varianteLargo,
  varianteAncho,
  mitad = null,
}: {
  /** Lo cargado a mano en el trabajo. */
  propiaLargo?: number | null;
  propiaAncho?: number | null;
  /** Lo que dice la variante del catálogo. */
  varianteLargo?: number | null;
  varianteAncho?: number | null;
  mitad?: Mitad;
}): MedidaDePlaca {
  const porDefecto = MEDIDAS_DE_PLACA[0]!;

  // Las dos medidas van juntas: media cargada a mano y media de la variante
  // daría una placa que no existe.
  const propia = propiaLargo && propiaAncho;
  const variante = varianteLargo && varianteAncho;

  const largoEntero = propia ? propiaLargo! : variante ? varianteLargo! : porDefecto.largo;
  const anchoEntero = propia ? propiaAncho! : variante ? varianteAncho! : porDefecto.ancho;

  return {
    // Partir a lo largo deja la veta entera y angosta la placa; al ancho la
    // corta y la acorta.
    largo: mitad === "ancho" ? Math.floor(largoEntero / 2) : largoEntero,
    ancho: mitad === "largo" ? Math.floor(anchoEntero / 2) : anchoEntero,
    supuesta: !propia && !variante,
    mitad,
  };
}

/** Cómo se dice en pantalla de qué sale el trabajo. */
export function nombreDeLaMitad(mitad: Mitad): string {
  if (mitad === "largo") return "Media placa, partida a lo largo";
  if (mitad === "ancho") return "Media placa, partida al ancho";
  return "Placa entera";
}

/**
 * Qué porción de placa se compra por cada placa del plano.
 *
 * Media placa se cobra media: el plano cuenta «placas», y de media placa sale
 * media placa.
 */
export function fraccionDePlaca(mitad: Mitad): number {
  return mitad ? 0.5 : 1;
}
