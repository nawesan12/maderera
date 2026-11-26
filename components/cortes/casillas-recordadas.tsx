"use client";

import { useEffect } from "react";

/** Lo tildado vale mientras dura el corte: después de tres días se olvida. */
const VIGENCIA_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Las casillas de la hoja de corte, guardadas en el dispositivo.
 *
 * La hoja se arma en el servidor y sus casillas son de HTML, sin estado: al
 * recargar —o cuando la tablet se bloquea y el navegador descarta la
 * pestaña— volvían vacías y el operario perdía la cuenta de qué pasadas ya
 * hizo (mes simulado, H117). Esto las recuerda en `localStorage`, por corte,
 * solo en ese dispositivo: es una ayuda para quien está cortando, no un
 * registro (el estado del corte lo lleva la cola).
 *
 * Cada casilla se reconoce por su `data-paso` (patrón y número de paso).
 */
export function CasillasRecordadas({ clave }: { clave: string }) {
  useEffect(() => {
    const leer = (): Record<string, boolean> => {
      try {
        const crudo = window.localStorage.getItem(clave);
        if (!crudo) return {};
        const guardado = JSON.parse(crudo) as { en?: number; pasos?: Record<string, boolean> };
        if (!guardado.en || Date.now() - guardado.en > VIGENCIA_MS) return {};
        return guardado.pasos ?? {};
      } catch {
        return {};
      }
    };
    const pasos = leer();
    const casillas = document.querySelectorAll<HTMLInputElement>("input[type=checkbox][data-paso]");
    for (const c of casillas) {
      if (pasos[c.dataset.paso ?? ""]) c.checked = true;
    }
    const alCambiar = (e: Event) => {
      const c = e.target as HTMLInputElement | null;
      if (!c?.dataset.paso) return;
      const actuales = leer();
      if (c.checked) actuales[c.dataset.paso] = true;
      else delete actuales[c.dataset.paso];
      try {
        window.localStorage.setItem(clave, JSON.stringify({ en: Date.now(), pasos: actuales }));
      } catch {
        // Sin almacenamiento (modo privado): la casilla sigue andando, solo
        // que no se recuerda.
      }
    };
    for (const c of casillas) c.addEventListener("change", alCambiar);
    return () => {
      for (const c of casillas) c.removeEventListener("change", alCambiar);
    };
  }, [clave]);
  return null;
}
