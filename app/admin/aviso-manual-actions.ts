"use server";

import { and, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { notificationsLog } from "@/lib/db/schema";
import { requireBandeja } from "@/lib/dal/admin/whatsapp";
import { AVISOS_MANUALES, esEventoManual } from "@/lib/whatsapp/aviso-manual";
import { TIPOS_ENTIDAD } from "@/lib/whatsapp/aviso-manual-datos";
import { aWaId } from "@/lib/whatsapp/numeros";

/**
 * Deja constancia de que alguien avisó por WhatsApp desde la app del teléfono.
 *
 * Lo llama el botón al abrir wa.me. No manda nada —eso lo hace la persona en
 * su WhatsApp—: registra en `notifications_log` con canal `whatsapp_manual`,
 * quién fue y cuándo, para que el botón diga «ya avisado», para que el aviso
 * automático no mande lo mismo otra vez, y para que «¿le avisaron?» tenga
 * respuesta.
 *
 * Pide el rol de la bandeja, igual que el botón: depósito y aserradero no
 * atienden el WhatsApp de la maderera.
 *
 * Un doble clic no deja dos filas: si la misma persona registró el mismo aviso
 * en los últimos dos minutos, no se repite.
 */
export async function registrarAvisoManual(datos: {
  evento: string;
  entidadTipo: string;
  entidadId: string;
  telefono: string | null;
}): Promise<{ ok?: true; error?: string }> {
  // Lo usa quien atiende a los clientes: los mismos roles que la bandeja.
  const usuario = await requireBandeja();

  const parsed = z
    .object({
      evento: z.string().refine(esEventoManual),
      entidadTipo: z.enum(TIPOS_ENTIDAD as [string, ...string[]]),
      entidadId: z.string().uuid(),
      telefono: z.string().max(40).nullable(),
    })
    .safeParse(datos);
  if (!parsed.success) return { error: "No se pudo registrar el aviso." };

  const hace = new Date(Date.now() - 2 * 60_000);
  const [reciente] = await db
    .select({ id: notificationsLog.id })
    .from(notificationsLog)
    .where(
      and(
        eq(notificationsLog.canal, "whatsapp_manual"),
        eq(notificationsLog.evento, parsed.data.evento),
        eq(notificationsLog.entidadId, parsed.data.entidadId),
        eq(notificationsLog.usuarioId, usuario.userId),
        gte(notificationsLog.createdAt, hace),
      ),
    )
    .limit(1);
  if (reciente) return { ok: true };

  const evento = parsed.data.evento as keyof typeof AVISOS_MANUALES;
  await db.insert(notificationsLog).values({
    canal: "whatsapp_manual",
    evento,
    destinatario: (parsed.data.telefono && aWaId(parsed.data.telefono)) || "-",
    asunto: AVISOS_MANUALES[evento].titulo,
    entidadTipo: parsed.data.entidadTipo,
    entidadId: parsed.data.entidadId,
    // «Enviada» por la persona: la plataforma abrió el chat con el texto, el
    // envío lo hizo quien tocó enviar en su WhatsApp.
    estado: "enviada",
    usuarioId: usuario.userId,
  });

  return { ok: true };
}
