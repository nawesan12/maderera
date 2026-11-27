"use client";

import { useActionState } from "react";
import { Check, Loader2 } from "lucide-react";
import { guardarAjuste, type EstadoContenido } from "./actions";
import type { listarAjustes } from "@/lib/dal/admin/contenido";

type SiteSetting = Awaited<ReturnType<typeof listarAjustes>>[number];

const inicial: EstadoContenido = {};

export function Ajustes({ ajustes }: { ajustes: SiteSetting[] }) {
  return (
    <div className="space-y-5">
      {ajustes.map((a) => (
        <FilaAjuste key={a.clave} ajuste={a} />
      ))}
    </div>
  );
}

/**
 * Un texto con su propio «Guardado» al lado del botón. Con un solo estado para
 * toda la lista, la confirmación salía al pie, lejos de lo que se tocó, y
 * guardar parecía no hacer nada (mes simulado, M2S2-089).
 */
function FilaAjuste({ ajuste: a }: { ajuste: SiteSetting }) {
  const [estado, guardar, guardando] = useActionState(guardarAjuste, inicial);

  return (
    <form action={guardar} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="clave" value={a.clave} />

      <div className="min-w-0 flex-[1_1_16rem]">
        <label htmlFor={`ajuste-${a.clave}`} className="block text-base font-medium">
          {a.descripcion ?? a.clave.charAt(0).toUpperCase() + a.clave.slice(1).replace(/[-_.]/g, " ")}
        </label>
        <input
          id={`ajuste-${a.clave}`}
          name="valor"
          defaultValue={a.valor}
          // El número de WhatsApp con el teclado de teléfono.
          inputMode={a.clave.startsWith("whatsapp") ? "tel" : undefined}
          aria-invalid={estado.error ? true : undefined}
          aria-describedby={estado.error ? `ajuste-${a.clave}-error` : undefined}
          className="mt-1 h-10 w-full rounded-lg border bg-background px-3 text-base"
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

      {estado.ok && !guardando && (
        <p role="status" className="flex h-10 items-center gap-1.5 text-base text-muted-foreground">
          <Check className="h-4 w-4 text-brand-green" />
          Guardado
        </p>
      )}
      {estado.error && (
        <p id={`ajuste-${a.clave}-error`} role="alert" className="basis-full text-base text-destructive">
          {estado.error}
        </p>
      )}
    </form>
  );
}
