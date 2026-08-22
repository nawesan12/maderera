"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { avanzarPedido, marcarPagado } from "@/app/admin/ventas-actions";

const SIGUIENTE: Record<string, string> = {
  pendiente: "Preparar",
  preparando: "Marcar listo",
  listo: "Despachar",
  "en-camino": "Marcar entregado",
};

export function AccionesPedido({
  id,
  estado,
  estadoPago,
  tipoEntrega,
  compacto = false,
}: {
  id: string;
  estado: string;
  estadoPago: string;
  tipoEntrega: string;
  /** En una tarjeta de tablero los botones ocupan el ancho disponible. */
  compacto?: boolean;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();

  // Un pedido de retiro no se despacha: el cliente lo busca.
  const etiqueta =
    estado === "listo" && tipoEntrega === "retiro"
      ? "Marcar entregado"
      : SIGUIENTE[estado];

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

  return (
    <div className={`flex items-center gap-2 ${compacto ? "w-full" : ""}`}>
      {estadoPago !== "pagado" && estado !== "cancelado" && (
        <button
          onClick={() => accion(() => marcarPagado(id))}
          disabled={pendiente}
          className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted disabled:opacity-50 ${compacto ? "flex-1 basis-0" : ""}`}
        >
          <Check className="h-5 w-5" />
          Cobrar
        </button>
      )}

      {etiqueta && (
        <button
          onClick={() => accion(() => avanzarPedido(id))}
          disabled={pendiente}
          className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-lg boton-accion px-3 text-base font-medium transition-colors disabled:opacity-50 ${compacto ? "flex-1 basis-0" : ""}`}
        >
          {pendiente ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <ArrowRight className="h-5 w-5" />
          )}
          {etiqueta}
        </button>
      )}
    </div>
  );
}
