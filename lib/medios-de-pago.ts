/**
 * Las marcas con las que se paga en la maderera, con su logo.
 *
 * De la clienta (30/9/2026): «agregar logos de entidades bancarias en la
 * home». Y al preguntarle quién los carga: «los conseguís vos y los dejo
 * fijos». Por eso son una constante y no filas: las marcas no cambian de un
 * mes al otro, y un logo mal recortado subido desde el panel se ve en la
 * portada. Lo que sí cambia —qué promoción hay este mes— sigue en
 * `bank_promotions`, editable.
 *
 * Los archivos están en `public/bancos/`, recortados al contenido (sin el aire
 * que traen los originales, que los hacía verse de tamaños distintos). De
 * dónde salió cada uno:
 *
 * - Visa, Mastercard, American Express, Banco Nación, Banco Hipotecario y
 *   Naranja X: Wikimedia Commons, dominio público.
 * - Cabal: Wikimedia Commons, CC BY-SA 4.0.
 * - Mercado Pago: el paquete oficial de la marca (mercadopago.com.ar/mp/logo-oficial).
 * - MODO: el logotipo publicado en modo.com.ar.
 *
 * Tarjeta Fava, Clipper y Sport Club no tienen un logo publicado en buena
 * calidad: en las tarjetas de promoción siguen yendo con el nombre escrito,
 * que es como estaban.
 */

export type TipoDeMarca = "tarjeta" | "billetera" | "banco";

export interface MarcaDePago {
  clave: string;
  nombre: string;
  tipo: TipoDeMarca;
  /** Ruta en `public/`. */
  logo: string;
  /** Proporción del logo (ancho / alto), para reservar el lugar sin saltos. */
  proporcion: number;
  /**
   * Cómo puede venir escrito en una promoción cargada a mano. Se compara sin
   * tildes ni mayúsculas y sin «banco» ni «tarjeta» adelante.
   */
  alias: string[];
}

export const MARCAS_DE_PAGO: readonly MarcaDePago[] = [
  {
    clave: "visa",
    nombre: "Visa",
    tipo: "tarjeta",
    logo: "/bancos/visa.svg",
    proporcion: 1000 / 324.68,
    alias: ["visa"],
  },
  {
    clave: "mastercard",
    nombre: "Mastercard",
    tipo: "tarjeta",
    logo: "/bancos/mastercard.svg",
    proporcion: 1000 / 618,
    alias: ["mastercard", "master"],
  },
  {
    clave: "american-express",
    nombre: "American Express",
    tipo: "tarjeta",
    logo: "/bancos/american-express.svg",
    proporcion: 1,
    alias: ["american express", "amex"],
  },
  {
    clave: "cabal",
    nombre: "Cabal",
    tipo: "tarjeta",
    logo: "/bancos/cabal.svg",
    proporcion: 275 / 292,
    alias: ["cabal"],
  },
  {
    clave: "naranja-x",
    nombre: "Naranja X",
    tipo: "tarjeta",
    logo: "/bancos/naranja-x.svg",
    proporcion: 186 / 47,
    alias: ["naranja x", "naranja"],
  },
  {
    clave: "mercado-pago",
    nombre: "Mercado Pago",
    tipo: "billetera",
    logo: "/bancos/mercado-pago.svg",
    proporcion: 797 / 209,
    alias: ["mercado pago", "mercadopago"],
  },
  {
    clave: "modo",
    nombre: "MODO",
    tipo: "billetera",
    logo: "/bancos/modo.png",
    proporcion: 480 / 176,
    alias: ["modo"],
  },
  {
    clave: "banco-nacion",
    nombre: "Banco Nación",
    tipo: "banco",
    logo: "/bancos/banco-nacion.svg",
    proporcion: 55.562 / 12.78,
    alias: ["nacion", "de la nacion argentina", "bna"],
  },
  {
    clave: "banco-hipotecario",
    nombre: "Banco Hipotecario",
    tipo: "banco",
    logo: "/bancos/banco-hipotecario.svg",
    proporcion: 392 / 142,
    alias: ["hipotecario"],
  },
];

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^\s*(banco|tarjeta)\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * La marca de una promoción, por cómo la escribieron («Banco Nación»,
 * «Tarjeta Naranja», «MODO»). `null` si no es una de las que tienen logo.
 */
export function marcaDelMedio(medio: string): MarcaDePago | null {
  const buscado = normalizar(medio);
  if (!buscado) return null;
  return MARCAS_DE_PAGO.find((m) => m.alias.some((a) => normalizar(a) === buscado)) ?? null;
}
