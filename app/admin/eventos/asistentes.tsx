"use client";

import { startTransition, useActionState, useState } from "react";
import { Check, ChevronDown, ChevronRight, UserMinus } from "lucide-react";
import { Confirmar } from "@/components/admin/confirmar";
import { marcarAsistencia, type EstadoEvento } from "./actions";
import { fechaCorta, telefonoLegible } from "@/lib/formato";
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
  // Quitar a alguien libera su lugar, y un evento de prueba con un anotado
  // quedaba en borrador para siempre: sin nadie, se borra (M4-059).
  const [quitando, setQuitando] = useState<Asistente | null>(null);

  if (asistentes.length === 0) {
    return (
      <p className="px-5 py-4 text-base text-muted-foreground">
        Todavía no se anotó nadie.
      </p>
    );
  }

  const anotados = asistentes.filter((a) => a.estado !== "cancelada").length;

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
        {/* Sin las canceladas, como el cupo: tras quitar al único decía
            «0 de 4» arriba y «1 anotado» acá (recorrido 2). */}
        {anotados} anotado{anotados === 1 ? "" : "s"}
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
                    {a.telefono ? ` · ${telefonoLegible(a.telefono)}` : ""}
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
                        {/* La elegida en el color de acción y con tilde: con
                            un relieve apenas más claro no se leía (M4-075). */}
                        <button
                          type="submit"
                          aria-pressed={a.estado === valor}
                          className={`inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-base font-medium transition-colors ${
                            a.estado === valor ? "bg-accion text-white shadow-sm" : "text-texto-2 hover:text-foreground"
                          }`}
                        >
                          {a.estado === valor && <Check className="h-4 w-4" aria-hidden />}
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
                {a.estado !== "cancelada" && (
                  <button
                    type="button"
                    onClick={() => setQuitando(a)}
                    aria-label={`Quitar a ${a.nombre}`}
                    className="flex h-10 w-10 items-center justify-center rounded-lg border border-linea text-muted-foreground transition-colors hover:text-destructive"
                  >
                    <UserMinus className="h-4 w-4" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Confirmar
        abierto={quitando !== null}
        alCerrar={() => setQuitando(null)}
        titulo={quitando ? `Quitar a ${quitando.nombre}` : "Quitar"}
        detalle="Libera su lugar. Si pagó, la devolución va aparte."
        confirmar="Quitar"
        peligro
        alConfirmar={() => {
          const a = quitando;
          setQuitando(null);
          if (!a) return;
          const datos = new FormData();
          datos.set("id", a.id);
          datos.set("estado", "cancelada");
          startTransition(() => marcar(datos));
        }}
      />
      {resultado.error && (
        <p role="alert" className="px-5 pb-3 text-base text-destructive">
          {resultado.error}
        </p>
      )}
    </div>
  );
}
