"use client";

import { useTransition } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { invitarAlPortal } from "../actions";

/**
 * «Invitar al portal»: a un cliente cargado en el panel le abre la cuenta
 * web con el correo de la ficha y le manda el link de activación
 * (M2S1-097). Solo era posible si se registraba solo con el mismo correo.
 */
export function InvitarAlPortal({ customerId }: { customerId: string }) {
  const [pendiente, empezar] = useTransition();
  return (
    <button
      type="button"
      disabled={pendiente}
      onClick={() =>
        empezar(async () => {
          const r = await invitarAlPortal(customerId);
          if (r.ok) toast.success(r.ok);
          else toast.error(r.error ?? "No se pudo mandar la invitación.");
        })
      }
      className="-my-1.5 inline-flex min-h-9 items-center gap-1.5 rounded-md px-1.5 text-base font-medium text-acento-texto transition-colors hover:bg-hundida disabled:opacity-60"
    >
      {pendiente ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" aria-hidden="true" />}
      Invitar al portal
    </button>
  );
}
