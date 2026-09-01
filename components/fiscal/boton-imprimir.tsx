"use client";

import { Printer } from "lucide-react";

/** Dispara la impresión del navegador, que también permite guardar como PDF. */
export function BotonImprimir() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="boton-imprimir"
    >
      <Printer className="h-4 w-4" />
      Imprimir o guardar como PDF
    </button>
  );
}
