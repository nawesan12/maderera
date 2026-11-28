"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { nombresDeRubros } from "@/lib/catalogo/rubros";

/**
 * Filtrar una pantalla por rubro.
 *
 * "Reporte de stock por rubros" pedía la clienta. El rubro estaba como columna
 * del listado de reposición, pero no había con qué filtrar: para contestar
 * "¿qué me falta de bulonería?" había que leer una tabla de cientos de
 * renglones buscando a ojo.
 *
 * Es un `<select>` y no una fila de botones como los otros filtros de la misma
 * pantalla porque los rubros son más de cuarenta: la ferretería sola trae 43.
 */
export function SelectorDeRubro({
  actual,
  grupos,
}: {
  actual: string;
  /**
   * Los rubros de cada categoría. Van agrupados y en orden alfabético: el
   * mismo nombre vive en varias categorías («Accesorios» en tres) y en una
   * lista plana se veía repetido sin saber cuál era cuál (simulación del
   * mes, H069).
   */
  grupos: { categoria: string; rubros: { id: string; slug: string; name: string }[] }[];
}) {
  const router = useRouter();
  const parametros = useSearchParams();
  const nombres = nombresDeRubros(grupos);
  const [pendiente, iniciar] = useTransition();

  function elegir(valor: string) {
    const params = new URLSearchParams(parametros.toString());
    if (valor === "todos") params.delete("rubro");
    else params.set("rubro", valor);
    const s = params.toString();
    iniciar(() => router.replace(s ? `?${s}` : "?", { scroll: false }));
  }

  return (
    <label className="flex w-full items-center gap-2 sm:w-auto">
      <span className="text-base text-muted-foreground">Rubro</span>
      <select
        value={actual}
        onChange={(e) => elegir(e.target.value)}
        aria-busy={pendiente}
        className="h-11 min-w-0 flex-1 rounded-lg border border-linea bg-card px-3 text-base outline-none transition-colors focus:border-accion/50 sm:flex-none"
      >
        <option value="todos">Todos los rubros</option>
        {grupos.map((g) => (
          <optgroup key={g.categoria} label={g.categoria}>
            {/* Por id: el slug se repite entre categorías y elegir
                «Accesorios» de Placas traía los de las tres (H069). */}
            {g.rubros.map((r) => (
              <option key={r.id} value={r.id}>
                {/* El nombre que se repite en otra categoría lleva la suya:
                    el teléfono no siempre muestra el grupo (M2S4-034). */}
                {nombres.get(r.id) ?? r.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}
