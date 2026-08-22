"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { conversaciones } from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";
import { proveedorWhatsapp } from "@/lib/whatsapp";
import {
  conversacionDe,
  ingresarEntrante,
  registrarSaliente,
} from "@/lib/whatsapp/ingesta";
import { aJid } from "@/lib/whatsapp/config";
import { plantillaBase, previsualizar } from "@/lib/whatsapp/plantillas-base";

export interface EstadoWhatsapp {
  error?: string;
  ok?: string;
  /** El envío falló por la ventana de 24 h: hay que usar plantilla. */
  requierePlantilla?: boolean;
}

const MAX_MENSAJE = 4000;

/**
 * Contesta un mensaje.
 *
 * El envío va primero y la base después: si Meta rechaza el mensaje, no queda
 * registrado como enviado algo que nunca salió. Al revés -guardar y después
 * mandar- deja la bandeja diciendo que se contestó cuando el cliente no
 * recibió nada, que es exactamente el error que hace que alguien deje de
 * confiar en el sistema.
 */
export async function responder(
  _previo: EstadoWhatsapp,
  formData: FormData,
): Promise<EstadoWhatsapp> {
  const usuario = await requireStaff();

  const parsed = z
    .object({
      conversacionId: z.string().uuid(),
      cuerpo: z.string().trim().min(1, "Escribí algo.").max(MAX_MENSAJE),
    })
    .safeParse({
      conversacionId: formData.get("conversacionId"),
      cuerpo: formData.get("cuerpo"),
    });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisá el mensaje." };
  }

  const [conversacion] = await db
    .select()
    .from(conversaciones)
    .where(eq(conversaciones.id, parsed.data.conversacionId))
    .limit(1);

  if (!conversacion) return { error: "No encontramos esa conversación." };

  const resultado = await proveedorWhatsapp().enviarTexto(
    conversacion.waJid,
    parsed.data.cuerpo,
  );

  if (resultado.error) {
    return {
      error: resultado.error,
      requierePlantilla: resultado.fueraDeVentana,
    };
  }

  await registrarSaliente({
    conversacionId: conversacion.id,
    cuerpo: parsed.data.cuerpo,
    waMessageId: resultado.waMessageId,
    enviadoPorUserId: usuario.userId,
  });

  revalidatePath("/admin/whatsapp");
  return {};
}

/**
 * Manda una plantilla aprobada.
 *
 * Es la única forma de escribirle a alguien que no responde hace más de 24 h.
 * En la base se guarda el texto ya completado, no el nombre de la plantilla
 * solo: quien lea la conversación el mes que viene tiene que ver lo que el
 * cliente leyó.
 */
export async function enviarPlantilla(
  _previo: EstadoWhatsapp,
  formData: FormData,
): Promise<EstadoWhatsapp> {
  const usuario = await requireStaff();

  const parsed = z
    .object({
      conversacionId: z.string().uuid(),
      plantilla: z.string().trim().min(1),
      idioma: z.string().trim().min(2).max(10).default("es_AR"),
      variables: z.array(z.string().trim().max(200)).max(10),
    })
    .safeParse({
      conversacionId: formData.get("conversacionId"),
      plantilla: formData.get("plantilla"),
      idioma: formData.get("idioma") || "es_AR",
      variables: formData.getAll("variable").map(String),
    });

  if (!parsed.success) {
    return { error: "Revisá los datos de la plantilla." };
  }

  const [conversacion] = await db
    .select()
    .from(conversaciones)
    .where(eq(conversaciones.id, parsed.data.conversacionId))
    .limit(1);

  if (!conversacion) return { error: "No encontramos esa conversación." };

  const definicion = plantillaBase(parsed.data.plantilla);

  if (definicion && parsed.data.variables.some((v) => !v.trim())) {
    return { error: "Completá todos los datos de la plantilla." };
  }

  const resultado = await proveedorWhatsapp().enviarPlantilla(
    conversacion.waJid,
    {
      nombre: parsed.data.plantilla,
      idioma: parsed.data.idioma,
      variables: parsed.data.variables,
    },
  );

  if (resultado.error) return { error: resultado.error };

  await registrarSaliente({
    conversacionId: conversacion.id,
    cuerpo: definicion
      ? previsualizar(definicion.cuerpo, parsed.data.variables)
      : `[${parsed.data.plantilla}]`,
    waMessageId: resultado.waMessageId,
    plantilla: parsed.data.plantilla,
    enviadoPorUserId: usuario.userId,
  });

  revalidatePath("/admin/whatsapp");
  return { ok: "Mensaje enviado." };
}

/** Pone en cero los no leídos al abrir la conversación. */
export async function marcarLeida(conversacionId: string): Promise<void> {
  await requireStaff();

  await db
    .update(conversaciones)
    .set({ noLeidos: 0, updatedAt: new Date() })
    .where(eq(conversaciones.id, conversacionId));

  revalidatePath("/admin/whatsapp");
}

/** Archiva o reabre una conversación. */
export async function cambiarEstadoConversacion(
  _previo: EstadoWhatsapp,
  formData: FormData,
): Promise<EstadoWhatsapp> {
  await requireStaff();

  const parsed = z
    .object({
      conversacionId: z.string().uuid(),
      estado: z.enum(["abierta", "cerrada"]),
    })
    .safeParse({
      conversacionId: formData.get("conversacionId"),
      estado: formData.get("estado"),
    });

  if (!parsed.success) return { error: "No pudimos cambiar el estado." };

  await db
    .update(conversaciones)
    .set({
      estado: parsed.data.estado,
      noLeidos: 0,
      updatedAt: new Date(),
    })
    .where(eq(conversaciones.id, parsed.data.conversacionId));

  revalidatePath("/admin/whatsapp");

  return {
    ok:
      parsed.data.estado === "cerrada"
        ? "Conversación archivada."
        : "Conversación reabierta.",
  };
}

/** Vincula la conversación con una ficha de cliente, a mano. */
export async function vincularCliente(
  _previo: EstadoWhatsapp,
  formData: FormData,
): Promise<EstadoWhatsapp> {
  await requireStaff();

  const parsed = z
    .object({
      conversacionId: z.string().uuid(),
      customerId: z.string().uuid().nullish(),
    })
    .safeParse({
      conversacionId: formData.get("conversacionId"),
      customerId: (formData.get("customerId") as string) || null,
    });

  if (!parsed.success) return { error: "No pudimos vincular el cliente." };

  await db
    .update(conversaciones)
    .set({
      customerId: parsed.data.customerId ?? null,
      updatedAt: new Date(),
    })
    .where(eq(conversaciones.id, parsed.data.conversacionId));

  revalidatePath("/admin/whatsapp");
  return { ok: "Listo, quedó vinculada." };
}

/** Empieza una conversación con un número que todavía no escribió. */
export async function abrirConversacion(
  _previo: EstadoWhatsapp,
  formData: FormData,
): Promise<EstadoWhatsapp> {
  await requireStaff();

  const telefono = z
    .string()
    .trim()
    .min(6, "Escribí un número.")
    .safeParse(formData.get("telefono"));

  if (!telefono.success) return { error: "Escribí un número válido." };

  const waJid = aJid(telefono.data);
  if (!waJid) {
    return { error: "Ese número no parece válido. Probá con el código de área." };
  }

  await conversacionDe(waJid);
  revalidatePath("/admin/whatsapp");

  return { ok: "Conversación abierta." };
}

/**
 * Simula que un cliente escribe. Solo en modo demostración.
 *
 * Sin WABA no hay mensajes entrantes de verdad, y una bandeja donde nunca entra
 * nada no se puede probar ni mostrar. Esto inyecta un entrante por el mismo
 * camino que usaría el webhook, así lo que se ve es el comportamiento real y no
 * una pantalla de ejemplo.
 */
export async function simularEntrante(
  _previo: EstadoWhatsapp,
  formData: FormData,
): Promise<EstadoWhatsapp> {
  await requireStaff();

  if (proveedorWhatsapp().id !== "demo") {
    return { error: "Esto solo se puede hacer en modo demostración." };
  }

  const parsed = z
    .object({
      conversacionId: z.string().uuid(),
      cuerpo: z.string().trim().min(1).max(MAX_MENSAJE),
    })
    .safeParse({
      conversacionId: formData.get("conversacionId"),
      cuerpo: formData.get("cuerpo"),
    });

  if (!parsed.success) return { error: "Escribí el mensaje a simular." };

  const [conversacion] = await db
    .select({ waJid: conversaciones.waJid })
    .from(conversaciones)
    .where(eq(conversaciones.id, parsed.data.conversacionId))
    .limit(1);

  if (!conversacion) return { error: "No encontramos esa conversación." };

  await ingresarEntrante({
    waJid: conversacion.waJid,
    cuerpo: parsed.data.cuerpo,
    waMessageId: `demo-in-${Date.now()}`,
    timestamp: Date.now(),
  });

  revalidatePath("/admin/whatsapp");
  return {};
}
