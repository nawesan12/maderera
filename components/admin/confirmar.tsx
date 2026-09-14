"use client";

import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * "¿Seguro?", una sola vez y para todo el panel.
 *
 * El problema no era que faltaran confirmaciones: era que estaban repartidas.
 * Anular una factura pedía motivo en un diálogo propio, anular un cheque no
 * preguntaba nada, y dar de baja un documento era un tacho de 32 píxeles sin
 * etiqueta. Quien opera aprende de la pantalla qué cosas son graves, y si la
 * misma app le contesta distinto cada vez, deja de leer.
 *
 * Dos reglas que el componente impone y no deja negociar:
 *
 * 1. **El título nombra la cosa**, no la acción: "Anular el cheque 00412345",
 *    no "¿Confirmar?". Quien está por apretar tiene que poder darse cuenta de
 *    que se equivocó de fila.
 * 2. **El detalle dice qué no tiene vuelta.** Si algo es para siempre, se
 *    escribe; si se puede deshacer, también, porque eso es lo que destraba.
 *
 * Lo que no hace: no reemplaza a los diálogos que además **piden un dato**
 * —el motivo de una anulación fiscal—. Esos siguen teniendo el suyo, porque
 * ahí la confirmación no es el punto: el dato lo es.
 */
export function Confirmar({
  abierto,
  alCerrar,
  titulo,
  detalle,
  confirmar,
  cancelar = "Mejor no",
  peligro,
  pendiente,
  alConfirmar,
}: {
  abierto: boolean;
  alCerrar: () => void;
  titulo: string;
  detalle: string;
  /** Qué dice el botón que ejecuta. Un verbo, no "Aceptar". */
  confirmar: string;
  cancelar?: string;
  /** Pinta de rojo lo que no tiene vuelta atrás. */
  peligro?: boolean;
  pendiente?: boolean;
  alConfirmar: () => void;
}) {
  return (
    <Dialog open={abierto} onOpenChange={(v) => !v && alCerrar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription className="text-base">{detalle}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={alCerrar}
            className="h-11 rounded-lg border border-linea px-4 text-base font-medium transition-colors hover:bg-hundida"
          >
            {cancelar}
          </button>
          <button
            type="button"
            disabled={pendiente}
            onClick={alConfirmar}
            className={`inline-flex h-11 items-center gap-2 rounded-lg px-4 text-base font-medium transition-opacity disabled:opacity-50 ${
              peligro ? "bg-destructive text-white" : "boton-accion"
            }`}
          >
            {pendiente && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirmar}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
