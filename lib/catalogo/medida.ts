/**
 * La medida que la tarjeta muestra en el lugar del precio (hallazgo 26 del
 * comité, 18/11/2026).
 *
 * Con la tienda apagada ningún producto trae precio, y «A consultar» en
 * negrita era lo más grande de cada tarjeta, 29 veces. Lo que sirve para
 * decidir sin abrir la ficha es la medida: «1220 × 2440 mm — 18 mm».
 *
 * Si hay varias va la primera —el orden es el que cargó la clienta— y el
 * resto como contador («+2»), que lleva a la ficha. Algunas etiquetas no son
 * medidas («Rojo teja», «A medida — consultar»): se muestran igual, porque es
 * lo que se cargó y lo que se dicta en el mostrador.
 */
export interface MedidaPrincipal {
  /** La etiqueta entera, para el `aria-label` y el texto de WhatsApp. */
  texto: string;
  /**
   * La etiqueta partida donde se puede cortar el renglón: «1220 × 2440 mm» y
   * «18 mm». Cada parte va sin cortes por dentro; entre una y otra sí, para
   * que en la grilla de dos columnas del celular no se salga de la tarjeta.
   */
  partes: string[];
  /** Cuántas medidas más hay. Cero si es la única. */
  resto: number;
}

export function medidaPrincipal(labels: readonly (string | null | undefined)[]): MedidaPrincipal | null {
  const limpias = labels.map((l) => (l ?? "").replace(/\s+/g, " ").trim()).filter(Boolean);
  if (limpias.length === 0) return null;
  const texto = limpias[0];
  return {
    texto,
    partes: texto
      .split(/\s+[—–]\s+/)
      .map((p) => p.trim())
      .filter(Boolean),
    resto: limpias.length - 1,
  };
}
