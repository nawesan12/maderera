import "server-only";

import { hayEmail } from "./config";
import { proveedorDemoEmail } from "./proveedor-demo";
import { proveedorResend } from "./proveedor-resend";
import type { ProveedorEmail } from "./tipos";

export function proveedorEmail(): ProveedorEmail {
  if (process.env.EMAIL_PROVIDER === "demo") return proveedorDemoEmail;
  return hayEmail() ? proveedorResend : proveedorDemoEmail;
}

/** Si los correos salen de verdad. Las pantallas lo avisan cuando no. */
export function correoEnVivo(): boolean {
  return proveedorEmail().real;
}

export * from "./tipos";
