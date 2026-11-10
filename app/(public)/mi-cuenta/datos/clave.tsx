"use client";

import { useActionState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { cambiarClave, type EstadoAccion } from "../actions";

/**
 * La clave, en Mis datos (revisión del 10/11/2026: la cuenta que creó la
 * aprobación no tenía cómo ponerse clave, y quien la olvidaba entraba con el
 * link pero no podía cambiarla). La actual se pide solo cuando Go la exige.
 */
export function Clave({ tieneClave, sinLaActual }: { tieneClave: boolean; sinLaActual: boolean }) {
  const [estado, accion, guardando] = useActionState<EstadoAccion, FormData>(cambiarClave, {});
  return (
    <section id="clave" className="superficie scroll-mt-24 rounded-2xl p-5">
      <h2 className="flex items-center gap-2 text-lg font-bold">
        <KeyRound className="h-5 w-5 text-acento-texto" />
        {tieneClave ? "Cambiar la clave" : "Poné una clave"}
      </h2>
      <form action={accion} className="mt-4 grid gap-3 sm:grid-cols-2">
        {tieneClave && !sinLaActual && (
          <Campo nombre="actual" etiqueta="Clave actual" autoComplete="current-password" ancho />
        )}
        <Campo nombre="nueva" etiqueta="Clave nueva" autoComplete="new-password" />
        <Campo nombre="repetida" etiqueta="Otra vez" autoComplete="new-password" />
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <button
            type="submit"
            disabled={guardando}
            className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-accion px-5 font-semibold text-white disabled:opacity-60"
          >
            {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
            Guardar la clave
          </button>
          {estado.error && <p className="text-sm text-destructive">{estado.error}</p>}
          {estado.ok && <p className="text-sm text-brand-green">{estado.ok}</p>}
        </div>
      </form>
    </section>
  );
}

function Campo({ nombre, etiqueta, autoComplete, ancho }: { nombre: string; etiqueta: string; autoComplete: string; ancho?: boolean }) {
  return (
    <label className={`block ${ancho ? "sm:col-span-2" : ""}`}>
      <span className="text-sm font-medium">{etiqueta}</span>
      <input
        type="password"
        name={nombre}
        required
        minLength={nombre === "actual" ? 1 : 8}
        autoComplete={autoComplete}
        className="mt-1 h-12 w-full rounded-[10px] border border-linea bg-background px-3 text-base"
      />
    </label>
  );
}
