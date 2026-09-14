"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

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
  rubros,
}: {
  actual: string;
  rubros: { slug: string; name: string }[];
}) {
  const router = useRouter();
  const parametros = useSearchParams();
  const [pendiente, iniciar] = useTransition();

  function elegir(valor: string) {
    const params = new URLSearchParams(parametros.toString());
    if (valor === "todos") params.delete("rubro");
    else params.set("rubro", valor);
    const s = params.toString();
    iniciar(() => router.replace(s ? `?${s}` : "?", { scroll: false }));
  }

  return (
    <label className="flex items-center gap-2">
      <span className="text-base text-muted-foreground">Rubro</span>
      <select
        value={actual}
        onChange={(e) => elegir(e.target.value)}
        aria-busy={pendiente}
        className="h-11 rounded-lg border border-linea bg-card px-3 text-base outline-none transition-colors focus:border-accion/50"
      >
        <option value="todos">Todos los rubros</option>
        {rubros.map((r) => (
          <option key={r.slug} value={r.slug}>
            {r.name}
          </option>
        ))}
      </select>
    </label>
  );
}
