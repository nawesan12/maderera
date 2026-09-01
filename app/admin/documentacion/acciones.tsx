"use client";

import { useActionState } from "react";
import { Loader2, Lock, Trash2, Unlock } from "lucide-react";
import {
  borrarDocumento,
  cambiarVisibilidad,
  type EstadoDocumento,
} from "./actions";

const inicial: EstadoDocumento = {};

/** Cambiar quién ve el documento, o darlo de baja. */
export function AccionesDocumento({
  id,
  soloProfesionales,
}: {
  id: string;
  soloProfesionales: boolean;
}) {
  const [, cambiar, cambiando] = useActionState(cambiarVisibilidad, inicial);
  const [, borrar, borrando] = useActionState(borrarDocumento, inicial);

  return (
    <div className="flex items-center gap-2">
      <form action={cambiar}>
        <input type="hidden" name="id" value={id} />
        <input
          type="hidden"
          name="soloProfesionales"
          value={soloProfesionales ? "no" : "si"}
        />
        <button
          type="submit"
          disabled={cambiando}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted disabled:opacity-60"
        >
          {cambiando ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : soloProfesionales ? (
            <Unlock className="h-4 w-4" />
          ) : (
            <Lock className="h-4 w-4" />
          )}
          {soloProfesionales ? "Hacer público" : "Reservar"}
        </button>
      </form>

      <form action={borrar}>
        <input type="hidden" name="id" value={id} />
        <button
          type="submit"
          disabled={borrando}
          aria-label="Dar de baja"
          className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive disabled:opacity-60"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
