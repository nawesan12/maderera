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
 * Proveedor y fechas cortan también lo que falta pagar. Sin ninguna marcada
 * se ve lo que falta pagar y lo pagado; «Sin pagar» deja solo lo pendiente
 * (es a donde lleva el aviso de vencimientos del inicio), «Pagadas» solo lo
 * pagado y «Todas» suma las anuladas.
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
  const { actualizar } = useFiltrosDeLista({ ruta: "/admin/compras/facturas", neutros: [] });

  return (
    <div className="flex flex-wrap items-center gap-3">
      <select
        value={proveedor}
        onChange={(e) => actualizar({ proveedor: e.target.value })}
        aria-label="Proveedor"
        className="h-11 w-full min-w-0 rounded-lg border border-linea bg-card px-3 text-base sm:w-auto sm:min-w-56"
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
        // Tocar la marcada la saca: vuelve a lo de siempre (lo que falta
        // pagar y lo pagado, sin las anuladas).
        alElegir={(v) => actualizar({ pago: v === estado ? null : v })}
        opciones={[
          { valor: "pendiente", texto: "Sin pagar" },
          { valor: "pagadas", texto: "Pagadas" },
          { valor: "todas", texto: "Todas" },
        ]}
      />
    </div>
  );
}
