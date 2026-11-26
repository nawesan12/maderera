"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, PackageCheck, Printer } from "lucide-react";
import { recibirTraslado } from "../../actions";

/**
 * Imprimir el comprobante y, en destino, recibir. «Recibir» es la acción
 * principal mientras el traslado está en camino: es lo que suma el stock.
 */
export function AccionesDelTraslado({ id, enCamino, destino }: { id: string; enCamino: boolean; destino: string }) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();

  function recibir() {
    startTransition(async () => {
      const r = await recibirTraslado(id);
      // Con error también se refresca: si lo recibió otra pestaña o el
      // celular, la pantalla pasa a «Recibido» y el aviso dice por qué
      // (mes simulado: la segunda pestaña no mostraba nada).
      if (r.error) toast.error(r.error);
      else toast.success(`Recibido en ${destino}`);
      router.refresh();
    });
  }

  return (
    <div className="no-imprimir">
      <div className="flex flex-wrap gap-2">
        {enCamino && (
          <button
            type="button"
            onClick={recibir}
            disabled={pendiente}
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-accion px-4 text-base font-medium text-white hover:bg-brand-orange-dark disabled:opacity-50"
          >
            {pendiente ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <PackageCheck className="h-4 w-4" aria-hidden="true" />
            )}
            Recibir en {destino}
          </button>
        )}
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex h-11 items-center gap-2 rounded-lg border px-4 text-base font-medium hover:bg-muted"
        >
          <Printer className="h-4 w-4" aria-hidden="true" />
          Imprimir
        </button>
      </div>
    </div>
  );
}
