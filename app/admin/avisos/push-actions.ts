"use server";

import { requireStaff } from "@/lib/dal/session";
import {
  avisarAlPanel,
  borrarSuscripcion,
  clavePublicaDePush,
  guardarSuscripcion,
  pushConfigurado,
} from "@/lib/notificaciones/push";

export interface EstadoPush {
  error?: string;
  ok?: string;
}

/**
 * La clave pública con la que el navegador se suscribe.
 *
 * Es pública de verdad —va en el paquete que viaja al navegador— y no sirve
 * para mandar nada: firmar el mensaje necesita la privada, que nunca sale del
 * servidor.
 */
export async function claveDePush(): Promise<{
  clave: string | null;
  configurado: boolean;
}> {
  await requireStaff();
  return { clave: clavePublicaDePush(), configurado: pushConfigurado() };
}

/** Prende los avisos en este dispositivo. */
export async function activarAvisos(suscripcion: {
  endpoint: string;
  p256dh: string;
  auth: string;
  descripcion?: string;
}): Promise<EstadoPush> {
  const usuario = await requireStaff();

  if (!suscripcion.endpoint || !suscripcion.p256dh || !suscripcion.auth) {
    return { error: "El navegador no devolvió una suscripción completa." };
  }

  await guardarSuscripcion({
    userId: usuario.userId,
    endpoint: suscripcion.endpoint,
    p256dh: suscripcion.p256dh,
    auth: suscripcion.auth,
    descripcion: suscripcion.descripcion,
  });

  return { ok: "Listo: este dispositivo va a avisar cuando entre una venta." };
}

/** Apaga los avisos en este dispositivo. */
export async function desactivarAvisos(
  endpoint: string,
): Promise<EstadoPush> {
  const usuario = await requireStaff();
  await borrarSuscripcion(usuario.userId, endpoint);
  return { ok: "Este dispositivo dejó de recibir avisos." };
}

/**
 * Manda un aviso de prueba.
 *
 * Es lo que convierte «activé los avisos» en «los avisos funcionan»: el permiso
 * del navegador se puede dar y el mensaje igual no llegar —por la clave, por el
 * modo de ahorro del teléfono, por mil cosas—, y eso hay que poder verlo ahora y
 * no el sábado que entre la primera venta.
 */
export async function probarAviso(): Promise<EstadoPush> {
  await requireStaff();

  if (!pushConfigurado()) {
    return {
      error:
        "Faltan las claves VAPID en el servidor. Hasta que estén, los avisos no salen.",
    };
  }

  await avisarAlPanel({
    titulo: "Prueba de aviso",
    cuerpo: "Si ves esto, el panel te va a avisar cuando entre una venta.",
    url: "/admin",
    etiqueta: "prueba",
  });

  return { ok: "Aviso mandado. Si no llega en unos segundos, revisá el permiso del navegador." };
}
