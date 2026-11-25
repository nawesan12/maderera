"use client";

import { useActionState } from "react";
import { AlertCircle, Check, Loader2, X } from "lucide-react";
import {
  responderPresupuesto,
  type EstadoAccion,
} from "@/app/(public)/mi-cuenta/actions";

const estadoInicial: EstadoAccion = {};

/**
 * Aceptar o rechazar un presupuesto.
 *
 * Los dos botones viven en el mismo formulario y se distinguen por el `value`
 * del submit: así el `pending` de `useActionState` alcanza a los dos y no se
 * puede disparar el segundo mientras el primero está en vuelo.
 *
 * Aceptar es la acción principal y se ve como tal; rechazar existe pero no
 * compite visualmente, porque no es lo que se espera que pase.
 */
export function RespuestaPresupuesto({ numero }: { numero: string }) {
  const [estado, accion, pendiente] = useActionState(
    responderPresupuesto,
    estadoInicial,
  );

  if (estado.ok) {
    return (
      <p className="flex items-center gap-2 estado-ok rounded-lg bg-[var(--estado-fondo)] px-3.5 py-2.5 text-sm">
        <Check className="h-4 w-4 shrink-0" />
        {estado.ok}
      </p>
    );
  }

  return (
    <form action={accion} className="space-y-2.5">
      <input type="hidden" name="numero" value={numero} />

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          name="respuesta"
          value="aceptado"
          disabled={pendiente}
          // El naranja de la acción principal y no el verde de WhatsApp:
          // aceptar no abre WhatsApp, y el verde quedó solo para eso
          // (hallazgo 27; comité final).
          className="inline-flex h-11 items-center gap-2 rounded-lg bg-accion px-5 font-medium text-white transition-colors hover:bg-accion-hover disabled:opacity-60"
        >
          {pendiente ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          )}
          Aceptar presupuesto
        </button>

        <button
          type="submit"
          name="respuesta"
          value="rechazado"
          disabled={pendiente}
          className="inline-flex h-11 items-center gap-2 rounded-lg border px-4 font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
        >
          <X className="h-4 w-4" />
          No me sirve
        </button>
      </div>

      {estado.error && (
        <p
          role="alert"
          className="flex items-center gap-2 text-sm text-brand-red"
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          {estado.error}
        </p>
      )}
    </form>
  );
}
