import "server-only";

import { hayEmail } from "./config";
import { proveedorDemoEmail } from "./proveedor-demo";
import { proveedorResend } from "./proveedor-resend";
import { configSmtp, proveedorSmtp } from "./proveedor-smtp";
import type { ProveedorEmail } from "./tipos";

/**
 * Qué proveedor manda los correos.
 *
 * `EMAIL_PROVIDER` manda: `smtp` (el servidor de correo propio), `resend` o
 * `demo`. Sin declararlo, el primero que esté configurado —el SMTP propio
 * antes que Resend— y, si ninguno, el de demostración.
 */
export function proveedorEmail(): ProveedorEmail {
  const elegido = process.env.EMAIL_PROVIDER?.trim();
  if (elegido === "demo") return proveedorDemoEmail;
  if (elegido === "smtp") return configSmtp() ? proveedorSmtp : proveedorDemoEmail;
  if (elegido === "resend") return hayEmail() ? proveedorResend : proveedorDemoEmail;
  if (configSmtp()) return proveedorSmtp;
  return hayEmail() ? proveedorResend : proveedorDemoEmail;
}

/** Si los correos salen de verdad. Las pantallas lo avisan cuando no. */
export function correoEnVivo(): boolean {
  return proveedorEmail().real;
}

export * from "./tipos";
