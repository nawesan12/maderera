"use client";

import { useActionState, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { marcarAsistencia, type EstadoEvento } from "./actions";
import { fechaCorta } from "@/lib/formato";
import type { Asistente } from "@/lib/dal/admin/eventos";

const inicial: EstadoEvento = {};

const ESTADOS: Record<string, { texto: string; clase: string }> = {
  reservada: {
    texto: "Sin pagar",
    clase: "estado-espera bg-[var(--estado-fondo)] text-[var(--estado-tinta)]",
  },
  confirmada: {
    texto: "Confirmado",
    clase: "estado-ok bg-[var(--estado-fondo)] text-[var(--estado-tinta)]",
  },
  cancelada: {
    texto: "Cancelada",
    clase: "bg-muted text-muted-foreground line-through",
  },
};

/**
 * Lista de asistentes, plegada.
 *
 * Se despliega porque en la pantalla de eventos lo que se escanea es el estado
 * de cada uno; el detalle de quién viene se mira cuando se está armando la sala
 * o tomando asistencia.
 *
 * «Vino» y «No vino» son un selector con la opción elegida en relieve, y
 * aparecen desde que el evento empezó: antes se podía marcar días antes, y la
 * pastilla repetía «Vino» al lado de dos botones iguales (M2S1-129, M3S4-018).
 */
export function Asistentes({ asistentes, empezo }: { asistentes: Asistente[]; empezo: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const [resultado, marcar] = useActionState(marcarAsistencia, inicial);

  if (asistentes.length === 0) {
    return (
      <p className="px-5 py-4 text-base text-muted-foreground">
        Todavía no se anotó nadie.
      </p>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="flex w-full items-center gap-2 px-5 py-3 text-left text-base font-medium transition-colors hover:bg-muted/50"
      >
        {abierto ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
        {asistentes.length} anotado{asistentes.length === 1 ? "" : "s"}
      </button>

      {abierto && (
        <ul className="divide-y border-t">
          {asistentes.map((a) => {
            const tomaAsistencia = empezo && (a.estado === "confirmada" || a.estado === "asistio" || a.estado === "ausente");
            // Antes de empezar, «vino» o «no vino» no corresponden todavía:
            // tiene el lugar confirmado.
            const estado =
              ESTADOS[a.estado] ?? (a.estado === "asistio" || a.estado === "ausente" ? ESTADOS.confirmada : undefined);

            return (
              <li
                key={a.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3"
              >
                <span className="min-w-[14rem] flex-1 text-base">
                  {a.nombre}
                  <span className="block text-muted-foreground">
                    {a.email}
                    {a.telefono ? ` · ${a.telefono}` : ""}
                  </span>
                </span>

                <span className="tabular text-base text-muted-foreground">
                  {fechaCorta.format(a.createdAt)}
                </span>

                {tomaAsistencia ? (
                  <div role="group" aria-label={`Asistencia de ${a.nombre}`} className="flex gap-1 rounded-lg bg-hundida p-1">
                    {(
                      [
                        ["asistio", "Vino"],
                        ["ausente", "No vino"],
                      ] as const
                    ).map(([valor, texto]) => (
                      <form key={valor} action={marcar}>
                        <input type="hidden" name="id" value={a.id} />
                        <input type="hidden" name="estado" value={valor} />
                        <button
                          type="submit"
                          aria-pressed={a.estado === valor}
                          className={`inline-flex h-9 items-center rounded-md px-3 text-base font-medium transition-colors ${
                            a.estado === valor ? "bg-card text-foreground shadow-sm" : "text-texto-2 hover:text-foreground"
                          }`}
                        >
                          {texto}
                        </button>
                      </form>
                    ))}
                  </div>
                ) : (
                  estado && (
                    <span className={`rounded-full px-2.5 py-1 text-sm font-medium ${estado.clase}`}>
                      {estado.texto}
                    </span>
                  )
                )}
              </li>
            );
          })}
        </ul>
      )}
      {resultado.error && (
        <p role="alert" className="px-5 pb-3 text-base text-destructive">
          {resultado.error}
        </p>
      )}
    </div>
  );
}
