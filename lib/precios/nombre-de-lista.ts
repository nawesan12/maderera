/**
 * Cómo se nombra una lista de precios en una frase: «la lista Gremio», pero
 * «la Lista profesional» y no «la lista Lista profesional» (mes 23; el PDF ya
 * lo hacía, pdf.TituloDeLista). Separado en artículo y nombre para que la
 * pantalla pueda resaltar solo el nombre.
 */
export function laLista(nombre: string): { antes: string; nombre: string } {
  const n = nombre.trim();
  return /^lista\b/i.test(n) ? { antes: "la ", nombre: n } : { antes: "la lista ", nombre: n };
}
