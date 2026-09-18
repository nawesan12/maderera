import "server-only";

import webpush from "web-push";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { notificationsLog, pushSubscriptions } from "@/lib/db/schema";

/**
 * Avisos al panel, en el teléfono.
 *
 * **Lo pidió la clienta después de ver Tiendanube**: que cuando entra una venta
 * por el sitio, suene el teléfono, sin tener que estar mirando el correo. El
 * sistema ya avisaba —al cliente— pero nunca al negocio, así que un pedido de un
 * sábado a la tarde se descubría el lunes.
 *
 * Sigue las mismas tres reglas que el correo y el WhatsApp
 * (`lib/notificaciones/avisos.ts`):
 *
 * 1. **Nunca frena la operación.** Si el push falla, la venta igual se guarda.
 * 2. **Todo queda en `notifications_log`**, con `omitida` cuando no hay claves
 *    configuradas —que es el estado normal hasta que se generen— para que nadie
 *    lea el registro y crea que el aviso salió.
 * 3. **Una suscripción muerta se borra.** El navegador contesta 404 o 410
 *    cuando alguien desinstaló la aplicación o limpió los permisos: guardarla
 *    para siempre haría que cada aviso intente entregar a fantasmas.
 */

export interface AvisoPush {
  titulo: string;
  cuerpo: string;
  /** A dónde lleva el toque. Ruta del panel. */
  url: string;
  /** Agrupa los avisos del mismo tipo: el nuevo reemplaza al anterior. */
  etiqueta?: string;
}

/** Si hay con qué firmar los mensajes. Sin esto, el push está apagado. */
export function pushConfigurado(): boolean {
  return Boolean(
    process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY,
  );
}

/** La clave pública, que es lo único que el navegador necesita para suscribirse. */
export function clavePublicaDePush(): string | null {
  return process.env.VAPID_PUBLIC_KEY ?? null;
}

function configurar() {
  webpush.setVapidDetails(
    // El "subject" identifica a quién reclamarle si un servidor de push recibe
    // abuso desde esta aplicación. Un correo del negocio alcanza.
    process.env.VAPID_SUBJECT ?? "mailto:info@mjbj.com.ar",
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
}

/**
 * Manda un aviso a todos los dispositivos del personal.
 *
 * No recibe destinatarios: los avisos del panel son para quien esté de turno, y
 * quién los recibe se decide en el dispositivo —activándolos o no— y no en una
 * lista que alguien tendría que mantener.
 */
export async function avisarAlPanel(aviso: AvisoPush): Promise<void> {
  try {
    if (!pushConfigurado()) {
      await registrar(aviso, "omitida", "Sin claves VAPID configuradas");
      return;
    }

    const suscripciones = await db.select().from(pushSubscriptions);

    if (suscripciones.length === 0) {
      await registrar(aviso, "omitida", "Ningún dispositivo con avisos activados");
      return;
    }

    configurar();

    const carga = JSON.stringify({
      titulo: aviso.titulo,
      cuerpo: aviso.cuerpo,
      url: aviso.url,
      etiqueta: aviso.etiqueta ?? "mjbj",
    });

    let entregados = 0;

    for (const suscripcion of suscripciones) {
      try {
        await webpush.sendNotification(
          {
            endpoint: suscripcion.endpoint,
            keys: { p256dh: suscripcion.p256dh, auth: suscripcion.auth },
          },
          carga,
          // Una hora: un aviso de venta que llega al día siguiente es ruido.
          { TTL: 3600 },
        );

        entregados++;

        await db
          .update(pushSubscriptions)
          .set({ ultimaVezAt: new Date() })
          .where(eq(pushSubscriptions.id, suscripcion.id));
      } catch (error) {
        const codigo = (error as { statusCode?: number }).statusCode;

        // 404 y 410: el dispositivo ya no existe. Se borra, porque si no cada
        // aviso siguiente vuelve a intentar contra un fantasma.
        if (codigo === 404 || codigo === 410) {
          await db
            .delete(pushSubscriptions)
            .where(eq(pushSubscriptions.id, suscripcion.id));
        }
      }
    }

    await registrar(
      aviso,
      entregados > 0 ? "enviada" : "fallida",
      `${entregados} de ${suscripciones.length} dispositivos`,
    );
  } catch (error) {
    // Un aviso nunca puede voltear la operación que lo disparó.
    console.error("No se pudo mandar el aviso al panel", error);
  }
}

async function registrar(
  aviso: AvisoPush,
  estado: "enviada" | "omitida" | "fallida",
  detalle: string,
): Promise<void> {
  await db.insert(notificationsLog).values({
    canal: "push",
    evento: aviso.etiqueta ?? "panel",
    destinatario: "panel",
    asunto: aviso.titulo,
    estado,
    error: estado === "enviada" ? null : detalle,
  });
}

/** Guarda la suscripción de un dispositivo. Repetirla no la duplica. */
export async function guardarSuscripcion(datos: {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  descripcion?: string | null;
}): Promise<void> {
  await db
    .insert(pushSubscriptions)
    .values({
      userId: datos.userId,
      endpoint: datos.endpoint,
      p256dh: datos.p256dh,
      auth: datos.auth,
      descripcion: datos.descripcion ?? null,
    })
    // El mismo dispositivo que vuelve a activar los avisos no es uno nuevo: el
    // navegador puede rotar las claves de cifrado sin cambiar el endpoint.
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        userId: datos.userId,
        p256dh: datos.p256dh,
        auth: datos.auth,
        ultimaVezAt: new Date(),
      },
    });
}

/** Saca un dispositivo de la lista. */
export async function borrarSuscripcion(
  userId: string,
  endpoint: string,
): Promise<void> {
  await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.endpoint, endpoint),
        eq(pushSubscriptions.userId, userId),
      ),
    );
}
