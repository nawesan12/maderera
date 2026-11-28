/**
 * Cómo se nombra cada rubro en una lista agrupada por categoría: el nombre
 * que se repite en otra categoría («Accesorios» en tres) lleva la suya, porque
 * el teléfono no siempre muestra el grupo del `<select>` (M2S4-034).
 */
export function nombresDeRubros(
  grupos: { categoria: string; rubros: { id: string; name: string }[] }[],
): Map<string, string> {
  const vistos = new Map<string, number>();
  for (const g of grupos) for (const r of g.rubros) vistos.set(r.name, (vistos.get(r.name) ?? 0) + 1);
  const nombres = new Map<string, string>();
  for (const g of grupos) {
    for (const r of g.rubros) nombres.set(r.id, (vistos.get(r.name) ?? 0) > 1 ? `${r.name} · ${g.categoria}` : r.name);
  }
  return nombres;
}
