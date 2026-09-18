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

/** Cómo se nombra el circuito en una oración. */
export function etiquetaDeCircuito(valor: string): string {
  return ETIQUETA_CIRCUITO[valor as Circuito] ?? valor;
}
