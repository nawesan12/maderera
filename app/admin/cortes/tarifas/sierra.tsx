"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { guardarSierra, type EstadoTarifa } from "./actions";

const inicial: EstadoTarifa = {};

export function EditorDeSierra({ anchoSierraMm }: { anchoSierraMm: number }) {
  const [estado, guardar, guardando] = useActionState(guardarSierra, inicial);

  return (
    <form action={guardar} className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-5">
      <div>
        <label htmlFor="ancho-sierra" className="block text-base font-medium">
          Ancho de sierra (mm)
        </label>
        <input
          id="ancho-sierra"
          name="anchoSierraMm"
          inputMode="decimal"
          required
          defaultValue={String(anchoSierraMm).replace(".", ",")}
          className="tabular mt-1 h-10 w-32 rounded-lg border bg-background px-3 text-base"
        />
      </div>
      <button
        type="submit"
        disabled={guardando}
        className="inline-flex h-10 items-center gap-2 rounded-lg border px-4 text-base font-medium transition-colors hover:bg-muted disabled:opacity-60"
      >
        {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
        Guardar
      </button>
      {estado.error && <p className="w-full text-base text-destructive">{estado.error}</p>}
      {estado.ok && <p className="w-full text-base text-muted-foreground">{estado.ok}</p>}
    </form>
  );
}
