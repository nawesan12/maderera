"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { conversaciones, customers, mensajes } from "@/lib/db/schema";
import { requireBandeja } from "@/lib/dal/admin/whatsapp";
import { registrarEnBitacora } from "@/lib/dal/admin/auditoria";
import { proveedorWhatsapp } from "@/lib/whatsapp";
import { plantillaDisponible } from "@/lib/whatsapp/catalogo";
import { aJid } from "@/lib/whatsapp/config";
import { documentoPdf, esTipoDeDocumento } from "@/lib/whatsapp/documentos";
import { enviarYRegistrar } from "@/lib/whatsapp/envio";
import { conversacionDe } from "@/lib/whatsapp/ingesta";
import { guardarMedioPrivado } from "@/lib/whatsapp/medios";
import { destinoDeJid, numeroLegible, sinNumero, waIdDeJid } from "@/lib/whatsapp/numeros";
import { armarComponentes, camposFaltantes, vistaPrevia } from "@/lib/whatsapp/plantillas";
import { ventanaAbierta } from "@/lib/whatsapp/ventana";
import { atenderEntrante, descargarMedio } from "@/lib/whatsapp/webhook";
import { crearClienteRapido } from "@/lib/clientes/alta";
import { leerDocumento, sugerirCondicionIva } from "@/lib/clientes/documento";
import type { MensajeSaliente } from "@/lib/whatsapp/tipos";

/**
 * Las acciones de la bandeja.
 *
 * Todas piden el rol de la bandeja (`requireBandeja`) y no solo ser personal:
 * una Server Action es un POST que cualquiera con sesión puede disparar, y el
 * rebote de la página no la cubre. Todo envío pasa por `enviarYRegistrar`, que
 * guarda primero y manda después: un mensaje que Meta rechaza queda en la
 * conversación como «no se envió», con el motivo y para reintentar.
 */

export interface EstadoWhatsapp {
  error?: string;
  ok?: string;
  /** Hay que usar plantilla: fuera de la ventana, o Meta lo rechazó por eso. */
  requierePlantilla?: boolean;
}

const MAX_MENSAJE = 4096;

function refrescar() {
  revalidatePath("/admin/whatsapp");
  revalidatePath("/atencion");
}

async function laConversacion(id: unknown) {
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return null;
  const [conversacion] = await db.select().from(conversaciones).where(eq(conversaciones.id, parsed.data)).limit(1);
  return conversacion ?? null;
}

/** Contesta con texto libre (dentro de la ventana), citando un mensaje si se eligió. */
export async function responder(_previo: EstadoWhatsapp, formData: FormData): Promise<EstadoWhatsapp> {
  const usuario = await requireBandeja();

  const cuerpo = z.string().trim().min(1, "Escribí algo.").max(MAX_MENSAJE, "El mensaje es demasiado largo.").safeParse(formData.get("cuerpo"));
  if (!cuerpo.success) return { error: cuerpo.error.issues[0]?.message ?? "Revisá el mensaje." };

  const conversacion = await laConversacion(formData.get("conversacionId"));
  if (!conversacion) return { error: "No encontramos esa conversación." };

  // Fuera de la ventana ni se intenta: Meta lo rechazaría (131047) y el
  // texto quedaría como fallido. Se avisa y se ofrece la plantilla; lo escrito
  // sigue en el campo.
  if (!ventanaAbierta(conversacion.ultimoEntranteAt)) {
    return {
      error: "Pasaron más de 24 horas desde su último mensaje: WhatsApp solo deja mandar un mensaje preparado.",
      requierePlantilla: true,
    };
  }

  const citado = (formData.get("citado") as string | null)?.trim() || null;

  const resultado = await enviarYRegistrar({
    conversacionId: conversacion.id,
    waJid: conversacion.waJid,
    mensaje: { tipo: "texto", cuerpo: cuerpo.data, citado },
    registro: { cuerpo: cuerpo.data, citado },
    origen: "panel",
    enviadoPorUserId: usuario.userId,
  });

  refrescar();
  if (resultado.error) {
    return { error: resultado.error.texto, requierePlantilla: resultado.error.accion === "plantilla" };
  }
  return {};
}

/**
 * Manda una plantilla aprobada.
 *
 * En la base queda el texto completado, no solo el nombre: quien lea la
 * conversación el mes que viene tiene que ver lo que el cliente leyó. Si la
 * plantilla lleva un PDF en el encabezado, se genera y se sube en el momento.
 */
export async function enviarPlantilla(_previo: EstadoWhatsapp, formData: FormData): Promise<EstadoWhatsapp> {
  const usuario = await requireBandeja();

  const conversacion = await laConversacion(formData.get("conversacionId"));
  if (!conversacion) return { error: "No encontramos esa conversación." };

  const nombre = String(formData.get("plantilla") ?? "");
  const idioma = String(formData.get("idioma") ?? "") || null;
  const plantilla = await plantillaDisponible(nombre, idioma);
  if (!plantilla) return { error: "Ese mensaje preparado no está aprobado. Elegí otro." };

  const valores: Record<string, string> = {};
  for (const campo of plantilla.campos) {
    const valor = formData.get(`v:${campo.clave}`);
    if (typeof valor === "string") valores[campo.clave] = valor.slice(0, 500);
  }
  if (camposFaltantes(plantilla, valores).length > 0) {
    return { error: "Completá todos los datos del mensaje preparado." };
  }

  let media: { id: string; nombre: string; referencia: string; bytes: number } | null = null;
  if (plantilla.encabezadoMedia === "document") {
    const elegido = String(formData.get("documento") ?? "");
    const [tipo, id] = elegido.split(":");
    if (!esTipoDeDocumento(tipo) || !id) return { error: "Este mensaje lleva un documento: elegí cuál mandar." };
    const doc = await documentoPdf({ tipo, id });
    if (!doc) return { error: "No encontramos ese documento." };
    const subido = await proveedorWhatsapp().subirMedia(doc.contenido, "application/pdf", doc.nombre);
    if (subido.error || !subido.id) return { error: subido.error?.texto ?? "No se pudo subir el PDF." };
    const guardado = await guardarMedioPrivado(doc.contenido, "application/pdf");
    media = { id: subido.id, nombre: doc.nombre, referencia: guardado.referencia, bytes: guardado.bytes };
  } else if (plantilla.encabezadoMedia) {
    return { error: "Este mensaje lleva una foto o un video en el encabezado, y eso todavía no se manda desde acá." };
  }

  const resultado = await enviarYRegistrar({
    conversacionId: conversacion.id,
    waJid: conversacion.waJid,
    mensaje: {
      tipo: "plantilla",
      nombre: plantilla.nombre,
      idioma: plantilla.idioma,
      componentes: armarComponentes(plantilla, valores, media),
    },
    registro: {
      cuerpo: vistaPrevia(plantilla, valores),
      plantilla: plantilla.nombre,
      media: media
        ? { referencia: media.referencia, tipo: "document", mime: "application/pdf", nombre: media.nombre, bytes: media.bytes, mediaId: media.id }
        : null,
    },
    origen: "panel",
    enviadoPorUserId: usuario.userId,
  });

  refrescar();
  if (resultado.error) return { error: resultado.error.texto };
  return { ok: "Mensaje enviado." };
}

/**
 * Manda un papel de la plataforma: presupuesto, factura, remito, recibo,
 * resumen de cuenta o plano de corte.
 *
 * Dentro de la ventana sale como documento con un epígrafe. Fuera de ella,
 * con la plantilla `documento_adjunto` —o `presupuesto_enviado` si es un
 * presupuesto—, que lleva el PDF en el encabezado.
 */
export async function enviarDocumento(_previo: EstadoWhatsapp, formData: FormData): Promise<EstadoWhatsapp> {
  const usuario = await requireBandeja();
  const resultado = await mandarDocumento({
    conversacionId: String(formData.get("conversacionId") ?? ""),
    tipo: String(formData.get("tipo") ?? ""),
    id: String(formData.get("id") ?? ""),
    epigrafe: String(formData.get("epigrafe") ?? "").slice(0, 1000),
    usuarioId: usuario.userId,
  });
  refrescar();
  return resultado;
}

async function mandarDocumento(opciones: {
  conversacionId: string;
  tipo: string;
  id: string;
  epigrafe: string;
  usuarioId: string;
}): Promise<EstadoWhatsapp> {
  const conversacion = await laConversacion(opciones.conversacionId);
  if (!conversacion) return { error: "No encontramos esa conversación." };
  if (!esTipoDeDocumento(opciones.tipo)) return { error: "Elegí qué documento mandar." };

  const doc = await documentoPdf({ tipo: opciones.tipo, id: opciones.id });
  if (!doc) return { error: "No encontramos ese documento." };

  const proveedor = proveedorWhatsapp();
  const subido = await proveedor.subirMedia(doc.contenido, "application/pdf", doc.nombre);
  if (subido.error || !subido.id) return { error: subido.error?.texto ?? "No se pudo subir el PDF a WhatsApp." };
  const guardado = await guardarMedioPrivado(doc.contenido, "application/pdf");
  const registroMedia = {
    referencia: guardado.referencia,
    tipo: "document" as const,
    mime: "application/pdf",
    nombre: doc.nombre,
    bytes: guardado.bytes,
    mediaId: subido.id,
  };
  const datos = { documento: { tipo: opciones.tipo, id: opciones.id } };

  let mensaje: MensajeSaliente;
  let cuerpo: string;
  let plantillaUsada: string | null = null;

  if (ventanaAbierta(conversacion.ultimoEntranteAt)) {
    cuerpo = opciones.epigrafe.trim();
    mensaje = { tipo: "media", clase: "document", media: { id: subido.id }, epigrafe: cuerpo, nombreArchivo: doc.nombre };
  } else {
    const nombre = opciones.tipo === "presupuesto" ? "presupuesto_enviado" : "documento_adjunto";
    const plantilla = (await plantillaDisponible(nombre)) ?? (await plantillaDisponible("documento_adjunto"));
    if (!plantilla) {
      return {
        error: "Pasaron más de 24 horas y la plantilla «documento_adjunto» todavía no está aprobada en Meta. Mandá primero un mensaje preparado y, cuando conteste, el PDF.",
        requierePlantilla: true,
      };
    }
    const nombreCliente = await nombreDeLaConversacion(conversacion);
    const conocidos: Record<string, string> = { nombre: nombreCliente, documento: doc.descripcion };
    const valores = Object.fromEntries(plantilla.campos.map((c) => [c.clave, conocidos[c.marcador] ?? ""]));
    if (camposFaltantes(plantilla, valores).length > 0) {
      return { error: `La plantilla «${plantilla.nombre}» pide datos que no se completan solos. Mandala desde «Mensaje preparado».` };
    }
    cuerpo = vistaPrevia(plantilla, valores);
    plantillaUsada = plantilla.nombre;
    mensaje = {
      tipo: "plantilla",
      nombre: plantilla.nombre,
      idioma: plantilla.idioma,
      componentes: armarComponentes(plantilla, valores, { id: subido.id, nombre: doc.nombre }),
    };
  }

  const resultado = await enviarYRegistrar({
    conversacionId: conversacion.id,
    waJid: conversacion.waJid,
    mensaje,
    registro: { cuerpo, media: registroMedia, plantilla: plantillaUsada, datos },
    origen: "panel",
    enviadoPorUserId: opciones.usuarioId,
  });

  if (resultado.error) return { error: resultado.error.texto };
  return { ok: `${doc.nombre} enviado.` };
}

async function nombreDeLaConversacion(conversacion: { customerId: string | null; displayName: string | null }) {
  if (conversacion.customerId) {
    const [cliente] = await db
      .select({ nombre: customers.nombre })
      .from(customers)
      .where(eq(customers.id, conversacion.customerId))
      .limit(1);
    if (cliente) return cliente.nombre.split(/\s+/)[0];
  }
  return (conversacion.displayName ?? "").split(/\s+/)[0] || "qué tal";
}

/**
 * Manda un papel desde su propia pantalla (el remito, el presupuesto…), al
 * teléfono de la ficha. Abre o reutiliza la conversación de ese número.
 */
export async function enviarDocumentoAlCliente(
  _previo: EstadoWhatsapp,
  formData: FormData,
): Promise<EstadoWhatsapp & { conversacionId?: string }> {
  const usuario = await requireBandeja();

  const tipo = String(formData.get("tipo") ?? "");
  const id = String(formData.get("id") ?? "");
  if (!esTipoDeDocumento(tipo)) return { error: "Documento desconocido." };

  const doc = await documentoPdf({ tipo, id });
  if (!doc) return { error: "No encontramos ese documento." };

  let telefono = String(formData.get("telefono") ?? "").trim() || doc.telefono;
  if (!telefono && doc.customerId) {
    const [cliente] = await db
      .select({ telefono: customers.telefono })
      .from(customers)
      .where(eq(customers.id, doc.customerId))
      .limit(1);
    telefono = cliente?.telefono ?? null;
  }
  if (!telefono) return { error: "El cliente no tiene teléfono cargado. Escribilo para mandarlo." };

  const waJid = aJid(telefono);
  if (!waJid) return { error: `«${telefono}» no parece un número de WhatsApp.` };

  const conversacion = await conversacionDe(waJid, doc.contacto);
  if (doc.customerId && !conversacion.customerId) {
    await db.update(conversaciones).set({ customerId: doc.customerId }).where(eq(conversaciones.id, conversacion.id));
  }

  const resultado = await mandarDocumento({
    conversacionId: conversacion.id,
    tipo,
    id,
    epigrafe: String(formData.get("epigrafe") ?? `Te mandamos ${doc.descripcion}.`),
    usuarioId: usuario.userId,
  });
  refrescar();
  return { ...resultado, conversacionId: conversacion.id };
}

/** Vuelve a mandar un mensaje que no salió, tal cual se había pedido. */
export async function reintentarMensaje(mensajeId: string): Promise<EstadoWhatsapp> {
  const usuario = await requireBandeja();
  if (!z.string().uuid().safeParse(mensajeId).success) return { error: "Mensaje inválido." };

  const [fila] = await db
    .select({ mensaje: mensajes, waJid: conversaciones.waJid, ultimoEntranteAt: conversaciones.ultimoEntranteAt })
    .from(mensajes)
    .innerJoin(conversaciones, eq(conversaciones.id, mensajes.conversacionId))
    .where(and(eq(mensajes.id, mensajeId), eq(mensajes.direccion, "saliente"), eq(mensajes.estado, "fallido")))
    .limit(1);
  if (!fila) return { error: "Ese mensaje ya no está para reintentar." };

  const envio = (fila.mensaje.datos as { envio?: MensajeSaliente } | null)?.envio;
  const mensaje: MensajeSaliente = envio ?? { tipo: "texto", cuerpo: fila.mensaje.cuerpo };

  if (mensaje.tipo !== "plantilla" && !ventanaAbierta(fila.ultimoEntranteAt)) {
    return { error: "Ya pasaron las 24 horas: este mensaje no se puede reintentar. Mandá un mensaje preparado.", requierePlantilla: true };
  }

  const resultado = await enviarYRegistrar({
    conversacionId: fila.mensaje.conversacionId,
    waJid: fila.waJid,
    mensaje,
    registro: { cuerpo: fila.mensaje.cuerpo },
    origen: "panel",
    enviadoPorUserId: usuario.userId,
    reintentoDe: mensajeId,
  });
  refrescar();
  return resultado.error ? { error: resultado.error.texto } : { ok: "Enviado." };
}

/** Pone (o saca) un emoji sobre un mensaje del cliente. */
export async function reaccionar(mensajeId: string, emoji: string): Promise<EstadoWhatsapp> {
  await requireBandeja();
  if (!z.string().uuid().safeParse(mensajeId).success) return { error: "Mensaje inválido." };
  const limpio = emoji.trim().slice(0, 16);

  const [fila] = await db
    .select({ waMessageId: mensajes.waMessageId, waJid: conversaciones.waJid, ultimoEntranteAt: conversaciones.ultimoEntranteAt, actual: mensajes.reaccionNuestra })
    .from(mensajes)
    .innerJoin(conversaciones, eq(conversaciones.id, mensajes.conversacionId))
    .where(eq(mensajes.id, mensajeId))
    .limit(1);
  if (!fila?.waMessageId) return { error: "A ese mensaje no se le puede reaccionar." };
  if (!ventanaAbierta(fila.ultimoEntranteAt)) return { error: "Pasaron las 24 horas: ya no se puede reaccionar." };

  // Tocar el mismo emoji lo saca, como en el teléfono.
  const nuevo = fila.actual === limpio ? "" : limpio;
  const resultado = await proveedorWhatsapp().enviar(destinoDeJid(fila.waJid), {
    tipo: "reaccion",
    aMensaje: fila.waMessageId,
    emoji: nuevo,
  });
  if (resultado.error) return { error: resultado.error.texto };

  await db.update(mensajes).set({ reaccionNuestra: nuevo || null }).where(eq(mensajes.id, mensajeId));
  refrescar();
  return {};
}

/** Vuelve a intentar bajar un adjunto que no llegó. */
export async function reintentarDescarga(mensajeId: string): Promise<EstadoWhatsapp> {
  await requireBandeja();
  if (!z.string().uuid().safeParse(mensajeId).success) return { error: "Mensaje inválido." };
  // `intento` alto: si vuelve a fallar no se encola otra vez; queda el botón.
  const resultado = await descargarMedio(mensajeId, 99);
  refrescar();
  return resultado === "listo"
    ? { ok: "Archivo descargado." }
    : { error: "WhatsApp no entregó el archivo. Si pasaron más de 7 días ya no está: pedile que lo reenvíe." };
}

/** Asigna la conversación a alguien del equipo (o la libera). */
export async function asignarConversacion(_previo: EstadoWhatsapp, formData: FormData): Promise<EstadoWhatsapp> {
  const usuario = await requireBandeja();
  const conversacion = await laConversacion(formData.get("conversacionId"));
  if (!conversacion) return { error: "No encontramos esa conversación." };

  const elegido = String(formData.get("usuarioId") ?? "");
  const usuarioId = elegido === "yo" ? usuario.userId : elegido || null;

  await db
    .update(conversaciones)
    .set({ asignadoAUserId: usuarioId, updatedAt: new Date() })
    .where(eq(conversaciones.id, conversacion.id));

  refrescar();
  return { ok: usuarioId ? "Asignada." : "Quedó sin asignar." };
}

/** Marca la conversación como resuelta, o la reabre. */
export async function cambiarEstadoConversacion(_previo: EstadoWhatsapp, formData: FormData): Promise<EstadoWhatsapp> {
  const usuario = await requireBandeja();

  const parsed = z
    .object({ conversacionId: z.string().uuid(), estado: z.enum(["abierta", "cerrada"]) })
    .safeParse({ conversacionId: formData.get("conversacionId"), estado: formData.get("estado") });
  if (!parsed.success) return { error: "No pudimos cambiar el estado." };

  const resuelta = parsed.data.estado === "cerrada";
  await db
    .update(conversaciones)
    .set({
      estado: parsed.data.estado,
      noLeidos: 0,
      resueltaAt: resuelta ? new Date() : null,
      resueltaPorUserId: resuelta ? usuario.userId : null,
      updatedAt: new Date(),
    })
    .where(eq(conversaciones.id, parsed.data.conversacionId));

  refrescar();
  return { ok: resuelta ? "Conversación resuelta." : "Conversación reabierta." };
}

/** Busca fichas para vincular una conversación sin cliente. */
export async function buscarClientesParaVincular(texto: string) {
  await requireBandeja();
  const termino = texto.trim().slice(0, 60);
  if (termino.length < 2) return [];
  const digitos = termino.replace(/\D/g, "");

  return db
    .select({ id: customers.id, nombre: customers.nombre, telefono: customers.telefono, cuit: customers.cuit })
    .from(customers)
    .where(
      and(
        eq(customers.active, true),
        or(
          ilike(customers.nombre, `%${termino}%`),
          ilike(customers.razonSocial, `%${termino}%`),
          digitos.length >= 4
            ? sql`regexp_replace(coalesce(${customers.telefono}, '') || ' ' || coalesce(${customers.cuit}, ''), '\\D', '', 'g') like ${`%${digitos}%`}`
            : sql`false`,
        ),
      ),
    )
    .limit(8);
}

/** Vincula la conversación con una ficha existente. */
export async function vincularCliente(_previo: EstadoWhatsapp, formData: FormData): Promise<EstadoWhatsapp> {
  await requireBandeja();

  const parsed = z
    .object({ conversacionId: z.string().uuid(), customerId: z.string().uuid().nullish() })
    .safeParse({
      conversacionId: formData.get("conversacionId"),
      customerId: (formData.get("customerId") as string) || null,
    });
  if (!parsed.success) return { error: "No pudimos vincular el cliente." };

  await db
    .update(conversaciones)
    .set({ customerId: parsed.data.customerId ?? null, updatedAt: new Date() })
    .where(eq(conversaciones.id, parsed.data.conversacionId));

  refrescar();
  return { ok: "Listo, quedó vinculada." };
}

/**
 * Crea la ficha del cliente desde la conversación, con el teléfono ya puesto.
 * Es el momento en que se tienen sus datos a mano: preguntó un precio y va a
 * comprar.
 */
export async function crearFichaDesdeConversacion(_previo: EstadoWhatsapp, formData: FormData): Promise<EstadoWhatsapp> {
  const usuario = await requireBandeja();
  const conversacion = await laConversacion(formData.get("conversacionId"));
  if (!conversacion) return { error: "No encontramos esa conversación." };
  if (conversacion.customerId) return { error: "Esta conversación ya tiene ficha." };

  const nombre = z.string().trim().min(2, "Escribí el nombre.").max(160).safeParse(formData.get("nombre"));
  if (!nombre.success) return { error: nombre.error.issues[0]?.message };

  const documento = leerDocumento(String(formData.get("documento") ?? ""));
  if ("error" in documento) return { error: documento.error };

  const telefono = sinNumero(conversacion.waJid) ? null : numeroLegible(conversacion.waJid);
  const cliente = await crearClienteRapido(db, {
    nombre: nombre.data,
    documento,
    condicionIva: sugerirCondicionIva(documento),
    telefono,
    rubro: (formData.get("rubro") as string) || null,
    notas: "Alta desde una conversación de WhatsApp.",
  });

  const email = z.string().trim().email().safeParse(formData.get("email"));
  if (email.success) await db.update(customers).set({ email: email.data }).where(eq(customers.id, cliente.id));

  await db
    .update(conversaciones)
    .set({ customerId: cliente.id, updatedAt: new Date() })
    .where(eq(conversaciones.id, conversacion.id));

  await registrarEnBitacora({
    sesion: usuario,
    accion: "crear",
    entidad: "cliente",
    entidadId: cliente.id,
    descripcion: `Ficha de ${cliente.nombre} creada desde WhatsApp`,
  });

  refrescar();
  return { ok: `Ficha de ${cliente.nombre} creada.` };
}

/**
 * Da de baja (o de alta) los avisos de un número desde el panel: cuando lo
 * pide por teléfono o en el mostrador. Queda quién lo cargó.
 */
export async function cambiarBaja(_previo: EstadoWhatsapp, formData: FormData): Promise<EstadoWhatsapp> {
  const usuario = await requireBandeja();
  const conversacion = await laConversacion(formData.get("conversacionId"));
  if (!conversacion) return { error: "No encontramos esa conversación." };

  const baja = formData.get("baja") === "si";
  await db
    .update(conversaciones)
    .set(
      baja
        ? { bajaAt: new Date(), bajaDetalle: `La cargó ${usuario.name} desde el panel` }
        : { bajaAt: null, bajaDetalle: null },
    )
    .where(eq(conversaciones.id, conversacion.id));

  await registrarEnBitacora({
    sesion: usuario,
    accion: "editar",
    entidad: "whatsapp",
    entidadId: conversacion.id,
    descripcion: `${baja ? "Baja" : "Alta"} de avisos por WhatsApp para ${numeroLegible(conversacion.waJid)}`,
  });

  refrescar();
  return { ok: baja ? "No va a recibir más avisos automáticos." : "Vuelve a recibir los avisos." };
}

/** Empieza una conversación con un número que todavía no escribió. */
export async function abrirConversacion(
  _previo: EstadoWhatsapp & { conversacionId?: string },
  formData: FormData,
): Promise<EstadoWhatsapp & { conversacionId?: string }> {
  await requireBandeja();

  const telefono = z.string().trim().min(6, "Escribí un número.").safeParse(formData.get("telefono"));
  if (!telefono.success) return { error: "Escribí un número válido." };

  const waJid = aJid(telefono.data);
  if (!waJid) return { error: "Ese número no parece válido. Probá con la característica: 223 590-3118." };

  const conversacion = await conversacionDe(waJid);
  refrescar();
  return { ok: "Conversación abierta.", conversacionId: conversacion.id };
}

/**
 * Simula que un cliente escribe. Solo en modo demostración.
 *
 * Sin WABA no hay mensajes entrantes de verdad, y una bandeja donde nunca
 * entra nada no se puede probar ni mostrar. Esto entra por la misma ingesta
 * que usa el webhook (incluido el «BAJA»), así lo que se ve es el
 * comportamiento real. Con el simulador de Meta conviene usar
 * `scripts/whatsapp-webhook.ts`, que además firma el payload.
 */
export async function simularEntrante(_previo: EstadoWhatsapp, formData: FormData): Promise<EstadoWhatsapp> {
  await requireBandeja();
  if (proveedorWhatsapp().id !== "demo") return { error: "Esto solo sirve en modo demostración." };

  const conversacion = await laConversacion(formData.get("conversacionId"));
  const cuerpo = z.string().trim().min(1).max(MAX_MENSAJE).safeParse(formData.get("cuerpo"));
  if (!conversacion || !cuerpo.success) return { error: "Escribí el mensaje a simular." };

  await atenderEntrante({
    de: waIdDeJid(conversacion.waJid),
    usuarioMeta: null,
    nombrePerfil: null,
    waMessageId: `demo-in-${crypto.randomUUID()}`,
    ocurrido: Date.now(),
    tipo: "text",
    tipoOriginal: "text",
    texto: cuerpo.data,
    media: null,
    citado: null,
    reaccion: null,
    datos: null,
  }, conversacion.waJid);

  refrescar();
  return {};
}
