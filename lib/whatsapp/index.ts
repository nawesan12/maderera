import "server-only";

import { hayCloud } from "./config";
import { proveedorCloud } from "./proveedor-cloud";
import { proveedorDemo } from "./proveedor-demo";
import type { ProveedorWhatsapp } from "./tipos";

/**
 * Elige con qué proveedor se habla.
 *
 * La bandeja y las acciones piden el proveedor acá y solo conocen la interfaz
 * de `tipos.ts`. Sin credenciales de Meta cargadas —que es la situación de hoy,
 * porque MJBJ atiende con WhatsApp Business común— se usa el de demostración.
 */
export function proveedorWhatsapp(): ProveedorWhatsapp {
  if (process.env.WHATSAPP_PROVIDER === "demo") return proveedorDemo;
  return hayCloud() ? proveedorCloud : proveedorDemo;
}

export * from "./tipos";
