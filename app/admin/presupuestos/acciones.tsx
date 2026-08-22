"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Loader2, ShoppingCart, X } from "lucide-react";
import {
  cambiarEstadoPresupuesto,
  convertirEnPedido,
} from "@/app/admin/ventas-actions";

export function AccionesPresupuesto({
  id,
  estado,
}: {
  id: string;
  estado: string;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();

  function accion(fn: () => Promise<{ ok?: string; error?: string }>) {
    startTransition(async () => {
      const resultado = await fn();
      if (resultado.error) toast.error(resultado.error);
      else {
        toast.success(resultado.ok ?? "Listo.");
        router.refresh();
      }
    });
  }

  const decidible = ["pendiente", "revision", "enviado"].includes(estado);

  return (
    <div className="flex items-center gap-2">
      {decidible && (
        <>
          <button
            onClick={() => accion(() => cambiarEstadoPresupuesto(id, "rechazado"))}
            disabled={pendiente}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-base font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <X className="h-5 w-5" />
            Rechazar
          </button>
          <button
            onClick={() => accion(() => cambiarEstadoPresupuesto(id, "aceptado"))}
            disabled={pendiente}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted disabled:opacity-50"
          >
            {pendiente ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Check className="h-5 w-5" />
            )}
            Aceptar
          </button>
        </>
      )}

      {estado === "aceptado" && (
        <button
          onClick={() => accion(() => convertirEnPedido(id))}
          disabled={pendiente}
          className="inline-flex h-10 items-center gap-1.5 rounded-lg boton-accion px-3 text-base font-medium transition-colors disabled:opacity-50"
        >
          {pendiente ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <ShoppingCart className="h-5 w-5" />
          )}
          Pasar a pedido
        </button>
      )}
    </div>
  );
}
