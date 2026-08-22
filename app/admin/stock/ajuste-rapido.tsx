"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Minus, Plus } from "lucide-react";
import { ajustarStock } from "./ajuste-actions";

/**
 * Suma o resta stock sin salir del listado.
 *
 * Llegó mercadería o se rompió una placa: son correcciones de todos los días.
 * Obligar a abrir la ficha del producto para cambiar un número es lo que hace
 * que el inventario del sistema se despegue del real.
 */
export function AjusteRapido({
  variantId,
  branchSlug,
  sucursal,
}: {
  variantId: string;
  branchSlug: string;
  sucursal: string;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();

  function ajustar(cantidad: number) {
    startTransition(async () => {
      const resultado = await ajustarStock(variantId, branchSlug, cantidad);
      if (resultado.error) toast.error(resultado.error);
      else {
        if (resultado.ok) toast.success(resultado.ok);
        router.refresh();
      }
    });
  }

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => ajustar(-1)}
        disabled={pendiente}
        className="flex h-9 w-9 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
        aria-label={`Restar uno en ${sucursal}`}
      >
        <Minus className="h-4 w-4" />
      </button>
      <button
        onClick={() => ajustar(1)}
        disabled={pendiente}
        className="flex h-9 w-9 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
        aria-label={`Sumar uno en ${sucursal}`}
      >
        {pendiente ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Plus className="h-4 w-4" />
        )}
      </button>
    </div>
  );
}
