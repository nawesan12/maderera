"use client";

import { useActionState, useState } from "react";
import { AlertCircle, Check, Loader2, X } from "lucide-react";
import {
  responderPresupuesto,
  type EstadoAccion,
} from "@/app/(public)/mi-cuenta/actions";

const estadoInicial: EstadoAccion = {};

/**
 * Los motivos que puede elegir el cliente al rechazar (espejo de
 * portal.MotivosDelCliente en Go): el vendedor no sabía por qué se caía un
 * presupuesto (mes simulado, M2S2-114).
 */
const MOTIVOS = ["Precio", "Plazo de entrega", "Ya lo compré", "Otro"] as const;

/**
 * Aceptar o rechazar un presupuesto.
 *
 * Aceptar es la acción principal y se ve como tal. «No me sirve» queda
 * aparte, a la derecha, y no rechaza de un toque: abre en el mismo lugar los
 * motivos y un «Rechazar» en rojo, que es el segundo toque. Con un toque sin
 * querer en el teléfono se perdía el presupuesto (M3S3-011).
 */
export function RespuestaPresupuesto({
  numero,
  desde,
}: {
  numero: string;
  /** Desde el Resumen, la acción lleva al detalle al responder (H215). */
  desde?: "resumen";
}) {
  const [estado, accion, pendiente] = useActionState(
    responderPresupuesto,
    estadoInicial,
  );
  const [rechazando, setRechazando] = useState(false);
  const [motivo, setMotivo] = useState<string>("");

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
      {desde && <input type="hidden" name="desde" value={desde} />}

      {rechazando ? (
        <div className="space-y-2.5">
          <input type="hidden" name="motivo" value={motivo} />
          <div className="flex flex-wrap gap-2" role="group" aria-label="Por qué no te sirve">
            {MOTIVOS.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={motivo === m}
                onClick={() => setMotivo(m)}
                className={`inline-flex h-10 items-center rounded-full px-3.5 text-sm font-medium transition-colors ${
                  motivo === m ? "bg-foreground text-background" : "bg-hundida text-texto-2 hover:text-foreground"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              name="respuesta"
              value="rechazado"
              disabled={pendiente}
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-destructive px-4 font-medium text-white transition-colors hover:bg-destructive/90 disabled:opacity-60"
            >
              {pendiente ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
              Rechazar {numero}
            </button>
            <button
              type="button"
              onClick={() => {
                setRechazando(false);
                setMotivo("");
              }}
              className="inline-flex h-11 items-center rounded-lg px-3 text-sm font-medium text-texto-2 hover:text-foreground"
            >
              Volver
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
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
            type="button"
            onClick={() => setRechazando(true)}
            disabled={pendiente}
            className="ml-auto inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-texto-2 transition-colors hover:text-foreground disabled:opacity-60"
          >
            No me sirve
          </button>
        </div>
      )}

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
