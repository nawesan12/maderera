"use client";

import {
  BotonesDeFiltro,
  useFiltrosDeLista,
} from "@/components/admin/filtros-de-lista";
import { FiltroRango } from "@/components/admin/filtro-rango";

/**
 * Cortar las facturas de compra por proveedor, por fecha de emisión y por si
 * están pagas.
 *
 * Proveedor y fechas cortan también lo que falta pagar; «Pagadas» y «Todas»
 * (con las anuladas) es el historial de abajo. «Sin pagar» deja solo lo
 * pendiente: es a donde lleva el aviso de vencimientos del inicio.
 */
export function FiltrosDeFacturas({
  proveedores,
  proveedor,
  estado,
  desde,
  hasta,
}: {
  proveedores: { id: string; nombre: string }[];
  proveedor: string;
  estado: string;
  desde?: string;
  hasta?: string;
}) {
  const { actualizar } = useFiltrosDeLista({
    ruta: "/admin/compras/facturas",
    neutros: ["pagadas"],
  });

  return (
    <div className="flex flex-wrap items-center gap-3">
      <select
        value={proveedor}
        onChange={(e) => actualizar({ proveedor: e.target.value })}
        aria-label="Proveedor"
        className="h-11 min-w-56 rounded-lg border border-linea bg-card px-3 text-base"
      >
        <option value="">Todos los proveedores</option>
        {proveedores.map((p) => (
          <option key={p.id} value={p.id}>
            {p.nombre}
          </option>
        ))}
      </select>
      <FiltroRango desde={desde} hasta={hasta} />
      <BotonesDeFiltro
        etiqueta="Filtrar por estado de pago"
        actual={estado}
        alElegir={(v) => actualizar({ pago: v })}
        opciones={[
          { valor: "pendiente", texto: "Sin pagar" },
          { valor: "pagadas", texto: "Pagadas" },
          { valor: "todas", texto: "Todas" },
        ]}
      />
    </div>
  );
}
