"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban } from "lucide-react";
import { toast } from "sonner";
import { Confirmar } from "@/components/admin/confirmar";
import { darDeBajaProveedor } from "../actions";

/**
 * Dar de baja al proveedor, al pie de «Editar la ficha» y en rojo, como en
 * clientes (M2S1-038, M3S3-007): la acción existía y ninguna pantalla la
 * llamaba, así que un proveedor cargado por error quedaba para siempre en
 * los selectores de orden, factura, gasto y pago. No se borra: queda
 * inactivo, con su cuenta.
 */
export function BajaDelProveedor({ id, nombre }: { id: string; nombre: string }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [enCurso, empezar] = useTransition();
  return (
    <div className="mt-6 border-t border-linea pt-4">
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="inline-flex h-11 items-center gap-2 rounded-lg px-3 text-base font-medium text-saldo-debe hover:bg-hundida"
      >
        <Ban className="h-4 w-4" aria-hidden="true" />
        Dar de baja
      </button>
      <Confirmar
        abierto={abierto}
        alCerrar={() => setAbierto(false)}
        titulo={`Dar de baja a ${nombre}`}
        detalle="Sale de los selectores de órdenes, facturas, gastos y pagos. Su cuenta queda como está."
        confirmar="Dar de baja"
        cancelar="Volver"
        peligro
        pendiente={enCurso}
        alConfirmar={() =>
          empezar(async () => {
            const r = await darDeBajaProveedor(id);
            setAbierto(false);
            if (r.error) toast.error(r.error);
            else {
              toast.success(r.ok ?? "Dado de baja.");
              router.refresh();
            }
          })
        }
      />
    </div>
  );
}
