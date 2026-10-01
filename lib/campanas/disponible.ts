import "server-only";

import { proveedorEmail } from "@/lib/email";

/**
 * Por qué una campaña no podría salir ahora mismo, o null si puede.
 *
 * Dos razones: sin envío real conectado no le llega a nadie, y fuera del
 * servidor propio no hay cron que mande las tandas siguientes a la primera.
 * En desarrollo se permite, para poder probarlo disparando la tarea a mano.
 */
export function motivoParaNoEnviar(): string | null {
  if (!proveedorEmail().real) {
    return "El envío de correos no está conectado: con el proveedor de demostración la campaña no saldría a nadie.";
  }
  if (process.env.NODE_ENV === "production" && process.env.PLATAFORMA !== "vps") {
    return "Las campañas salen en tandas desde el servidor propio, y este despliegue no tiene el cron que las manda.";
  }
  return null;
}
