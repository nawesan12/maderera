import "server-only";

import webpush from "web-push";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { notificationsLog, profiles, pushSubscriptions } from "@/lib/db/schema";
import { quienEntra, type RolStaff } from "@/lib/roles";

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
  /**
   * A quién, si no es a todo el personal. Un mensaje de WhatsApp de un cliente
   * no le tiene que sonar al aserradero —no puede abrir la bandeja—, y una
   * conversación que ya atiende alguien le suena solo a esa persona.
   */
  para?: {
    /** Solo a quienes pueden entrar a esta pantalla, según `ACCESO`. */
    pantalla?: string;
    usuarioId?: string | null;
  };
}

/** Si hay con qué firmar los mensajes. Sin esto, el push está apagado. */
export function pushConfigurado(): boolean {
  return Boolean(
    process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY,
  );
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

    const suscripciones = await suscripcionesPara(aviso.para);

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

async function suscripcionesPara(para: AvisoPush["para"]) {
  if (para?.usuarioId) {
    return db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, para.usuarioId));
  }
  const roles = para?.pantalla ? quienEntra(para.pantalla) : null;
  if (!roles) return db.select().from(pushSubscriptions);

  const filas = await db
    .select({ suscripcion: pushSubscriptions })
    .from(pushSubscriptions)
    .innerJoin(profiles, eq(profiles.userId, pushSubscriptions.userId))
    .where(inArray(profiles.staffRole, roles as RolStaff[]));
  return filas.map((f) => f.suscripcion);
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

// Suscribir y sacar un dispositivo lo hace Go (backend/internal/avisos).
