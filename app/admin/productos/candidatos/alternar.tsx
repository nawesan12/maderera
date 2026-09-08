"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { alternarActivo } from "../actions";

/**
 * Dar de baja un candidato.
 *
 * Reusa `alternarActivo`, que es la misma acción del listado de productos: deja
 * registro en la bitácora y refresca el catálogo público. No hace falta una
 * acción propia para hacer exactamente lo mismo desde otra pantalla.
 */
export function AlternarBaja({ id, nombre }: { id: string; nombre: string }) {
  const [pendiente, empezar] = useTransition();
  const router = useRouter();

  return (
    <button
      type="button"
      disabled={pendiente}
      onClick={() =>
        empezar(async () => {
          await alternarActivo(id, false);
          // La lista se arma en el servidor: sin esto el producto que se acaba
          // de dar de baja sigue en pantalla como si nada hubiera pasado.
          router.refresh();
        })
      }
      aria-label={`Dar de baja ${nombre}`}
      className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-base transition-colors hover:bg-muted hover:text-destructive disabled:opacity-60"
    >
      {pendiente && <Loader2 className="h-4 w-4 animate-spin" />}
      Dar de baja
    </button>
  );
}
