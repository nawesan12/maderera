"use client";

import { useActionState } from "react";
import { Loader2, Lock, LockOpen } from "lucide-react";
import { cerrarElMes, type EstadoDelCierre } from "./actions";

/**
 * Cerrar el mes, la acción para la que existe la pantalla (H408): va en la
 * cabecera, al lado de lo que se le manda al estudio. Cerrado, queda el
 * estado y la forma de reabrirlo, en segundo plano.
 */
export function CerrarMes({
  periodo,
  nombre,
  cerrado,
  cuando,
  terminado,
}: {
  periodo: string;
  /** «noviembre». */
  nombre: string;
  cerrado: boolean;
  /** «26/11 · Ana», si está cerrado. */
  cuando: string | null;
  /** Un mes que no terminó no se cierra. */
  terminado: boolean;
}) {
  const [estado, accion, pendiente] = useActionState<EstadoDelCierre, FormData>(cerrarElMes, {});

  if (!cerrado && !terminado) return null;

  return (
    <form action={accion} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="periodo" value={periodo} />
      <input type="hidden" name="cerrado" value={cerrado ? "no" : "si"} />
      {cerrado ? (
        <>
          <span className="estado-ok inline-flex h-11 items-center gap-1.5 rounded-lg bg-[var(--estado-fondo)] px-3.5 text-base font-medium text-[var(--estado-tinta)]">
            <Lock className="h-4 w-4" aria-hidden />
            Cerrado{cuando ? ` · ${cuando}` : ""}
          </span>
          <button
            type="submit"
            disabled={pendiente}
            className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-linea px-3.5 text-base font-medium hover:bg-hundida disabled:opacity-60"
          >
            {pendiente ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockOpen className="h-4 w-4" aria-hidden />}
            Reabrir
          </button>
        </>
      ) : (
        <button
          type="submit"
          disabled={pendiente}
          className="boton-accion inline-flex h-11 items-center gap-1.5 rounded-lg px-4 text-base font-medium disabled:opacity-60"
        >
          {pendiente ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" aria-hidden />}
          Cerrar {nombre}
        </button>
      )}
      {estado.error && (
        <p role="alert" className="estado-problema w-full text-base text-[var(--estado-tinta)]">
          {estado.error}
        </p>
      )}
    </form>
  );
}
