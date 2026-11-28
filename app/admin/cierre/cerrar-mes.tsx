"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Loader2, Lock, LockOpen } from "lucide-react";
import { cerrarElMes, type EstadoDelCierre } from "./actions";

/**
 * Cerrar el mes, la acción para la que existe la pantalla (H408): va en la
 * cabecera, al lado de lo que se le manda al estudio. Cerrado, queda el
 * estado y la forma de reabrirlo, en segundo plano.
 *
 * Las dos acciones piden un segundo paso (mes simulado, M2S1-056): cerrar
 * traba las fechas del mes y dice cuántos avisos quedan; reabrir cambia lo
 * que el estudio ya tiene y pide por qué, que queda en la bitácora.
 */
export function CerrarMes({
  periodo,
  nombre,
  cerrado,
  cuando,
  terminado,
  pendientes,
}: {
  periodo: string;
  /** «noviembre». */
  nombre: string;
  cerrado: boolean;
  /** «26/11 · Ana», si está cerrado. */
  cuando: string | null;
  /** Un mes que no terminó no se cierra. */
  terminado: boolean;
  /** Los avisos de «Antes de cerrar» que quedan. */
  pendientes: number;
}) {
  const [estado, accion, pendiente] = useActionState<EstadoDelCierre, FormData>(cerrarElMes, {});
  const [confirmando, setConfirmando] = useState(false);
  const motivo = useRef<HTMLInputElement>(null);

  // Al terminar bien, vuelve al botón de siempre (el estado se ajusta en el
  // render, no en un efecto).
  const [visto, setVisto] = useState(estado);
  if (estado !== visto) {
    setVisto(estado);
    if (!estado.error) setConfirmando(false);
  }
  useEffect(() => {
    if (confirmando && cerrado) motivo.current?.focus();
  }, [confirmando, cerrado]);

  if (!cerrado && !terminado) return null;

  const secundario =
    "inline-flex h-11 items-center gap-1.5 rounded-lg border border-linea px-3.5 text-base font-medium hover:bg-hundida disabled:opacity-60";

  return (
    <form action={accion} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="periodo" value={periodo} />
      <input type="hidden" name="cerrado" value={cerrado ? "no" : "si"} />
      {cerrado && (
        <span className="estado-ok inline-flex h-11 items-center gap-1.5 rounded-lg bg-[var(--estado-fondo)] px-3.5 text-base font-medium text-[var(--estado-tinta)]">
          <Lock className="h-4 w-4" aria-hidden />
          Cerrado{cuando ? ` · ${cuando}` : ""}
        </span>
      )}
      {!confirmando ? (
        <button
          type="button"
          onClick={() => setConfirmando(true)}
          className={cerrado ? secundario : "boton-accion inline-flex h-11 items-center gap-1.5 rounded-lg px-4 text-base font-medium"}
        >
          {cerrado ? <LockOpen className="h-4 w-4" aria-hidden /> : <Lock className="h-4 w-4" aria-hidden />}
          {cerrado ? "Reabrir" : `Cerrar ${nombre}`}
        </button>
      ) : (
        <>
          {cerrado && (
            <label className="min-w-0 flex-1 basis-56">
              <span className="sr-only">Motivo</span>
              <input
                ref={motivo}
                name="motivo"
                required
                maxLength={300}
                placeholder="Motivo"
                className="h-11 w-full rounded-lg bg-hundida px-3 text-base"
              />
            </label>
          )}
          <button
            type="submit"
            disabled={pendiente}
            className="boton-accion inline-flex h-11 items-center gap-1.5 rounded-lg px-4 text-base font-medium disabled:opacity-60"
          >
            {pendiente ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : cerrado ? (
              <LockOpen className="h-4 w-4" aria-hidden />
            ) : (
              <Lock className="h-4 w-4" aria-hidden />
            )}
            {cerrado
              ? `Reabrir ${nombre}`
              : pendientes > 0
                ? `Cerrar con ${pendientes === 1 ? "1 aviso" : `${pendientes} avisos`}`
                : `Cerrar ${nombre}`}
          </button>
          <button type="button" onClick={() => setConfirmando(false)} disabled={pendiente} className={secundario}>
            Cancelar
          </button>
        </>
      )}
      {estado.error && (
        <p role="alert" className="estado-problema w-full text-base text-[var(--estado-tinta)]">
          {estado.error}
        </p>
      )}
    </form>
  );
}
