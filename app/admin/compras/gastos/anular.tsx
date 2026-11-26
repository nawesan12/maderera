"use client";

import { toast } from "sonner";
import { AnularConMotivo } from "../anular-con-motivo";
import { anularGasto } from "./actions";

/**
 * Anular un gasto desde su renglón. Lo que contesta Go queda a la vista: si
 * el efectivo volvió a la caja o si la caja no tenía turno abierto.
 */
export function AnularGasto({ id, titulo, detalle }: { id: string; titulo: string; detalle: string }) {
  return (
    <AnularConMotivo
      compacto
      titulo={titulo}
      detalle={detalle}
      confirmar="Anular el gasto"
      anular={(motivo) => anularGasto(id, motivo)}
      alTerminar={(ok) => toast.success(ok || "Gasto anulado.")}
    />
  );
}
