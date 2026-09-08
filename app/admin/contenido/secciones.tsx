"use client";

import { useActionState } from "react";
import { Check } from "lucide-react";
import { guardarAjuste, type EstadoContenido } from "./actions";
import type { SiteSetting } from "@/lib/db/schema";

const inicial: EstadoContenido = {};

export function Ajustes({ ajustes }: { ajustes: SiteSetting[] }) {
  const [estado, guardar, guardando] = useActionState(guardarAjuste, inicial);

  return (
    <div className="space-y-4">
      {ajustes.map((a) => (
        <form key={a.clave} action={guardar} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="clave" value={a.clave} />

          <div className="min-w-[16rem] flex-1">
            <label htmlFor={`ajuste-${a.clave}`} className="block text-base font-medium">
              {a.descripcion ?? a.clave}
            </label>
            <input
              id={`ajuste-${a.clave}`}
              name="valor"
              defaultValue={a.valor}
              className="mt-1 h-10 w-full rounded-lg border bg-background px-3 text-base"
            />
          </div>

          <button
            type="submit"
            disabled={guardando}
            className="inline-flex h-10 items-center rounded-lg border px-4 text-base font-medium transition-colors hover:bg-muted disabled:opacity-60"
          >
            Guardar
          </button>
        </form>
      ))}

      {estado.ok && (
        <p className="flex items-center gap-2 text-base text-muted-foreground">
          <Check className="h-4 w-4 text-brand-green" />
          {estado.ok}
        </p>
      )}
      {estado.error && (
        <p className="text-base text-destructive">{estado.error}</p>
      )}
    </div>
  );
}
