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
 * Partirla es una pasada de sierra, y el disco se come su ancho: de una placa
 * de 1220 con un disco de 3,2 mm salen dos de 608, no de 610. Hasta la T4
 * (hallazgo 23) se partía sin descontarlo, y una pieza de 610 «entraba» en
 * pantalla y no en el depósito. La sierra la pasa cada llamada —es la del
 * trabajo, o la de la configuración—; sin sierra, la cuenta es la de antes
 * (es lo que congela el golden).
 *
 * Es lógica pura: la usa el panel, el mostrador, la hoja impresa y el sitio.
 */

import { MEDIDAS_DE_PLACA } from "@/lib/cortes/tipos";

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
  sierra = 0,
}: {
  /** Lo cargado a mano en el trabajo. */
  propiaLargo?: number | null;
  propiaAncho?: number | null;
  /** Lo que dice la variante del catálogo. */
  varianteLargo?: number | null;
  varianteAncho?: number | null;
  mitad?: Mitad;
  /** El ancho del disco, en mm: lo que se pierde al partirla. */
  sierra?: number;
}): MedidaDePlaca {
  const porDefecto = MEDIDAS_DE_PLACA[0]!;

  // Las dos medidas van juntas: media cargada a mano y media de la variante
  // daría una placa que no existe.
  const propia = propiaLargo && propiaAncho;
  const variante = varianteLargo && varianteAncho;

  const largoEntero = propia ? propiaLargo! : variante ? varianteLargo! : porDefecto.largo;
  const anchoEntero = propia ? propiaAncho! : variante ? varianteAncho! : porDefecto.ancho;
  const disco = Number.isFinite(sierra) && sierra > 0 ? sierra : 0;

  return {
    // Partir a lo largo deja la veta entera y angosta la placa; al ancho la
    // corta y la acorta.
    // Hacia abajo: prometer el milímetro que no está es lo que hace que la
    // última pieza no entre. Igual que `ResolverMedida` en Go.
    largo: mitad === "ancho" ? Math.floor((largoEntero - disco) / 2) : largoEntero,
    ancho: mitad === "largo" ? Math.floor((anchoEntero - disco) / 2) : anchoEntero,
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
 * Qué porción del precio de la placa se cobra por cada placa del plano.
 *
 * Media placa se cobra al porcentaje que el producto tiene cargado para la
 * media (`products.precioMediaPct`, por omisión 50 %): el mismo número que
 * cobra el mostrador cuando la vende suelta. Antes era siempre la mitad, y el
 * corte y la venta suelta de la misma media placa daban precios distintos.
 *
 * Lo que descuenta del stock es otra cuenta: `factorDeStock` en
 * `lib/ventas/forma-de-venta.ts` —media placa son 0,5 placas, valga lo que
 * valga—.
 */
export function fraccionDePlaca(mitad: Mitad, pctMedia = 50): number {
  return mitad ? pctMedia / 100 : 1;
}
