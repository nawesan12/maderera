"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Link2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { unirAFicha } from "@/app/admin/ventas-actions";

/**
 * Un pedido o presupuesto sin cliente cuyo correo es el de una ficha: la
 * tienda ya no lo ata sola sin la sesión de ese correo (cualquiera que lo
 * supiera le metía pedidos en el historial). Acá lo une una persona.
 *
 * Con recibos o comprobantes ya emitidos sin cliente no se une (Go lo
 * rechaza igual): queda el enlace a la ficha para verla.
 */
export function UnirAFicha({
  que,
  id,
  ficha,
}: {
  que: "pedido" | "presupuesto";
  id: string;
  ficha: { id: string; nombre: string; unible: boolean };
}) {
  const router = useRouter();
  const [pendiente, empezar] = useTransition();

  function unir() {
    empezar(async () => {
      const r = await unirAFicha(que, id, ficha.id);
      if (r.error) {
        toast.error(r.error);
        return;
      }
      toast.success(r.ok ?? "Unido.");
      router.refresh();
    });
  }

  return (
    <div className="estado-espera mt-3 flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-base">
      <Link href={`/admin/clientes/${ficha.id}`} className="font-medium hover:text-brand-orange">
        {ficha.nombre}
      </Link>
      {ficha.unible && (
        <button
          type="button"
          onClick={unir}
          disabled={pendiente}
          className="boton-accion ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold disabled:opacity-50"
        >
          {pendiente ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
          Unir a su ficha
        </button>
      )}
    </div>
  );
}
