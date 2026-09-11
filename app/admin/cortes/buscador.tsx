"use client";

import {
  CampoDeBusqueda,
  useFiltrosDeLista,
} from "@/components/admin/filtros-de-lista";

export function BuscadorCortes({ busquedaActual }: { busquedaActual: string }) {
  const { texto, setTexto } = useFiltrosDeLista({
    ruta: "/admin/cortes",
    busquedaActual,
  });

  return (
    <CampoDeBusqueda
      className="max-w-xl"
      valor={texto}
      alEscribir={setTexto}
      placeholder="Buscar por número, cliente o material…"
      etiqueta="Buscar cortes"
    />
  );
}
