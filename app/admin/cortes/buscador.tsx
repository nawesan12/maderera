"use client";

import {
  BotonesDeFiltro,
  CampoDeBusqueda,
  useFiltrosDeLista,
} from "@/components/admin/filtros-de-lista";

/**
 * El buscador de la cola, y el taller de cada sucursal.
 *
 * `ruta` es la pantalla donde se filtra: en `/taller` buscaba en
 * `/admin/cortes` y sacaba al operario al panel, con «Marcar retirado»,
 * «Nuevo corte» y «Tarifas» a la vista (mes simulado, H401).
 */
export function BuscadorCortes({
  busquedaActual,
  ruta = "/admin/cortes",
  sucursales,
  sucursalActual = "",
}: {
  busquedaActual: string;
  ruta?: string;
  /** Con dos talleres, cuál mirar (H122). */
  sucursales?: { id: string; nombre: string }[];
  sucursalActual?: string;
}) {
  const { texto, setTexto, actualizar } = useFiltrosDeLista({
    ruta,
    busquedaActual,
  });

  return (
    <div className="flex flex-wrap items-center gap-3">
      <CampoDeBusqueda
        className="max-w-xl"
        valor={texto}
        alEscribir={setTexto}
        placeholder="Buscar por número, cliente o material…"
        etiqueta="Buscar cortes"
      />
      {sucursales && sucursales.length > 1 && (
        <BotonesDeFiltro
          etiqueta="Taller"
          actual={sucursalActual || "todas"}
          alElegir={(v) => actualizar({ sucursal: v })}
          opciones={[{ valor: "todas", texto: "Todas" }, ...sucursales.map((s) => ({ valor: s.id, texto: s.nombre }))]}
        />
      )}
    </div>
  );
}
