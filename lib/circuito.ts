/**
 * Cómo se llaman los dos circuitos de facturación en la pantalla.
 *
 * Vive acá y no junto al enum de la base (`lib/db/schema/circuito.ts`) porque
 * los toggles y los filtros que muestran estas palabras son componentes de
 * cliente, y ese archivo importa `drizzle-orm/pg-core`: traerlo al navegador
 * arrastraría media base de datos al bundle. Por eso antes cada toggle repetía
 * las palabras a mano, y por eso al renombrarlas había cinco lugares que
 * podían quedar desfasados.
 *
 * Qué significan y por qué se llaman así está en el enum; lo que hay acá es la
 * traducción a lo que el equipo dice: **"Facturas"** y **"B"**.
 */

export const CIRCUITOS = ["blanco", "negro"] as const;

export type Circuito = (typeof CIRCUITOS)[number];

export const ETIQUETA_CIRCUITO: Record<Circuito, string> = {
  blanco: "Facturas",
  negro: "B",
};

/**
 * Cómo se llama el circuito sin factura: la regla `etiqueta_del_circuito`
 * (/admin/reglas, H167). «B» se leía como Factura B. Cambia solo la palabra;
 * el valor guardado («negro») y el archivo de asientos no cambian. Espejo de
 * `reglas.EtiquetaCorta` y `reglas.EnUnaFrase` en Go.
 */
export type NombreDelCircuito = "b" | "sin_factura" | "interno";

const CORTA: Record<NombreDelCircuito, string> = { b: "B", sin_factura: "Sin factura", interno: "Interno" };
const FRASE: Record<NombreDelCircuito, string> = {
  b: "circuito B",
  sin_factura: "circuito sin factura",
  interno: "circuito interno",
};

/** Las dos etiquetas («Facturas» y la del circuito sin factura) según la regla. */
export function etiquetasDelCircuito(nombre: NombreDelCircuito = "b"): Record<Circuito, string> {
  return { blanco: ETIQUETA_CIRCUITO.blanco, negro: CORTA[nombre] ?? CORTA.b };
}

/** Cómo se dice en una oración: «circuito B», «circuito sin factura»… */
export function fraseDelCircuito(nombre: NombreDelCircuito = "b"): string {
  return FRASE[nombre] ?? FRASE.b;
}

/** El chip o el título del circuito sin factura: «Circuito B», «Sin factura», «Circuito interno». */
export function rotuloDelCircuito(nombre: NombreDelCircuito = "b"): string {
  const f = fraseDelCircuito(nombre);
  return nombre === "sin_factura" ? "Sin factura" : f[0].toUpperCase() + f.slice(1);
}

/** Cómo se nombra el circuito en una oración. */
export function etiquetaDeCircuito(valor: string, etiquetas: Record<Circuito, string> = ETIQUETA_CIRCUITO): string {
  return etiquetas[valor as Circuito] ?? valor;
}
