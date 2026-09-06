"use server";

import { sugerirDelCatalogo, type Sugerencia } from "@/lib/dal/sugerencias";

/**
 * Qué hay en el catálogo para lo que se calculó.
 *
 * Es pública a propósito y no expone nada que el catálogo no muestre ya: los
 * mismos productos, con el precio de la lista de quien pregunta —que es cómo
 * lo resuelve todo el resto del sitio—.
 */
export async function buscarSugerencias(
  terminos: string[],
): Promise<Sugerencia[]> {
  // Tope duro: la calculadora manda como mucho cinco renglones. Un arreglo de
  // mil términos desde afuera serían mil consultas.
  return sugerirDelCatalogo(terminos.slice(0, 8));
}
