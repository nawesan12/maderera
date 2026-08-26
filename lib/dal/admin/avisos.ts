import "server-only";

import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { avisosEmail, notificationsLog } from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";
import { correoEnVivo } from "@/lib/email";
import { remitenteVisible } from "@/lib/email/config";
import { posicionDelEvento } from "@/lib/notificaciones/titulos";

/** Lectura de la configuración de avisos. Solo personal de la empresa. */

export interface AvisoEmailConfigurable {
  id: string;
  evento: string;
  asunto: string;
  encabezado: string | null;
  activo: boolean;
}

export async function listarAvisosEmail(): Promise<AvisoEmailConfigurable[]> {
  await requireStaff();

  const filas = await db
    .select({
      id: avisosEmail.id,
      evento: avisosEmail.evento,
      asunto: avisosEmail.asunto,
      encabezado: avisosEmail.encabezado,
      activo: avisosEmail.activo,
    })
    .from(avisosEmail)
    .orderBy(asc(avisosEmail.evento));

  // El orden que importa es el del ciclo de vida de un pedido, no el
  // alfabético: la lista se lee de arriba abajo como se lee el recorrido.
  return filas.sort(
    (a, b) => posicionDelEvento(a.evento) - posicionDelEvento(b.evento),
  );
}

export interface EstadoCorreo {
  enVivo: boolean;
  remitente: string;
  detalle: string;
}

export async function estadoCorreo(): Promise<EstadoCorreo> {
  await requireStaff();

  const enVivo = correoEnVivo();

  return {
    enVivo,
    remitente: remitenteVisible(),
    detalle: enVivo
      ? "Los correos salen por Resend."
      : "Falta cargar RESEND_API_KEY. Los avisos se arman y quedan registrados, pero no se envían.",
  };
}

export interface AvisoEnviado {
  id: string;
  canal: string;
  evento: string;
  destinatario: string;
  asunto: string | null;
  estado: string;
  error: string | null;
  createdAt: Date;
}

/**
 * Bitácora de avisos.
 *
 * Es la pantalla a la que ir cuando alguien dice que nunca le llegó nada. Los
 * dos canales van juntos: la pregunta nunca es "¿le mandamos el mail?", es
 * "¿le avisamos?".
 */
export async function ultimosAvisosEnviados(limite = 40): Promise<AvisoEnviado[]> {
  await requireStaff();

  return db
    .select({
      id: notificationsLog.id,
      canal: notificationsLog.canal,
      evento: notificationsLog.evento,
      destinatario: notificationsLog.destinatario,
      asunto: notificationsLog.asunto,
      estado: notificationsLog.estado,
      error: notificationsLog.error,
      createdAt: notificationsLog.createdAt,
    })
    .from(notificationsLog)
    .orderBy(desc(notificationsLog.createdAt))
    .limit(limite);
}

/** Avisos de una entidad concreta, para mostrarlos en su ficha. */
export async function avisosDe(
  entidadTipo: string,
  entidadId: string,
): Promise<AvisoEnviado[]> {
  await requireStaff();

  return db
    .select({
      id: notificationsLog.id,
      canal: notificationsLog.canal,
      evento: notificationsLog.evento,
      destinatario: notificationsLog.destinatario,
      asunto: notificationsLog.asunto,
      estado: notificationsLog.estado,
      error: notificationsLog.error,
      createdAt: notificationsLog.createdAt,
    })
    .from(notificationsLog)
    .where(eq(notificationsLog.entidadId, entidadId))
    .orderBy(desc(notificationsLog.createdAt))
    .limit(20);
}
