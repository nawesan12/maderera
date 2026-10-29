// Copia de git 56ef2a1 (antes de la mudanza a Go) para el benchmark de la tanda 7.
import "server-only";

import { hayArca } from "./config-arca";
import { proveedorArca } from "./arca";
import { proveedorInterno } from "./interno";
import type { ProveedorFiscal } from "./tipos";

/**
 * Elige con qué se autoriza.
 *
 * Con certificado cargado se habla con ARCA; sin él, el proveedor interno
 * numera y emite sin CAE. La pantalla y las acciones no saben cuál está activo:
 * piden autorizar y reciben un resultado.
 */
export function proveedorFiscal(): ProveedorFiscal {
  if (process.env.ARCA_PROVEEDOR === "interno") return proveedorInterno;
  return hayArca() ? proveedorArca : proveedorInterno;
}

export * from "./tipos";
