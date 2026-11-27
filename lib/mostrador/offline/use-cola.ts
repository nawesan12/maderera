"use client";

import { useCallback, useEffect, useState } from "react";
import { drenar, efectivoEnCola, leerCola, limpiarConfirmadas, type EfectivoEnCola } from "./cola";
import { resumir } from "./cola-estado";
import type { ResumenDeCola } from "./cola-estado";

/**
 * La cola vista desde la pantalla: cuánto falta subir y cuándo se sube.
 *
 * **No usa Background Sync.** Es solo de Chromium, y un punto de venta que
 * sincroniza cuando el navegador tiene ganas es peor que un bucle visible que
 * quien atiende puede mirar: si algo no subió, tiene que poder verlo y saber
 * cuándo se va a reintentar.
 *
 * Se drena al volver la conexión, al volver a la pestaña, y cada veinte
 * segundos mientras quede algo. Con la cola vacía no hace nada.
 */

const CADA_MS = 20_000;

export interface EstadoCola extends ResumenDeCola {
  /** La sesión venció: la cola retiene todo y hay que volver a entrar. */
  faltaSesion: boolean;
  /** El efectivo de lo que espera, de esta sucursal: ya está en el cajón (M2S1-086). */
  efectivo: EfectivoEnCola;
  refrescar: () => Promise<void>;
  drenarAhora: () => Promise<void>;
}

export function useCola(enLinea: boolean, branchId = ""): EstadoCola {
  const [resumen, setResumen] = useState<ResumenDeCola>({
    pendientes: 0,
    atascadas: 0,
    rechazadas: 0,
    sinSubir: 0,
  });
  const [faltaSesion, setFaltaSesion] = useState(false);
  const [efectivo, setEfectivo] = useState<EfectivoEnCola>({ ventas: 0, ingresos: 0, retiros: 0 });

  const refrescar = useCallback(async () => {
    try {
      const filas = await leerCola();
      setResumen(resumir(filas));
      setEfectivo(efectivoEnCola(filas, branchId));
    } catch {
      // Sin almacén local no hay cola que mostrar.
    }
  }, [branchId]);

  const drenarAhora = useCallback(async () => {
    try {
      const r = await drenar();
      if (!r) return;

      setFaltaSesion(r.faltaSesion);
      await refrescar();
    } catch {
      // El próximo ciclo reintenta.
    }
  }, [refrescar]);

  useEffect(() => {
    const primero = setTimeout(() => void refrescar(), 0);

    const cada = setInterval(() => {
      if (enLinea) void drenarAhora();
      else void refrescar();
    }, CADA_MS);

    const alVolver = () => {
      if (enLinea) void drenarAhora();
    };

    window.addEventListener("online", alVolver);
    document.addEventListener("visibilitychange", alVolver);

    return () => {
      clearTimeout(primero);
      clearInterval(cada);
      window.removeEventListener("online", alVolver);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [enLinea, drenarAhora, refrescar]);

  // Apenas vuelve la conexión, sin esperar el ciclo.
  useEffect(() => {
    if (!enLinea) return;
    const t = setTimeout(() => void drenarAhora(), 500);
    return () => clearTimeout(t);
  }, [enLinea, drenarAhora]);

  // Las confirmadas viejas se van: la cola no es un historial.
  useEffect(() => {
    const t = setTimeout(() => void limpiarConfirmadas(), 30_000);
    return () => clearTimeout(t);
  }, []);

  return { ...resumen, faltaSesion, efectivo, refrescar, drenarAhora };

}
