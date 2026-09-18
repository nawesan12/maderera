"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { customerFollowUps } from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";
import { registrarEnBitacora } from "@/lib/dal/admin/auditoria";

export interface EstadoGestion {
  error?: string;
  ok?: string;
}

function refrescar(customerId?: string) {
  revalidatePath("/admin/clientes/seguimiento");
  revalidatePath("/admin");
  if (customerId) revalidatePath(`/admin/clientes/${customerId}`);
}

const esquema = z.object({
  customerId: z.string().uuid("Elegí el cliente."),
  asunto: z
    .string()
    .trim()
    .min(3, "Escribí de qué se trata, aunque sea en tres palabras.")
    .max(160),
  notas: z.string().trim().max(2000).optional(),
  /**
   * Cuándo volver.
   *
   * Es opcional pero es lo único que hace que la gestión aparezca sola: sin
   * fecha queda en el tablero esperando que alguien la mire.
   */
  proximaAccion: z.string().trim().optional(),
});

export async function crearGestion(
  _previo: EstadoGestion,
  formData: FormData,
): Promise<EstadoGestion> {
  const usuario = await requireStaff();

  const parsed = esquema.safeParse({
    customerId: formData.get("customerId"),
    asunto: formData.get("asunto"),
    notas: (formData.get("notas") as string) || undefined,
    proximaAccion: (formData.get("proximaAccion") as string) || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  }

  const d = parsed.data;

  await db.insert(customerFollowUps).values({
    customerId: d.customerId,
    asunto: d.asunto,
    notas: d.notas || null,
    // A las 12 del mediodía: una fecha sin hora a la medianoche vence el día
    // anterior en cuanto alguien mira el tablero a la mañana.
    proximaAccionAt: d.proximaAccion
      ? new Date(`${d.proximaAccion}T12:00:00`)
      : null,
    responsableUserId: usuario.userId,
    creadoPor: usuario.userId,
  });

  await registrarEnBitacora({
    sesion: usuario,
    accion: "crear",
    entidad: "cliente",
    entidadId: d.customerId,
    descripcion: `Abrió un seguimiento: ${d.asunto}`,
  });

  refrescar(d.customerId);
  return { ok: "Seguimiento anotado." };
}

/**
 * Mueve una gestión de etapa, y de paso deja anotado qué pasó.
 *
 * **La nota se agrega, no se pisa.** Un seguimiento es una conversación en el
 * tiempo: «no atiende», «dijo que paga el viernes», «pagó la mitad». Guardar
 * solo lo último convierte el historial en un estado, que es lo que ya había en
 * el campo de notas de la ficha y no alcanzaba.
 */
export async function moverGestion(
  id: string,
  etapa: "pendiente" | "hablando" | "promesa" | "cerrado",
  nota?: string,
  proximaAccion?: string,
): Promise<EstadoGestion> {
  const usuario = await requireStaff();

  const parsed = z
    .object({
      id: z.string().uuid(),
      etapa: z.enum(["pendiente", "hablando", "promesa", "cerrado"]),
      nota: z.string().trim().max(500).optional(),
      proximaAccion: z.string().trim().optional(),
    })
    .safeParse({ id, etapa, nota, proximaAccion });

  if (!parsed.success) return { error: "No se pudo mover el seguimiento." };

  const [previa] = await db
    .select({
      customerId: customerFollowUps.customerId,
      asunto: customerFollowUps.asunto,
      notas: customerFollowUps.notas,
    })
    .from(customerFollowUps)
    .where(eq(customerFollowUps.id, parsed.data.id))
    .limit(1);

  if (!previa) return { error: "Ese seguimiento ya no está." };

  const cuando = new Date().toLocaleDateString("es-AR");
  const agregada = parsed.data.nota
    ? [previa.notas, `${cuando} · ${parsed.data.nota}`].filter(Boolean).join("\n")
    : previa.notas;

  await db
    .update(customerFollowUps)
    .set({
      etapa: parsed.data.etapa,
      notas: agregada,
      ...(parsed.data.proximaAccion
        ? { proximaAccionAt: new Date(`${parsed.data.proximaAccion}T12:00:00`) }
        : {}),
      // Cerrar limpia la fecha: una gestión terminada no tiene que seguir
      // apareciendo como vencida.
      ...(parsed.data.etapa === "cerrado"
        ? { cerradoAt: new Date(), proximaAccionAt: null }
        : { cerradoAt: null }),
    })
    .where(eq(customerFollowUps.id, parsed.data.id));

  await registrarEnBitacora({
    sesion: usuario,
    accion: "cambiar_estado",
    entidad: "cliente",
    entidadId: previa.customerId,
    descripcion: `${previa.asunto}: ${ETIQUETA[parsed.data.etapa]}${
      parsed.data.nota ? ` — ${parsed.data.nota}` : ""
    }`,
  });

  refrescar(previa.customerId);
  return { ok: "Listo." };
}

const ETIQUETA: Record<string, string> = {
  pendiente: "queda para hacer",
  hablando: "se está hablando",
  promesa: "prometió pagar",
  cerrado: "cerrado",
};
