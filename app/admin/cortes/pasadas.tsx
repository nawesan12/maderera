"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { cargarPasadas } from "./actions";

/**
 * El número de pasadas, que es lo que hace cobrable el trabajo.
 *
 * **Ahora llega con una propuesta.** El plano de la plataforma acomoda las
 * piezas y cuenta los cortes, así que el campo ya no arranca vacío: propone un
 * número y quien opera lo confirma o lo corrige contra lo que dijo la máquina.
 * Sigue siendo el operario el que decide —el patrón real lo arma el optimizador
 * del taller— pero deja de tener que tipearlo de memoria, que era lo que hacía
 * imposible presupuestar un corte en el mostrador.
 *
 * Se proponen las **cobrables**: las de las placas que no se venden enteras.
 */
export function CargarPasadas({
  id,
  actuales,
  sugeridas,
}: {
  id: string;
  actuales: number;
  /** Lo que calculó el plano. Cero significa que no hay nada que cobrar. */
  sugeridas?: number;
}) {
  const [valor, setValor] = useState(String(actuales || ""));
  const [pendiente, empezar] = useTransition();
  const [aviso, setAviso] = useState<string | null>(null);

  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        empezar(async () => {
          const r = await cargarPasadas(id, Number(valor));
          setAviso(r.error ?? r.ok ?? null);
        });
      }}
    >
      <div>
        <label
          htmlFor={`pasadas-${id}`}
          className="mb-1 block text-sm font-medium text-muted-foreground"
        >
          Pasadas de sierra
        </label>
        <input
          id={`pasadas-${id}`}
          type="number"
          min={0}
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          className="h-11 w-28 rounded-lg border bg-background px-3 text-base"
        />
      </div>

      <button
        type="submit"
        disabled={pendiente}
        className="inline-flex h-11 items-center gap-2 rounded-lg border px-3.5 text-base font-medium transition-colors hover:bg-muted disabled:opacity-60"
      >
        {pendiente && <Loader2 className="h-4 w-4 animate-spin" />}
        Guardar
      </button>

      {sugeridas !== undefined && sugeridas > 0 && sugeridas !== actuales && (
        <button
          type="button"
          onClick={() => setValor(String(sugeridas))}
          className="inline-flex h-11 items-center rounded-lg border border-dashed px-3.5 text-base text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          El plano dice {sugeridas} · usar ese número
        </button>
      )}

      {aviso && (
        <p className="w-full text-base text-muted-foreground">{aviso}</p>
      )}
    </form>
  );
}
