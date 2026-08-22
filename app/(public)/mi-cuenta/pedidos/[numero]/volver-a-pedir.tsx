"use client";

import { useActionState } from "react";
import Link from "next/link";
import { AlertCircle, Check, Loader2, RotateCcw } from "lucide-react";
import { repetirPedido, type EstadoAccion } from "../../actions";

const estadoInicial: EstadoAccion = {};

/** Carga en el presupuesto lo mismo que tenía este pedido. */
export function VolverAPedir({ numero }: { numero: string }) {
  const [estado, accion, pendiente] = useActionState(
    repetirPedido,
    estadoInicial,
  );

  if (estado.ok) {
    return (
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-green-50 px-3.5 py-2.5 text-sm text-green-900">
        <Check className="h-4 w-4 shrink-0" />
        {estado.ok}
        <Link
          href="/presupuesto"
          className="font-medium underline underline-offset-2"
        >
          Ver el presupuesto
        </Link>
      </p>
    );
  }

  return (
    <form action={accion}>
      <input type="hidden" name="numero" value={numero} />
      <button
        type="submit"
        disabled={pendiente}
        className="inline-flex h-11 items-center gap-2 rounded-lg border bg-white px-4 font-medium transition-colors hover:bg-muted disabled:opacity-60"
      >
        {pendiente ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <RotateCcw className="h-4 w-4" />
        )}
        Volver a pedir lo mismo
      </button>

      {estado.error && (
        <p
          role="alert"
          className="mt-2 flex items-center gap-2 text-sm text-brand-red"
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          {estado.error}
        </p>
      )}
    </form>
  );
}
