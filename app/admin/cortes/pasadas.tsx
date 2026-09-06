"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { cargarPasadas } from "./actions";

/**
 * El número de pasadas, que es lo que hace cobrable el trabajo.
 *
 * Se carga después de optimizar en la máquina: el patrón de corte lo arma el
 * programa de la seccionadora y es el que dice cuántas pasadas salieron. Por
 * eso el campo está acá y no se calcula: la plataforma no puede saberlo.
 */
export function CargarPasadas({
  id,
  actuales,
}: {
  id: string;
  actuales: number;
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
          className="h-10 w-28 rounded-lg border bg-background px-3 text-base"
        />
      </div>

      <button
        type="submit"
        disabled={pendiente}
        className="inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 text-base font-medium transition-colors hover:bg-muted disabled:opacity-60"
      >
        {pendiente && <Loader2 className="h-4 w-4 animate-spin" />}
        Guardar
      </button>

      {aviso && (
        <p className="w-full text-base text-muted-foreground">{aviso}</p>
      )}
    </form>
  );
}
