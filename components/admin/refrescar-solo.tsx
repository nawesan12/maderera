"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Vuelve a pedir la pantalla cada tanto y al volver a la pestaña.
 *
 * El depósito deja el panel abierto toda la mañana: sin esto, la cola y lo
 * que hay para preparar quedaban como estaban a las ocho, y la lista mentía.
 * No dibuja nada.
 */
export function RefrescarSolo({ cadaSegundos = 60 }: { cadaSegundos?: number }) {
  const router = useRouter();
  useEffect(() => {
    const refrescar = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const reloj = window.setInterval(refrescar, cadaSegundos * 1000);
    document.addEventListener("visibilitychange", refrescar);
    return () => {
      window.clearInterval(reloj);
      document.removeEventListener("visibilitychange", refrescar);
    };
  }, [router, cadaSegundos]);
  return null;
}
