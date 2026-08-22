"use client";

import { useActionState, useEffect } from "react";
import { AlertCircle, Loader2, X } from "lucide-react";
import { abrirConversacion, type EstadoWhatsapp } from "./actions";

const estadoInicial: EstadoWhatsapp = {};

/** Abre una conversación con un número que todavía no escribió. */
export function NuevaConversacion({ onCerrar }: { onCerrar: () => void }) {
  const [estado, accion, pendiente] = useActionState(
    abrirConversacion,
    estadoInicial,
  );

  useEffect(() => {
    if (estado.ok) onCerrar();
  }, [estado.ok, onCerrar]);

  return (
    <form action={accion} className="space-y-2 border-b bg-muted/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor="telefono-nuevo" className="text-base font-medium">
          Escribirle a un número
        </label>
        <button
          type="button"
          onClick={onCerrar}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Cancelar"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex gap-2">
        <input
          id="telefono-nuevo"
          name="telefono"
          required
          inputMode="tel"
          placeholder="223 590-3118"
          className="h-10 min-w-0 flex-1 rounded-lg border bg-background px-2.5 text-base"
        />
        <button
          type="submit"
          disabled={pendiente}
          className="inline-flex h-10 shrink-0 items-center rounded-lg bg-brand-orange px-3 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
        >
          {pendiente ? <Loader2 className="h-5 w-5 animate-spin" /> : "Abrir"}
        </button>
      </div>

      <p className="text-sm text-muted-foreground">
        Con código de área, sin el 0 ni el 15.
      </p>

      {estado.error && (
        <p
          role="alert"
          className="flex items-start gap-2 text-base text-red-700"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {estado.error}
        </p>
      )}
    </form>
  );
}
