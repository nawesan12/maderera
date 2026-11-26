"use client";

import { useEffect, useRef } from "react";

/** El atributo que apaga el flotante mientras la zona está a la vista. */
export const ATRIBUTO_ZONA_SIN_FLOTANTE = "data-zona-sin-flotante";
/** El mismo, solo en el teléfono (globals.css). */
export const ATRIBUTO_ZONA_SIN_FLOTANTE_CELULAR = "data-zona-sin-flotante-celular";

/**
 * Esconde el WhatsApp flotante **solo mientras esta zona se ve** (corrección
 * de T5).
 *
 * En la ficha, el flotante tapaba «Consultar precio por WhatsApp» y se lo
 * apagó con `data-sin-flotantes`, pero ese `body:has()` mira la página
 * entera: al bajar a la ficha técnica o a los relacionados, el botón de la
 * ficha quedaba arriba, fuera de la pantalla, y no había ningún WhatsApp a
 * mano en la pantalla donde más se decide. Ahora el flotante se va mientras
 * el selector está en pantalla y vuelve al dejarlo atrás.
 *
 * El atributo va en `<html>` y no en un estado de React: el flotante vive en
 * el layout y no conoce a la ficha. Sin IntersectionObserver no se esconde,
 * que es el mal menor: tapar un poco es mejor que no tener WhatsApp.
 */
export function ZonaSinFlotante({
  className,
  soloEnCelular = false,
  children,
}: {
  className?: string;
  /** Solo en el teléfono, donde el flotante cae encima del contenido. */
  soloEnCelular?: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const atributo = soloEnCelular ? ATRIBUTO_ZONA_SIN_FLOTANTE_CELULAR : ATRIBUTO_ZONA_SIN_FLOTANTE;

  useEffect(() => {
    const zona = ref.current;
    if (!zona || typeof IntersectionObserver === "undefined") return;
    const raiz = document.documentElement;
    const observador = new IntersectionObserver(([entrada]) => {
      if (entrada?.isIntersecting) raiz.setAttribute(atributo, "");
      else raiz.removeAttribute(atributo);
    });
    observador.observe(zona);
    return () => {
      observador.disconnect();
      raiz.removeAttribute(atributo);
    };
  }, [atributo]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
