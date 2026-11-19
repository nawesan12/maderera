"use client";

import { useLayoutEffect, useRef, useState } from "react";

/**
 * La letra chica de una promo, recortada a tres renglones solo si de verdad
 * no entra (corrección de T5).
 *
 * Antes se decidía por la cantidad de caracteres (más de 90, «Ver más»): en
 * escritorio un texto de 100 a 180 caracteres entra en tres renglones, y se
 * veía entero con un «Ver más» abajo que al tocarlo solo se borraba. Además
 * el `<summary>` envolvía todo el párrafo: el lector de pantalla leía la
 * condición entera como un botón. Ahora se mide el desborde real, el botón es
 * solo el botón y abierto dice «Ver menos».
 *
 * Mientras no se midió (el HTML del servidor), va recortado y sin botón; si
 * resulta que entra, el recorte no se nota porque no corta nada.
 */
export function LetraChica({ texto }: { texto: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [desborda, setDesborda] = useState(false);
  const [abierta, setAbierta] = useState(false);

  useLayoutEffect(() => {
    const p = ref.current;
    if (!p) return;
    const medir = () => {
      // Abierta no hay recorte que medir: se conserva lo último que se supo.
      if (p.classList.contains("line-clamp-3")) setDesborda(p.scrollHeight > p.clientHeight + 1);
    };
    medir();
    const observador = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(medir);
    observador?.observe(p);
    return () => observador?.disconnect();
  }, []);

  return (
    <div className="mt-2 text-[13.5px] leading-relaxed text-texto-2">
      <p ref={ref} className={abierta ? undefined : "line-clamp-3"}>
        {texto}
      </p>
      {(desborda || abierta) && (
        <button
          type="button"
          aria-expanded={abierta}
          onClick={() => setAbierta((a) => !a)}
          className="mt-1 font-semibold text-acento-texto hover:underline"
        >
          {abierta ? "Ver menos" : "Ver más"}
        </button>
      )}
    </div>
  );
}
