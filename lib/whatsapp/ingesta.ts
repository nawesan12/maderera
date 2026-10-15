import "server-only";

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversaciones, customers, mensajes, orders, sesionWhatsapp } from "@/lib/db/schema";
import { jidDeWaId, mismoNumero, numeroNacional, sinNumero, waIdDeJid } from "./numeros";
import { explicarError } from "./errores";
import type { ContactoDeLaApp, EstadoDeMeta, MensajeDeMeta, ParteDeHistorial } from "./payload";

/**
 * La entrada a la bandeja: mensajes, estados y conversaciones.
 *
 * Todo lo que llega por el webhook es dato de un tercero y se trata como tal:
 * tamaños acotados, caracteres de control afuera y nada de HTML que después
 * termine renderizado. El texto entra como texto.
 */

const MAX_CUERPO = 8000;

/**
 * Limpia el texto que llega de afuera.
 *
 * Se descartan los caracteres de control, que rompen el renderizado y sirven
 * para disimular contenido, y se recorta el largo. No se escapa HTML acá:
 * React ya escapa al renderizar, y hacerlo dos veces dejaría un «&amp;» a la
 * vista en un mensaje que el cliente escribió con un «&».
 */
export function limpiar(texto: string): string {
  let salida = "";
  for (const caracter of texto) {
    const codigo = caracter.codePointAt(0) ?? 0;
    if (caracter === "\n" || caracter === "\t") {
      salida += caracter;
      continue;
    }
    if (codigo > 0x1f && codigo !== 0x7f) salida += caracter;
  }
  return salida.slice(0, MAX_CUERPO);
}

const RESUMEN_DE_TIPO: Record<string, string> = {
  image: "📷 Foto",
  video: "🎥 Video",
  audio: "🎤 Audio",
  document: "📄 Documento",
  sticker: "Sticker",
  location: "📍 Ubicación",
  contacts: "👤 Contacto",
};

/** Resumen del mensaje para la lista de conversaciones. */
export function resumen(cuerpo: string, tipo: string): string {
  const texto = cuerpo.trim().replace(/\s+/g, " ");
  const prefijo = RESUMEN_DE_TIPO[tipo];
  if (prefijo && texto && tipo !== "location" && tipo !== "contacts") return `${prefijo}: ${texto}`.slice(0, 120);
  if (texto) return texto.slice(0, 120);
  return prefijo ?? "Mensaje";
}

/**
 * La ficha de cliente que corresponde a un número.
 *
 * Los teléfonos de la base están tipeados a mano y de mil formas. Se buscan
 * candidatos por los últimos siete dígitos —que no cambian con el 0, el 15 ni
 * el 9— y después se comparan **números completos** con `mismoNumero`. Antes
 * se comparaban solo los últimos ocho, y un 011 y un 0223 con el mismo final
 * eran el mismo cliente.
 */
export async function clientePorTelefono(waJid: string) {
  const waId = waIdDeJid(waJid);
  const nacional = numeroNacional(`+${waId}`);
  if (!nacional) return null;

  const candidatos = await db
    .select({ id: customers.id, nombre: customers.nombre, telefono: customers.telefono })
    .from(customers)
    .where(
      and(
        eq(customers.active, true),
        sql`right(regexp_replace(coalesce(${customers.telefono}, ''), '\\D', '', 'g'), 7) = ${nacional.slice(-7)}`,
      ),
    )
    .limit(20);

  const cliente = candidatos.find((c) => c.telefono && mismoNumero(c.telefono, `+${waId}`));
  return cliente ? { id: cliente.id, nombre: cliente.nombre } : null;
}

/** Último pedido abierto del cliente, para mostrarlo al costado de la charla. */
async function pedidoAbierto(customerId: string) {
  const [pedido] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.customerId, customerId), sql`${orders.estado} not in ('entregado', 'cancelado')`))
    .orderBy(desc(orders.createdAt))
    .limit(1);

  return pedido?.id ?? null;
}

/**
 * La conversación de un número, creándola si es la primera vez.
 *
 * Al crearla se intenta identificar al cliente por su teléfono: si aparece, la
 * charla nace vinculada a su ficha y a su pedido abierto. Dos webhooks del
 * mismo número nuevo pueden llegar juntos —Meta manda en paralelo—, así que el
 * alta va con `on conflict` sobre el número y nunca crea dos.
 */
export async function conversacionDe(waJid: string, displayName?: string | null, usuarioMetaId?: string | null) {
  let [existente] = await db.select().from(conversaciones).where(eq(conversaciones.waJid, waJid)).limit(1);

  // La misma persona pudo haber escrito antes sin número (solo BSUID) y ahora
  // con él, o al revés: se busca también por el BSUID para no partirla en dos.
  if (!existente && usuarioMetaId) {
    [existente] = await db
      .select()
      .from(conversaciones)
      .where(eq(conversaciones.usuarioMetaId, usuarioMetaId))
      .limit(1);
    if (existente && !sinNumero(waJid) && sinNumero(existente.waJid)) {
      [existente] = await db
        .update(conversaciones)
        .set({ waJid, updatedAt: new Date() })
        .where(eq(conversaciones.id, existente.id))
        .returning();
    }
  }

  if (existente && usuarioMetaId && !existente.usuarioMetaId) {
    [existente] = await db
      .update(conversaciones)
      .set({ usuarioMetaId })
      .where(eq(conversaciones.id, existente.id))
      .returning();
  }

  if (existente) {
    if (!existente.customerId && !sinNumero(existente.waJid)) {
      const cliente = await clientePorTelefono(waJid);
      if (cliente) {
        const [actualizada] = await db
          .update(conversaciones)
          .set({ customerId: cliente.id, orderId: await pedidoAbierto(cliente.id), updatedAt: new Date() })
          .where(eq(conversaciones.id, existente.id))
          .returning();
        return actualizada;
      }
    }
    return existente;
  }

  const cliente = sinNumero(waJid) ? null : await clientePorTelefono(waJid);

  const [creada] = await db
    .insert(conversaciones)
    .values({
      waJid,
      usuarioMetaId: usuarioMetaId ?? null,
      displayName: displayName ?? cliente?.nombre ?? null,
      customerId: cliente?.id ?? null,
      orderId: cliente ? await pedidoAbierto(cliente.id) : null,
    })
    .onConflictDoNothing({ target: conversaciones.waJid })
    .returning();

  if (creada) return creada;

  const [ganadora] = await db.select().from(conversaciones).where(eq(conversaciones.waJid, waJid)).limit(1);
  return ganadora!;
}

export interface EntranteGuardado {
  mensajeId: string;
  conversacionId: string;
  /** Si trae un adjunto para bajar. */
  mediaId: string | null;
  /** El texto, para decidir si es una baja. */
  cuerpo: string;
  nombre: string;
  /** Si la conversación es de alguien que ya está asignado a una persona. */
  asignadoA: string | null;
}

/**
 * Guarda un mensaje entrante. Devuelve null si ya estaba.
 *
 * El corte por repetido es el índice único de `waMessageId` y no una consulta
 * previa: Meta reintenta, y dos entregas del mismo mensaje procesadas a la vez
 * pasarían las dos una consulta de «¿ya existe?». Con `on conflict do nothing`
 * la segunda no inserta nada, sin carrera posible.
 */
export async function ingresarEntrante(
  m: MensajeDeMeta & { waJid: string },
): Promise<EntranteGuardado | null> {
  const ocurrido = m.ocurrido ? new Date(m.ocurrido) : new Date();
  const conversacion = await conversacionDe(
    m.waJid,
    m.nombrePerfil ? limpiar(m.nombrePerfil).slice(0, 120) : null,
    m.usuarioMeta,
  );

  // Una reacción no es un mensaje nuevo: va sobre el que reaccionó.
  if (m.tipo === "reaction" && m.reaccion) {
    await db
      .update(mensajes)
      .set({ reaccionCliente: m.reaccion.emoji || null })
      .where(and(eq(mensajes.waMessageId, m.reaccion.aMensaje), eq(mensajes.conversacionId, conversacion.id)));
    await registrarSenal();
    return null;
  }

  const cuerpo = limpiar(m.texto);

  const [mensaje] = await db
    .insert(mensajes)
    .values({
      conversacionId: conversacion.id,
      direccion: "entrante",
      waMessageId: m.waMessageId,
      tipo: m.tipo,
      cuerpo,
      mediaTipo: m.media?.tipo ?? null,
      mediaMime: m.media?.mime ?? null,
      mediaNombre: m.media?.nombre ? limpiar(m.media.nombre).slice(0, 200) : null,
      mediaId: m.media?.id ?? null,
      mediaEstado: m.media ? "pendiente" : null,
      citadoWaMessageId: m.citado,
      datos: m.datos,
      estado: "entregado",
      origen: "cliente",
      ocurridoAt: ocurrido,
    })
    .onConflictDoNothing({ target: mensajes.waMessageId })
    .returning({ id: mensajes.id });

  if (!mensaje) return null;

  const [actualizada] = await db
    .update(conversaciones)
    .set({
      displayName: m.nombrePerfil ? limpiar(m.nombrePerfil).slice(0, 120) : conversacion.displayName,
      ultimoMensajeAt: ocurrido,
      ultimoMensajePreview: resumen(cuerpo, m.tipo),
      // Reabre la ventana de 24 h para poder contestar con texto libre. Con
      // `greatest` para que un mensaje viejo que llega tarde no la acorte.
      ultimoEntranteAt: sql`greatest(${conversaciones.ultimoEntranteAt}, ${ocurrido.toISOString()}::timestamptz)`,
      noLeidos: sql`${conversaciones.noLeidos} + 1`,
      // Un mensaje nuevo reabre una conversación resuelta: el cliente volvió.
      estado: "abierta",
      resueltaAt: null,
      resueltaPorUserId: null,
      updatedAt: new Date(),
    })
    .where(eq(conversaciones.id, conversacion.id))
    .returning({ displayName: conversaciones.displayName, asignado: conversaciones.asignadoAUserId });

  await registrarSenal();

  let nombre = actualizada?.displayName ?? "Cliente";
  if (conversacion.customerId) {
    const [cliente] = await db
      .select({ nombre: customers.nombre })
      .from(customers)
      .where(eq(customers.id, conversacion.customerId))
      .limit(1);
    nombre = cliente?.nombre ?? nombre;
  }

  return {
    mensajeId: mensaje.id,
    conversacionId: conversacion.id,
    mediaId: m.media?.id ?? null,
    cuerpo,
    nombre,
    asignadoA: actualizada?.asignado ?? null,
  };
}

/**
 * Lo que el negocio escribió desde la app del teléfono (coexistencia).
 *
 * Entra como saliente, con origen `telefono`, para que quien mire la bandeja
 * vea la conversación completa y no le conteste dos veces lo mismo. Tres cosas
 * que lo distinguen de un saliente de la API:
 *
 * - **No se cobra**: Meta no factura lo que sale de la app, así que va con
 *   `cobrable = false` y no suma al gasto del mes.
 * - **No abre la ventana de 24 h** ni la estira: solo un mensaje del cliente
 *   la abre (`ultimoEntranteAt` no se toca).
 * - **Quien contestó desde el teléfono ya leyó**: los no leídos vuelven a cero.
 *
 * Repetido no entra dos veces: el corte es el mismo índice único de
 * `waMessageId` que el de los entrantes.
 */
export async function registrarEco(m: MensajeDeMeta & { waJidDestino: string }): Promise<string | null> {
  const conversacion = await conversacionDe(m.waJidDestino);
  const cuerpo = limpiar(m.texto);
  const ocurrido = m.ocurrido ? new Date(m.ocurrido) : new Date();

  const [mensaje] = await db
    .insert(mensajes)
    .values({
      conversacionId: conversacion.id,
      direccion: "saliente",
      waMessageId: m.waMessageId,
      tipo: m.tipo,
      cuerpo,
      mediaTipo: m.media?.tipo ?? null,
      mediaMime: m.media?.mime ?? null,
      mediaNombre: m.media?.nombre ? limpiar(m.media.nombre).slice(0, 200) : null,
      mediaId: m.media?.id ?? null,
      mediaEstado: m.media ? "pendiente" : null,
      citadoWaMessageId: m.citado,
      datos: m.datos,
      estado: "enviado",
      origen: "telefono",
      cobrable: false,
      ocurridoAt: ocurrido,
    })
    .onConflictDoNothing({ target: mensajes.waMessageId })
    .returning({ id: mensajes.id });

  if (!mensaje) return null;

  await db
    .update(conversaciones)
    .set({
      ultimoMensajeAt: sql`greatest(${conversaciones.ultimoMensajeAt}, ${ocurrido.toISOString()}::timestamptz)`,
      ultimoMensajePreview: resumen(cuerpo, m.tipo),
      noLeidos: 0,
      updatedAt: new Date(),
    })
    .where(eq(conversaciones.id, conversacion.id));

  return mensaje.id;
}

/**
 * Un mensaje del teléfono que se editó o se borró después de mandarlo.
 *
 * Se cambia la burbuja que ya está: el cliente ve el texto nuevo, o «se
 * eliminó este mensaje», y la bandeja tiene que mostrar lo mismo.
 */
export async function aplicarCambioDeEco(cambio: {
  cambio: "editado" | "eliminado";
  original: string;
  texto: string | null;
}): Promise<boolean> {
  const [actual] = await db
    .select({ id: mensajes.id, datos: mensajes.datos })
    .from(mensajes)
    .where(eq(mensajes.waMessageId, cambio.original))
    .limit(1);
  if (!actual) return false;

  await db
    .update(mensajes)
    .set(
      cambio.cambio === "eliminado"
        ? {
            cuerpo: "Se eliminó este mensaje desde el teléfono.",
            datos: { ...(actual.datos ?? {}), eliminado: true },
          }
        : {
            ...(cambio.texto !== null ? { cuerpo: limpiar(cambio.texto) } : {}),
            datos: { ...(actual.datos ?? {}), editado: true },
          },
    )
    .where(eq(mensajes.id, actual.id));
  return true;
}

const ESTADO_DEL_HISTORIAL: Record<string, "pendiente" | "enviado" | "entregado" | "leido" | "fallido"> = {
  PENDING: "pendiente",
  SENT: "enviado",
  DELIVERED: "entregado",
  READ: "leido",
  PLAYED: "leido",
  ERROR: "fallido",
};

/**
 * Importa una parte del historial de la app del teléfono.
 *
 * Al conectar el número en coexistencia Meta manda hasta seis meses de chats,
 * en partes que pueden llegar desordenadas y repetidas. Cada mensaje entra con
 * su id de WhatsApp —el mismo índice único corta lo repetido— y con
 * `importado = true`. Lo importado es pasado: **no avisa a nadie** (ni push ni
 * BAJA), no suma no leídos, no reabre conversaciones resueltas y no abre la
 * ventana de 24 h (la abre solo un mensaje nuevo del cliente por la API). Lo
 * que el negocio escribió desde la app entra como saliente del teléfono, sin
 * cobro.
 *
 * Cada hilo va en una transacción: el aviso en vivo a la bandeja (los
 * triggers de `0074_vivo`) sale una vez por conversación y no una por mensaje.
 *
 * @returns cuántos mensajes nuevos entraron.
 */
export async function importarHistorial(parte: ParteDeHistorial): Promise<number> {
  let nuevos = 0;

  for (const hilo of parte.hilos) {
    if (hilo.mensajes.length === 0) continue;
    const waJid = jidDeWaId(hilo.waId);
    const conversacion = await conversacionDe(waJid);

    const insertados = await db.transaction(async (tx) => {
      const filas: {
        id: string;
        ocurridoAt: Date;
        cuerpo: string;
        tipo: string;
      }[] = [];
      // De a 500: un hilo de seis meses puede pasar el tope de parámetros de Postgres.
      for (let i = 0; i < hilo.mensajes.length; i += 500) {
        const tanda = await tx
          .insert(mensajes)
          .values(
            hilo.mensajes.slice(i, i + 500).map((m) => ({
              conversacionId: conversacion.id,
              direccion: m.delNegocio ? ("saliente" as const) : ("entrante" as const),
              waMessageId: m.waMessageId,
              tipo: m.tipo,
              cuerpo: limpiar(m.texto),
              mediaTipo: m.media?.tipo ?? null,
              mediaMime: m.media?.mime ?? null,
              mediaNombre: m.media?.nombre ? limpiar(m.media.nombre).slice(0, 200) : null,
              mediaId: m.media?.id ?? null,
              mediaEstado: m.media ? "pendiente" : null,
              citadoWaMessageId: m.citado,
              datos: m.datos,
              estado: m.delNegocio
                ? (ESTADO_DEL_HISTORIAL[m.estadoHistorial ?? ""] ?? "enviado")
                : ("entregado" as const),
              origen: m.delNegocio ? "telefono" : "cliente",
              cobrable: m.delNegocio ? false : null,
              importado: true,
              ocurridoAt: m.ocurrido ? new Date(m.ocurrido) : new Date(),
            })),
          )
          .onConflictDoNothing({ target: mensajes.waMessageId })
          .returning({
            id: mensajes.id,
            ocurridoAt: mensajes.ocurridoAt,
            cuerpo: mensajes.cuerpo,
            tipo: mensajes.tipo,
          });
        filas.push(...tanda);
      }

      // El último mensaje de la charla, si lo importado es más nuevo que lo que había.
      const ultimo = filas.reduce<(typeof filas)[number] | null>(
        (a, f) => (!a || f.ocurridoAt > a.ocurridoAt ? f : a),
        null,
      );
      if (ultimo) {
        await tx
          .update(conversaciones)
          .set({
            ultimoMensajePreview: sql`case when ${conversaciones.ultimoMensajeAt} is null or ${conversaciones.ultimoMensajeAt} < ${ultimo.ocurridoAt.toISOString()}::timestamptz then ${resumen(ultimo.cuerpo, ultimo.tipo)} else ${conversaciones.ultimoMensajePreview} end`,
            ultimoMensajeAt: sql`greatest(${conversaciones.ultimoMensajeAt}, ${ultimo.ocurridoAt.toISOString()}::timestamptz)`,
          })
          .where(eq(conversaciones.id, conversacion.id));
      }
      return filas.length;
    });
    nuevos += insertados;
  }

  return nuevos;
}

/**
 * Los adjuntos del historial, que Meta manda después y aparte.
 *
 * En el historial un archivo viene como `media_placeholder`; si es de las
 * últimas dos semanas, llega otro payload con el mismo id y el adjunto de
 * verdad. Se completa la burbuja que ya está y se devuelven los ids para
 * bajarlos.
 */
export async function completarMediosDelHistorial(lista: MensajeDeMeta[]): Promise<string[]> {
  const completados: string[] = [];
  for (const m of lista) {
    if (!m.media) continue;
    const [fila] = await db
      .update(mensajes)
      .set({
        tipo: m.tipo,
        ...(m.texto ? { cuerpo: limpiar(m.texto) } : { cuerpo: "" }),
        mediaTipo: m.media.tipo,
        mediaMime: m.media.mime,
        mediaNombre: m.media.nombre ? limpiar(m.media.nombre).slice(0, 200) : null,
        mediaId: m.media.id,
        mediaEstado: "pendiente",
      })
      .where(and(eq(mensajes.waMessageId, m.waMessageId), eq(mensajes.importado, true), isNull(mensajes.mediaUrl)))
      .returning({ id: mensajes.id, conversacionId: mensajes.conversacionId, cuerpo: mensajes.cuerpo, tipo: mensajes.tipo });
    if (!fila) continue;
    completados.push(fila.id);
    // Si la lista mostraba «un archivo que llega en un rato», ahora dice qué es.
    await db
      .update(conversaciones)
      .set({ ultimoMensajePreview: resumen(fila.cuerpo, fila.tipo) })
      .where(
        and(
          eq(conversaciones.id, fila.conversacionId),
          sql`${conversaciones.ultimoMensajePreview} like '(Un archivo del historial%'`,
        ),
      );
  }
  return completados;
}

/**
 * Los contactos de la agenda de la app del teléfono.
 *
 * Sirven para ponerle nombre a una conversación que no lo tiene —alguien que
 * todavía no escribió por la API y del que solo se conoce el número—, que es
 * como el personal lo tiene agendado. No se crean conversaciones ni fichas: la
 * ficha se encuentra sola por el teléfono (`clientePorTelefono`), y una agenda
 * de 2.000 contactos no son 2.000 clientes. Las bajas de la agenda se ignoran.
 *
 * @returns cuántas conversaciones quedaron con nombre.
 */
export async function sincronizarContactos(contactos: ContactoDeLaApp[]): Promise<number> {
  let nombradas = 0;
  for (const c of contactos) {
    if (c.accion !== "add" || !c.nombre?.trim()) continue;
    const waJid = jidDeWaId(c.telefono);
    const actualizadas = await db
      .update(conversaciones)
      .set({ displayName: limpiar(c.nombre).slice(0, 120) })
      .where(and(eq(conversaciones.waJid, waJid), isNull(conversaciones.displayName)))
      .returning({ id: conversaciones.id });
    nombradas += actualizadas.length;
  }
  return nombradas;
}

/**
 * Estados de entrega, del primero al último.
 *
 * Los avisos de Meta llegan por HTTP y pueden hacerlo desordenados: un
 * «entregado» que llega tarde no puede pisar un «leído». «Fallido» pisa
 * cualquiera salvo «leído»: si el cliente lo leyó, llegó.
 */
const ORDEN_ESTADOS = ["pendiente", "enviado", "entregado", "leido"] as const;

const TRADUCCION = {
  sent: "enviado",
  delivered: "entregado",
  read: "leido",
  // La nota de voz escuchada: para la bandeja, leída.
  played: "leido",
  failed: "fallido",
} as const;

/** Aplica un estado de Meta. Devuelve false si el mensaje todavía no está en la base. */
export async function actualizarEstadoMensaje(estado: EstadoDeMeta): Promise<boolean> {
  const [actual] = await db
    .select({ id: mensajes.id, estado: mensajes.estado })
    .from(mensajes)
    .where(eq(mensajes.waMessageId, estado.waMessageId))
    .limit(1);

  if (!actual) return false;

  const nuevo = TRADUCCION[estado.estado];
  const cobro = estado.cobro
    ? { cobroCategoria: estado.cobro.categoria, cobrable: estado.cobro.cobrable }
    : {};

  if (nuevo === "fallido") {
    if (actual.estado === "leido") return true;
    await db
      .update(mensajes)
      .set({
        estado: "fallido",
        estadoAt: estado.ocurrido ? new Date(estado.ocurrido) : new Date(),
        errorCodigo: estado.error?.codigo ?? null,
        // En castellano y con qué hacer; lo que dijo Meta queda en el registro.
        errorDetalle: explicarError(estado.error?.codigo, estado.error?.detalle ?? estado.error?.titulo).texto.slice(0, 500),
        ...cobro,
      })
      .where(eq(mensajes.id, actual.id));
    return true;
  }

  const indiceActual = ORDEN_ESTADOS.indexOf(actual.estado as (typeof ORDEN_ESTADOS)[number]);
  const indiceNuevo = ORDEN_ESTADOS.indexOf(nuevo);

  // Aunque el estado no avance, el cobro se guarda: Meta lo informa en el
  // primer aviso («sent») y no siempre en los siguientes.
  if (indiceActual >= indiceNuevo) {
    if (estado.cobro) await db.update(mensajes).set(cobro).where(eq(mensajes.id, actual.id));
    return true;
  }

  await db
    .update(mensajes)
    .set({
      estado: nuevo,
      estadoAt: estado.ocurrido ? new Date(estado.ocurrido) : new Date(),
      ...cobro,
    })
    .where(eq(mensajes.id, actual.id));
  return true;
}

/** Marca que hubo actividad, para poder mostrar desde cuándo no entra nada. */
export async function registrarSenal(webhook = false) {
  const ahora = new Date();
  const cambios = webhook ? { ultimaSenal: ahora, ultimoWebhookAt: ahora, updatedAt: ahora } : { ultimaSenal: ahora, updatedAt: ahora };
  const actualizadas = await db.update(sesionWhatsapp).set(cambios).returning({ id: sesionWhatsapp.id });
  if (actualizadas.length === 0) await db.insert(sesionWhatsapp).values(cambios);
}

/** Conversaciones sin cliente asignado, para el aviso de la bandeja. */
export async function conversacionesSinCliente() {
  const [fila] = await db
    .select({ total: sql<number>`count(*)` })
    .from(conversaciones)
    .where(isNull(conversaciones.customerId));

  return Number(fila?.total ?? 0);
}
