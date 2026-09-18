"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { RUBROS_CLIENTE } from "@/lib/rubros-cliente";

/**
 * Con qué se acota el reporte, además del período.
 *
 * **Cortar y filtrar no son lo mismo**, y hasta ahora solo se podía cortar: el
 * reporte sabía agrupar por rubro pero no *quedarse* con un rubro, así que «qué
 * le vendemos a las constructoras» no tenía respuesta —la lista traía todos los
 * clientes mezclados—. La clienta lo pidió al pedir ver el crecimiento de cada
 * gremio.
 *
 * Como el resto de los filtros del panel, viaja en la URL: así «lo vendido a
 * carpinterías este año» es un enlace que se manda y abre lo mismo del otro
 * lado.
 */
export function FiltrosDelReporte({
  rubro,
  sucursal,
  sucursales,
}: {
  rubro: string;
  sucursal: string;
  sucursales: { id: string; nombre: string }[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pendiente, iniciar] = useTransition();

  function cambiar(clave: string, valor: string) {
    const params = new URLSearchParams(searchParams.toString());

    // El valor neutro se borra en vez de escribirse: la dirección del caso
    // normal queda corta.
    if (!valor || valor === "todos" || valor === "todas") params.delete(clave);
    else params.set(clave, valor);

    iniciar(() =>
      router.replace(params.size > 0 ? `?${params}` : "?", { scroll: false }),
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2" aria-busy={pendiente}>
      <label className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Rubro del cliente</span>
        <select
          value={rubro}
          onChange={(e) => cambiar("rubro", e.target.value)}
          className="h-10 rounded-lg border border-linea bg-card px-2.5 text-base"
        >
          <option value="todos">Todos</option>
          {RUBROS_CLIENTE.map((r) => (
            <option key={r.valor} value={r.valor}>
              {r.etiqueta}
            </option>
          ))}
        </select>
      </label>

      {sucursales.length > 1 && (
        <label className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Sucursal</span>
          <select
            value={sucursal}
            onChange={(e) => cambiar("sucursal", e.target.value)}
            className="h-10 rounded-lg border border-linea bg-card px-2.5 text-base"
          >
            <option value="todas">Todas</option>
            {sucursales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
