"use client";

import {
  BotonesDeFiltro,
  useFiltrosDeLista,
} from "@/components/admin/filtros-de-lista";

/**
 * Cortar los gastos por circuito de facturación.
 *
 * Los dos conjuntos se miran por separado casi siempre: el total del mes
 * mezclado no sirve para decidir en ninguno de los dos. Ver
 * `lib/db/schema/circuito.ts`.
 */
export function FiltroDeCircuito({ actual }: { actual: string }) {
  const { actualizar } = useFiltrosDeLista({
    ruta: "/admin/compras/gastos",
    neutros: ["todos"],
  });

  return (
    <BotonesDeFiltro
      etiqueta="Filtrar por circuito"
      actual={actual}
      alElegir={(v) => actualizar({ circuito: v })}
      opciones={[
        { valor: "todos", texto: "Los dos" },
        { valor: "blanco", texto: "En blanco" },
        { valor: "negro", texto: "En negro" },
      ]}
    />
  );
}
