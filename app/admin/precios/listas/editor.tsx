"use client";

import { useActionState, useId } from "react";
import { Loader2 } from "lucide-react";
import { ajustarPorcentajeDeLista, type EstadoLista } from "./actions";

const inicial: EstadoLista = {};

export function EditorDeLista({
  lista,
}: {
  lista: {
    id: string;
    nombre: string;
    /** "-5.00" o null. Null es "no derivada": solo ítems propios y general. */
    porcentaje: string | null;
    /** Cuántos ítems propios tiene cargados, que pisan al derivado. */
    itemsPropios: number;
  };
}) {
  const [estado, guardar, guardando] = useActionState(
    ajustarPorcentajeDeLista,
    inicial,
  );
  const id = useId();

  return (
    <form
      action={guardar}
      className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-5"
    >
      <input type="hidden" name="id" value={lista.id} />

      <div className="min-w-[180px] flex-1">
        <p className="text-base font-semibold">{lista.nombre}</p>
        <p className="text-sm text-muted-foreground">
          {lista.itemsPropios > 0
            ? `${lista.itemsPropios} precios propios cargados, que pisan al porcentaje`
            : "Sin precios propios: todo sale del porcentaje sobre la general"}
        </p>
      </div>

      <div>
        <label htmlFor={`${id}-pct`} className="block text-base font-medium">
          % sobre la general
        </label>
        <input
          id={`${id}-pct`}
          name="porcentaje"
          defaultValue={
            lista.porcentaje === null ? "" : String(Number(lista.porcentaje))
          }
          placeholder="−5"
          inputMode="decimal"
          className="tabular mt-1 h-10 w-28 rounded-lg border bg-background px-3 text-right text-base"
        />
      </div>

      <button
        type="submit"
        disabled={guardando}
        className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-orange px-4 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
      >
        {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
        Guardar
      </button>

      {estado.error && (
        <p className="w-full text-base text-destructive">{estado.error}</p>
      )}
      {estado.ok && (
        <p className="w-full text-base text-muted-foreground">{estado.ok}</p>
      )}
    </form>
  );
}
