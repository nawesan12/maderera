"use client";

import { Printer } from "lucide-react";

/**
 * Imprimir.
 *
 * Es de cliente porque `window.print()` no existe en el servidor, y va aparte
 * para que el ticket entero no tenga que serlo.
 */
export function BotonImprimir() {
  return (
    <button onClick={() => window.print()} className="boton-imprimir">
      <Printer className="h-4 w-4" />
      Imprimir
    </button>
  );
}
