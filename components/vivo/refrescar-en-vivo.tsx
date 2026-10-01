"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { Canal } from "@/lib/vivo/canales";
import { useEnVivo } from "@/lib/vivo/use-en-vivo";

/**
 * Vuelve a pedir la página al servidor cuando algo cambió en sus canales.
 *
 * Los avisos que llegan juntos —un corte nuevo son dos: el alta y sus
 * piezas— se juntan en un solo refresco. Sin tiempo real, refresca cada
 * `sinConexionCadaMs` como antes; sin ese valor, se queda quieta.
 */
export function RefrescarEnVivo({
  canales,
  sinConexionCadaMs,
}: {
  canales: readonly Canal[];
  sinConexionCadaMs?: number;
}) {
  const router = useRouter();
  const pendiente = useRef<ReturnType<typeof setTimeout> | null>(null);

  const conectado = useEnVivo(canales, () => {
    if (pendiente.current) return;
    pendiente.current = setTimeout(() => {
      pendiente.current = null;
      router.refresh();
    }, 400);
  });

  useEffect(() => {
    if (conectado || !sinConexionCadaMs) return;
    const reloj = setInterval(() => router.refresh(), sinConexionCadaMs);
    return () => clearInterval(reloj);
  }, [conectado, sinConexionCadaMs, router]);

  useEffect(
    () => () => {
      if (pendiente.current) clearTimeout(pendiente.current);
    },
    [],
  );

  return null;
}
