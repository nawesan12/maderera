"use client";

import { useEffect } from "react";

/** El ancho de la plancha A4 en pantalla: 210 mm a 96 ppp. */
const ANCHO_A4 = 794;

/**
 * Achica la plancha A4 para que entre en el ancho de la pantalla: a 375 px
 * medía 794 y la página se corría de costado (mes 23). Solo en pantalla: al
 * imprimir, `zoom` vuelve a 1 y las etiquetas salen a su medida.
 */
export function EscalaDeLaHoja() {
  useEffect(() => {
    const ajustar = () => {
      const escala = Math.min(1, (window.innerWidth - 16) / ANCHO_A4);
      document.documentElement.style.setProperty("--escala-hoja", String(escala));
    };
    ajustar();
    window.addEventListener("resize", ajustar);
    return () => window.removeEventListener("resize", ajustar);
  }, []);
  return null;
}
