"use client";

import { useEffect } from "react";

/**
 * Lleva a la factura recién cargada: la que está a la vista (la fila de la
 * tabla o la tarjeta del teléfono, según el ancho) y marcada con
 * `data-nueva`. En el teléfono quedaba unos 4000 px más abajo del formulario.
 */
export function IrALaNueva() {
  useEffect(() => {
    const visible = [...document.querySelectorAll<HTMLElement>("[data-nueva]")].find((e) => e.offsetParent !== null);
    visible?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []);
  return null;
}
