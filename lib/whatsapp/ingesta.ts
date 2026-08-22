import "server-only";

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  conversaciones,
  customers,
  mensajes,
  orders,
  sesionWhatsapp,
} from "@/lib/db/schema";
import { aTelefono } from "./config";
import type { MensajeEntrante } from "./tipos";

/**
 * Entrada de mensajes a la bandeja.
 *
 * Todo lo que llega por el webhook es dato de un tercero y se valida antes de
 * tocar la base: tamaños acotados, tipos verificados y nada de HTML que después
 * termine renderizado. El texto entra como texto.
 */

const MAX_CUERPO = 8000;

const entranteSchema = z.object({
  waJid: z.string().trim().min(6).max(100),
  displayName: z.string().trim().max(120).nullish(),
  cuerpo: z.string().max(MAX_CUERPO),
  waMessageId: z.string().trim().max(160).nullish(),
  timestamp: z.number().int().positive().nullish(),
  media: z
    .object({
      url: z.string().max(1000),
      tipo: z.enum(["image", "document", "video", "audio", "sticker"]),
      mime: z.string().max(120).nullish(),
      nombre: z.string().max(200).nullish(),
    })
    .nullish(),
});

/**
 * Limpia el texto que llega de afuera.
 *
 * Se descartan los caracteres de control, que rompen el renderizado y sirven
 * para disimular contenido, y se recorta el largo. No se escapa HTML acá:
 * React ya escapa al renderizar, y hacerlo dos veces dejaría un "&amp;" a la
 * vista en un mensaje que el cliente escribió con un "&".
 */
function limpiar(texto: string): string {
  let salida = "";

  for (const caracter of texto) {
    const codigo = caracter.codePointAt(0) ?? 0;
    // El salto de línea y la tabulación se conservan: son parte del mensaje.
    if (caracter === "\n" || caracter === "\t") {
      salida += caracter;
      continue;
    }
    if (codigo > 0x1f && codigo !== 0x7f) salida += caracter;
  }

  return salida.slice(0, MAX_CUERPO);
}

/** Resumen del mensaje para la lista de conversaciones. */
function preview(cuerpo: string, tieneMedia: boolean): string {
  const texto = cuerpo.trim();
  if (texto) return texto.slice(0, 120);
  return tieneMedia ? "Archivo adjunto" : "";
}

/**
 * Busca la ficha de cliente que corresponde a un número.
 *
 * Los teléfonos de la base están tipeados a mano y de mil formas: "223
 * 590-3118", "(0223) 474-3328", "+5492235903118". Comparar los últimos ocho
 * dígitos es lo que hace que un mismo número escrito de dos maneras distintas
 * sea reconocido igual.
 */
export async function clientePorTelefono(waJid: string) {
  const digitos = aTelefono(waJid);
  if (digitos.length < 8) return null;

  const ultimos = digitos.slice(-8);

  const [cliente] = await db
    .select({ id: customers.id, nombre: customers.nombre })
    .from(customers)
    .where(
      and(
        eq(customers.active, true),
        sql`right(regexp_replace(coalesce(${customers.telefono}, ''), '\\D', '', 'g'), 8) = ${ultimos}`,
      ),
    )
    .limit(1);

  return cliente ?? null;
}

/** Último pedido abierto del cliente, para mostrarlo al costado de la charla. */
async function pedidoAbierto(customerId: string) {
  const [pedido] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.customerId, customerId),
        sql`${orders.estado} not in ('entregado', 'cancelado')`,
      ),
    )
    .orderBy(desc(orders.createdAt))
    .limit(1);

  return pedido?.id ?? null;
}

/**
 * Devuelve la conversación de un número, creándola si es la primera vez.
 *
 * Al crearla se intenta identificar al cliente por su teléfono: si aparece, la
 * charla nace ya vinculada a su ficha y a su pedido abierto, que es lo que hace
 * que quien atiende no tenga que ir a buscar nada.
 */
export async function conversacionDe(
  waJid: string,
  displayName?: string | null,
) {
  const [existente] = await db
    .select()
    .from(conversaciones)
    .where(eq(conversaciones.waJid, waJid))
    .limit(1);

  if (existente) {
    // Si la conversación estaba sin cliente y desde entonces se cargó una ficha
    // con ese teléfono, se vincula ahora.
    if (!existente.customerId) {
      const cliente = await clientePorTelefono(waJid);
      if (cliente) {
        const [actualizada] = await db
          .update(conversaciones)
          .set({
            customerId: cliente.id,
            orderId: await pedidoAbierto(cliente.id),
            updatedAt: new Date(),
          })
          .where(eq(conversaciones.id, existente.id))
          .returning();
        return actualizada;
      }
    }
    return existente;
  }

  const cliente = await clientePorTelefono(waJid);

  const [creada] = await db
    .insert(conversaciones)
    .values({
      waJid,
      displayName: displayName ?? cliente?.nombre ?? null,
      customerId: cliente?.id ?? null,
      orderId: cliente ? await pedidoAbierto(cliente.id) : null,
    })
    .returning();

  return creada;
}

/**
 * Guarda un mensaje entrante.
 *
 * Devuelve null cuando el mensaje ya estaba: Meta reintenta el webhook si no le
 * contestás rápido, y sin el corte por `waMessageId` la misma consulta del
 * cliente aparecería dos o tres veces en la bandeja.
 */
export async function ingresarEntrante(entrada: MensajeEntrante) {
  const parsed = entranteSchema.safeParse(entrada);

  if (!parsed.success) {
    console.warn(
      JSON.stringify({
        scope: "whatsapp.ingesta",
        evento: "payload_invalido",
        detalle: parsed.error.issues[0]?.message,
      }),
    );
    return null;
  }

  const datos = parsed.data;

  if (datos.waMessageId) {
    const [repetido] = await db
      .select({ id: mensajes.id })
      .from(mensajes)
      .where(eq(mensajes.waMessageId, datos.waMessageId))
      .limit(1);

    if (repetido) return null;
  }

  const conversacion = await conversacionDe(datos.waJid, datos.displayName);
  const cuerpo = limpiar(datos.cuerpo);
  const ocurrido = datos.timestamp ? new Date(datos.timestamp) : new Date();

  const [mensaje] = await db
    .insert(mensajes)
    .values({
      conversacionId: conversacion.id,
      direccion: "entrante",
      waMessageId: datos.waMessageId ?? null,
      cuerpo,
      mediaUrl: datos.media?.url ?? null,
      mediaTipo: datos.media?.tipo ?? null,
      mediaMime: datos.media?.mime ?? null,
      mediaNombre: datos.media?.nombre ?? null,
      estado: "entregado",
      ocurridoAt: ocurrido,
    })
    .returning();

  await db
    .update(conversaciones)
    .set({
      displayName: datos.displayName ?? conversacion.displayName,
      ultimoMensajeAt: ocurrido,
      ultimoMensajePreview: preview(cuerpo, Boolean(datos.media)),
      // Reabre la ventana de 24 h para poder contestar con texto libre.
      ultimoEntranteAt: ocurrido,
      noLeidos: sql`${conversaciones.noLeidos} + 1`,
      // Un mensaje nuevo reabre una conversación cerrada: el cliente volvió.
      estado: "abierta",
      updatedAt: new Date(),
    })
    .where(eq(conversaciones.id, conversacion.id));

  await registrarSenal();

  return mensaje;
}

/** Deja constancia de un mensaje que sale, ya enviado por el proveedor. */
export async function registrarSaliente(opciones: {
  conversacionId: string;
  cuerpo: string;
  waMessageId?: string | null;
  media?: {
    url: string;
    tipo: "image" | "document" | "video" | "audio";
    mime?: string | null;
    nombre?: string | null;
  } | null;
  plantilla?: string | null;
  enviadoPorUserId?: string | null;
  estado?: "pendiente" | "enviado" | "fallido";
}) {
  const cuerpo = limpiar(opciones.cuerpo);

  const [mensaje] = await db
    .insert(mensajes)
    .values({
      conversacionId: opciones.conversacionId,
      direccion: "saliente",
      waMessageId: opciones.waMessageId ?? null,
      cuerpo,
      mediaUrl: opciones.media?.url ?? null,
      mediaTipo: opciones.media?.tipo ?? null,
      mediaMime: opciones.media?.mime ?? null,
      mediaNombre: opciones.media?.nombre ?? null,
      plantilla: opciones.plantilla ?? null,
      enviadoPorUserId: opciones.enviadoPorUserId ?? null,
      estado: opciones.estado ?? "enviado",
    })
    .returning();

  await db
    .update(conversaciones)
    .set({
      ultimoMensajeAt: new Date(),
      ultimoMensajePreview: preview(cuerpo, Boolean(opciones.media)),
      updatedAt: new Date(),
    })
    .where(eq(conversaciones.id, opciones.conversacionId));

  return mensaje;
}

/**
 * Estados de entrega, del primero al último.
 *
 * El orden importa: los callbacks de Meta llegan por HTTP y pueden hacerlo
 * desordenados, así que un "entregado" que llega tarde no puede pisar un
 * "leído" que ya estaba.
 */
const ORDEN_ESTADOS = ["pendiente", "enviado", "entregado", "leido"] as const;

export async function actualizarEstadoMensaje(
  waMessageId: string,
  nuevo: "enviado" | "entregado" | "leido" | "fallido",
) {
  const [actual] = await db
    .select({ id: mensajes.id, estado: mensajes.estado })
    .from(mensajes)
    .where(eq(mensajes.waMessageId, waMessageId))
    .limit(1);

  if (!actual) return;

  if (nuevo !== "fallido") {
    const indiceActual = ORDEN_ESTADOS.indexOf(
      actual.estado as (typeof ORDEN_ESTADOS)[number],
    );
    const indiceNuevo = ORDEN_ESTADOS.indexOf(nuevo);
    if (indiceActual >= indiceNuevo) return;
  }

  await db
    .update(mensajes)
    .set({ estado: nuevo })
    .where(eq(mensajes.id, actual.id));
}

/** Marca que hubo actividad, para poder mostrar desde cuándo no entra nada. */
export async function registrarSenal() {
  const [fila] = await db
    .select({ id: sesionWhatsapp.id })
    .from(sesionWhatsapp)
    .limit(1);

  if (fila) {
    await db
      .update(sesionWhatsapp)
      .set({ ultimaSenal: new Date(), updatedAt: new Date() })
      .where(eq(sesionWhatsapp.id, fila.id));
  } else {
    await db.insert(sesionWhatsapp).values({ ultimaSenal: new Date() });
  }
}

/** Conversaciones sin cliente asignado, para el aviso de la bandeja. */
export async function conversacionesSinCliente() {
  const [fila] = await db
    .select({ total: sql<number>`count(*)` })
    .from(conversaciones)
    .where(isNull(conversaciones.customerId));

  return Number(fila?.total ?? 0);
}
