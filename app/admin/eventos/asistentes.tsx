"use client";

import { useActionState, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { marcarAsistencia, type EstadoEvento } from "./actions";
import { fechaCorta } from "@/lib/formato";
import type { Asistente } from "@/lib/dal/admin/eventos";

const inicial: EstadoEvento = {};

const ESTADOS: Record<string, { texto: string; clase: string }> = {
  reservada: { texto: "Sin pagar", clase: "bg-amber-100 text-amber-900" },
  confirmada: { texto: "Confirmado", clase: "bg-green-100 text-green-900" },
  asistio: { texto: "Vino", clase: "bg-green-100 text-green-900" },
  ausente: { texto: "No vino", clase: "bg-muted text-muted-foreground" },
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
 */
export function Asistentes({ asistentes }: { asistentes: Asistente[] }) {
  const [abierto, setAbierto] = useState(false);
  const [, marcar] = useActionState(marcarAsistencia, inicial);

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
            const estado = ESTADOS[a.estado] ?? {
              texto: a.estado,
              clase: "bg-muted text-muted-foreground",
            };

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

                <span
                  className={`rounded-full px-2.5 py-1 text-sm font-medium ${estado.clase}`}
                >
                  {estado.texto}
                </span>

                {a.estado !== "cancelada" && (
                  <div className="flex gap-2">
                    <form action={marcar}>
                      <input type="hidden" name="id" value={a.id} />
                      <input type="hidden" name="estado" value="asistio" />
                      <button
                        type="submit"
                        className="inline-flex h-9 items-center rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted"
                      >
                        Vino
                      </button>
                    </form>
                    <form action={marcar}>
                      <input type="hidden" name="id" value={a.id} />
                      <input type="hidden" name="estado" value="ausente" />
                      <button
                        type="submit"
                        className="inline-flex h-9 items-center rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted"
                      >
                        No vino
                      </button>
                    </form>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
