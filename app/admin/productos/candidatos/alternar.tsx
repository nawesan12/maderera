"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Confirmar } from "@/components/admin/confirmar";
import { alternarActivo } from "../actions";

/**
 * Dar de baja un candidato.
 *
 * Reusa `alternarActivo`, que es la misma acción del listado de productos: deja
 * registro en la bitácora y refresca el catálogo público. No hace falta una
 * acción propia para hacer exactamente lo mismo desde otra pantalla.
 *
 * **Pregunta antes, y avisa después.** Esto saca el producto del sitio en vivo,
 * y era un botón de un clic que hacía desaparecer la fila sin decir una
 * palabra: no se distinguía "se dio de baja" de "se colgó la pantalla".
 */
export function AlternarBaja({ id, nombre }: { id: string; nombre: string }) {
  const [pendiente, empezar] = useTransition();
  const [confirmando, setConfirmando] = useState(false);
  const router = useRouter();

  return (
    <>
      <button
        type="button"
        disabled={pendiente}
        onClick={() => setConfirmando(true)}
        className="inline-flex h-11 items-center gap-1.5 rounded-lg border px-3.5 text-base transition-colors hover:bg-muted hover:text-destructive disabled:opacity-60"
      >
        {pendiente && <Loader2 className="h-4 w-4 animate-spin" />}
        Dar de baja
      </button>

      <Confirmar
        abierto={confirmando}
        alCerrar={() => setConfirmando(false)}
        titulo={`Dar de baja «${nombre}»`}
        detalle="Deja de aparecer en el catálogo del sitio ahora mismo. No se borra: se puede volver a activar desde la ficha del producto."
        confirmar="Sí, darlo de baja"
        peligro
        pendiente={pendiente}
        alConfirmar={() => {
          setConfirmando(false);
          empezar(async () => {
            await alternarActivo(id, false);
            toast.success(`${nombre} ya no aparece en el catálogo.`);
            // La lista se arma en el servidor: sin esto el producto que se
            // acaba de dar de baja sigue en pantalla como si nada.
            router.refresh();
          });
        }}
      />
    </>
  );
}
