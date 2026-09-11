"use client";

import {
  BotonesDeFiltro,
  CampoDeBusqueda,
  useFiltrosDeLista,
} from "@/components/admin/filtros-de-lista";

/**
 * Búsqueda y filtro por sucursal.
 *
 * El filtro de sucursal no es una comodidad: con el tablero lleno, cada local
 * necesita ver lo suyo. Casa Central mirando los pedidos del Aserradero solo
 * agrega ruido.
 */
export function BuscadorPedidos({
  busquedaActual,
  sucursalActual,
  sucursales,
}: {
  busquedaActual: string;
  sucursalActual: string;
  sucursales: { slug: string; nombre: string }[];
}) {
  const { texto, setTexto, actualizar } = useFiltrosDeLista({
    ruta: "/admin/pedidos",
    busquedaActual,
  });

  return (
    <div className="flex flex-wrap items-center gap-3">
      <CampoDeBusqueda
        valor={texto}
        alEscribir={setTexto}
        placeholder="Buscar por número, cliente o dirección…"
        etiqueta="Buscar pedidos"
      />
      <BotonesDeFiltro
        etiqueta="Filtrar por sucursal"
        actual={sucursalActual}
        alElegir={(v) => actualizar({ sucursal: v })}
        opciones={[
          { valor: "todas", texto: "Las dos sucursales" },
          ...sucursales.map((s) => ({ valor: s.slug, texto: s.nombre })),
        ]}
      />
    </div>
  );
}
