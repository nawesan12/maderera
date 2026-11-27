"use client";

import { Printer } from "lucide-react";

/** Dispara la impresión del navegador, que también permite guardar como PDF. */
export function BotonImprimir({ corto = false }: { corto?: boolean } = {}) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="boton-imprimir"
    >
      <Printer className="h-4 w-4" />
      {/* «Imprimir o guardar como PDF» se partía en tres renglones a 375 px
          en la hoja y el plano del taller (M2S2-105). */}
      {corto ? "Imprimir" : "Imprimir o guardar como PDF"}
    </button>
  );
}
