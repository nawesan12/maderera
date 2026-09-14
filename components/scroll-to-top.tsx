"use client";

import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";

/**
 * El botón de volver arriba.
 *
 * Aparece y desaparece con una transición de CSS y no con una librería de
 * animación: el botón está siempre montado y lo que cambia es la opacidad y la
 * escala. Animar la salida era lo único que justificaba traer framer-motion a
 * todas las páginas del sitio, y esto lo hace el navegador solo.
 *
 * Apagado no recibe clics ni lectores de pantalla: `pointer-events-none` y
 * `aria-hidden` van juntos, si no queda un botón invisible que igual se puede
 * tabular.
 */
export function ScrollToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const alScrollear = () => setVisible(window.scrollY > 400);
    window.addEventListener("scroll", alScrollear, { passive: true });
    return () => window.removeEventListener("scroll", alScrollear);
  }, []);

  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      aria-label="Volver arriba"
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      className={`fixed bottom-24 right-6 z-50 flex h-11 w-11 items-center justify-center rounded-full bg-brand-orange text-white shadow-lg shadow-brand-orange/20 transition-all duration-200 hover:bg-brand-orange-dark motion-reduce:transition-none ${
        visible ? "scale-100 opacity-100" : "pointer-events-none scale-90 opacity-0"
      }`}
    >
      <ArrowUp className="h-5 w-5" />
    </button>
  );
}
