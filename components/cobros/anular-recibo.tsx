"use client";

import { useActionState, useState } from "react";
import { Loader2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { anularRecibo, type EstadoCobro } from "@/app/admin/cobros-actions";

const inicial: EstadoCobro = {};

/**
 * «Anular» un recibo vivo, con motivo obligatorio. Lo muestra la ficha a
 * quien maneja plata (MANEJAN_PLATA). Si Go lo frena —plata ya devuelta con
 * una devolución, un cheque que salió de la cartera— el motivo queda a la
 * vista, pegado al recibo.
 */
export function AnularRecibo({ id, numero }: { id: string; numero: string }) {
  const [abierto, setAbierto] = useState(false);
  const [estado, accion, pendiente] = useActionState(async (previo: EstadoCobro, datos: FormData) => {
    const r = await anularRecibo(previo, datos);
    if (r.ok) {
      toast.success(r.ok);
      setAbierto(false);
    }
    return r;
  }, inicial);

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        aria-label={`Anular el recibo ${numero}`}
        className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-destructive"
      >
        <Undo2 className="h-3.5 w-3.5" />
        Anular
      </button>
    );
  }

  return (
    <form action={accion} className="mt-1.5 flex w-full flex-wrap items-center gap-2">
      <input type="hidden" name="receiptId" value={id} />
      <input
        name="motivo"
        required
        maxLength={300}
        autoFocus
        aria-label={`Motivo para anular el recibo ${numero}`}
        placeholder="Motivo"
        className="h-10 min-w-0 flex-1 rounded-lg bg-hundida px-3 text-base"
      />
      <button
        type="submit"
        disabled={pendiente}
        className="inline-flex h-10 items-center gap-2 rounded-lg bg-red-700 px-4 text-base font-medium text-white transition-colors hover:bg-red-800 disabled:opacity-60"
      >
        {pendiente && <Loader2 className="h-5 w-5 animate-spin" />}
        Anular el recibo
      </button>
      <button
        type="button"
        onClick={() => setAbierto(false)}
        className="inline-flex h-10 items-center rounded-lg px-3 text-base font-medium transition-colors hover:bg-muted"
      >
        Cancelar
      </button>
      {estado.error && (
        <p role="alert" className="w-full text-base text-red-700">
          {estado.error}
        </p>
      )}
    </form>
  );
}
