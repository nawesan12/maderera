"use client";

import {
  BotonesDeFiltro,
  useFiltrosDeLista,
} from "@/components/admin/filtros-de-lista";

/**
 * Cortar las facturas de compra por si están pagas.
 *
 * Es el único corte que se usa de verdad en esta pantalla: se entra a ver qué
 * falta pagar, no a repasar el historial. El "Sin pagar" es además a donde
 * lleva el aviso de vencimientos del resumen.
 */
export function FiltroDePago({ actual }: { actual: string }) {
  const { actualizar } = useFiltrosDeLista({
    ruta: "/admin/compras/facturas",
    neutros: ["todas"],
  });

  return (
    <BotonesDeFiltro
      etiqueta="Filtrar por estado de pago"
      actual={actual}
      alElegir={(v) => actualizar({ pago: v })}
      opciones={[
        { valor: "todas", texto: "Todas" },
        { valor: "pendiente", texto: "Sin pagar" },
        { valor: "pagadas", texto: "Pagadas" },
      ]}
    />
  );
}
