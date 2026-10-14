import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { avisosWhatsapp, branches, customers, notificationsLog, orders } from "@/lib/db/schema";
import { sucursalPublicada, SUCURSALES } from "@/lib/sucursales";
import { proveedorWhatsapp } from "./index";
import { plantillaDisponible } from "./catalogo";
import { aJid } from "./config";
import { enviarYRegistrar } from "./envio";
import { conversacionDe } from "./ingesta";
import { guardarMedioPrivado } from "./medios";
import { armarComponentes, completar, sugerirValores, vistaPrevia } from "./plantillas";
import { decidirEnvio, ventanaAbierta } from "./ventana";

/**
 * Avisos automáticos por WhatsApp.
 *
 * Es lo que el negocio hace hoy a mano: alguien del mostrador agarra el
 * teléfono y escribe «ya está listo lo tuyo». Cuatro cuidados que no son
 * opcionales:
 *
 * 1. **Nunca frena la operación.** Si WhatsApp falla, el pedido igual avanza.
 * 2. **Nacen apagados y se prenden por tipo de aviso.** Cada uno cuesta plata:
 *    una plantilla `UTILITY` a Argentina sale USD 0,026, y desde el 1/10/2026
 *    también se cobra el mensaje común dentro de la ventana (pasado el cupo
 *    gratuito del mes). Se prende a conciencia, desde la configuración.
 * 3. **Quien pidió la baja no recibe nada.** Ni gratis ni pago.
 * 4. **Dentro de la ventana va texto libre** si hay uno cargado: entra en el
 *    cupo gratuito de servicio y se lee como un mensaje de persona. Fuera de
 *    ella, solo la plantilla aprobada.
 *
 * Todo queda en `notifications_log` con canal `whatsapp`, igual que el correo:
 * «¿le avisamos?» se contesta mirando la bitácora de avisos.
 */

/** Los avisos que existen, con su plantilla y su texto para dentro de la ventana. */
export const EVENTOS_WHATSAPP = [
  {
    evento: "pedido_recibido",
    titulo: "Cuando entra un pedido por la web",
    cuando: "Confirma que lo recibimos. El correo ya lo dice; esto es para quien no lo lee.",
    plantilla: "pedido_recibido",
    textoLibre: "Hola {{nombre}}, recibimos tu pedido {{pedido}}. Te avisamos por acá cuando esté listo.",
  },
  {
    evento: "preparando",
    titulo: "Cuando se empieza a preparar",
    cuando: "Apenas alguien mueve el pedido a Preparando.",
    plantilla: "pedido_preparando",
    textoLibre: "Hola {{nombre}}, ya estamos preparando tu pedido {{pedido}}. Te avisamos apenas esté listo.",
  },
  {
    evento: "listo",
    titulo: "Cuando queda listo",
    cuando: "El aviso que más consultas evita: el cliente sabe cuándo venir.",
    plantilla: "pedido_listo",
    textoLibre: "Hola {{nombre}}, tu pedido {{pedido}} ya está listo para retirar en {{sucursal}}.",
  },
  {
    evento: "en-camino",
    titulo: "Cuando sale el flete",
    cuando: "Solo en pedidos con envío.",
    plantilla: "pedido_en_camino",
    textoLibre: "Hola {{nombre}}, tu pedido {{pedido}} salió para la dirección de entrega.",
  },
  {
    evento: "entregado",
    titulo: "Cuando se entrega",
    cuando: "Cierra el círculo y deja la conversación abierta por si hay algo.",
    plantilla: "pedido_entregado",
    textoLibre: "Hola {{nombre}}, entregamos tu pedido {{pedido}}. Gracias por elegirnos.",
  },
  {
    evento: "presupuesto_listo",
    titulo: "Cuando se manda un presupuesto",
    cuando: "Sale con el PDF del presupuesto pegado.",
    plantilla: "presupuesto_enviado",
    textoLibre: "Hola {{nombre}}, te mandamos el presupuesto {{presupuesto}} por {{total}}. Vale hasta el {{vence}}.",
  },
  {
    evento: "recibo_emitido",
    titulo: "Cuando se registra un pago",
    cuando: "Sale con el PDF del recibo y el saldo que le queda.",
    plantilla: "recibo_emitido",
    textoLibre: "Hola {{nombre}}, registramos tu pago de {{importe}}. Te mandamos el recibo {{recibo}}; tu saldo quedó en {{saldo}}.",
  },
  {
    evento: "cheque_rechazado",
    titulo: "Cuando se rechaza un cheque",
    cuando: "No se tomó o lo rechazó el banco: el importe vuelve a la cuenta.",
    plantilla: "cheque_rechazado",
    textoLibre: "Hola {{nombre}}, el cheque {{cheque}} por {{importe}} no se pudo acreditar ({{motivo}}). El importe volvió a tu cuenta corriente.",
  },
] as const;

export type EventoWhatsapp = (typeof EVENTOS_WHATSAPP)[number]["evento"];

function log(evento: string, detalle?: string) {
  console.info(JSON.stringify({ scope: "whatsapp.avisos", evento, detalle }));
}

export interface DocumentoDelAviso {
  contenido: Uint8Array;
  nombre: string;
  /** Cómo se lo nombra en el texto: «el remito R-0001-00000452». */
  descripcion?: string;
}

/**
 * Manda un aviso por WhatsApp. No lanza nunca.
 *
 * @returns qué pasó, para quien quiera mostrarlo (el panel); los avisos
 * automáticos lo ignoran.
 */
export async function avisarPorWhatsapp(opciones: {
  evento: string;
  telefono: string | null | undefined;
  nombre: string | null | undefined;
  valores: Record<string, string>;
  documento?: (() => Promise<DocumentoDelAviso | null>) | null;
  orderId?: string | null;
  entidad?: { tipo: string; id: string } | null;
  /** Desde el panel: se manda aunque el aviso automático esté apagado. */
  forzar?: boolean;
  usuarioId?: string | null;
}): Promise<{ estado: "enviada" | "simulada" | "fallida" | "omitida"; detalle: string }> {
  const registrar = async (estado: "enviada" | "simulada" | "fallida" | "omitida", detalle: string, destinatario: string, id?: string) => {
    try {
      await db.insert(notificationsLog).values({
        canal: "whatsapp",
        evento: opciones.evento,
        destinatario,
        asunto: opciones.valores.pedido ?? opciones.valores.presupuesto ?? opciones.valores.recibo ?? null,
        entidadTipo: opciones.entidad?.tipo ?? (opciones.orderId ? "order" : null),
        entidadId: opciones.entidad?.id ?? opciones.orderId ?? null,
        estado,
        proveedorMensajeId: id ?? null,
        error: estado === "enviada" || estado === "simulada" ? null : detalle,
      });
    } catch {
      // La bitácora de avisos es un extra: no voltea nada.
    }
    return { estado, detalle };
  };

  try {
    const [aviso] = await db.select().from(avisosWhatsapp).where(eq(avisosWhatsapp.evento, opciones.evento)).limit(1);
    const activo = opciones.forzar || Boolean(aviso?.activo);
    if (!activo) return { estado: "omitida", detalle: "El aviso está apagado." };

    if (!opciones.telefono) return registrar("omitida", "Sin teléfono en la ficha ni en el pedido.", "-");
    const waJid = aJid(opciones.telefono);
    if (!waJid) return registrar("omitida", `Teléfono que no se entiende: «${opciones.telefono}».`, opciones.telefono);

    const primerNombre = (opciones.nombre ?? "").trim().split(/\s+/)[0] || "";
    const valores = { nombre: primerNombre || "qué tal", ...opciones.valores };

    const conversacion = await conversacionDe(waJid, opciones.nombre || null);
    if (opciones.orderId && !conversacion.orderId) {
      const { conversaciones } = await import("@/lib/db/schema");
      await db
        .update(conversaciones)
        .set({ orderId: opciones.orderId, updatedAt: new Date() })
        .where(eq(conversaciones.id, conversacion.id));
    }

    const nombrePlantilla = aviso?.plantilla ?? EVENTOS_WHATSAPP.find((e) => e.evento === opciones.evento)?.plantilla;
    const plantilla = nombrePlantilla ? await plantillaDisponible(nombrePlantilla, aviso?.idioma) : null;
    const abierta = ventanaAbierta(conversacion.ultimoEntranteAt);

    const decision = decidirEnvio({
      activo,
      baja: Boolean(conversacion.bajaAt),
      ventanaAbierta: abierta,
      hayTextoLibre: Boolean(aviso?.textoLibre?.trim()),
      hayPlantilla: Boolean(plantilla),
    });

    if (decision.como === "omitir") {
      const motivo =
        decision.motivo === "baja"
          ? "El número pidió la baja de los avisos."
          : decision.motivo === "sin-plantilla"
            ? `La plantilla «${nombrePlantilla}» no está aprobada en Meta.`
            : "El aviso está apagado.";
      log("omitido", `${opciones.evento}: ${motivo}`);
      return registrar("omitida", motivo, waJid);
    }

    const documento = opciones.documento ? await opciones.documento() : null;
    const proveedor = proveedorWhatsapp();
    const simulado = proveedor.id === "demo";

    // El PDF se guarda para la bandeja y se sube a Meta: así sale por id, sin
    // publicar el presupuesto de nadie en una URL.
    let media = null as null | {
      referencia: string;
      mediaId: string;
      bytes: number;
      nombre: string;
    };
    if (documento) {
      const guardado = await guardarMedioPrivado(documento.contenido, "application/pdf");
      const subido = await proveedor.subirMedia(documento.contenido, "application/pdf", documento.nombre);
      if (subido.error || !subido.id) {
        return registrar("fallida", subido.error?.texto ?? "No se pudo subir el PDF.", waJid);
      }
      media = { referencia: guardado.referencia, mediaId: subido.id, bytes: guardado.bytes, nombre: documento.nombre };
    }

    const registroMedia = media
      ? { referencia: media.referencia, tipo: "document" as const, mime: "application/pdf", nombre: media.nombre, bytes: media.bytes, mediaId: media.mediaId }
      : null;

    let resultado;
    if (decision.como === "texto") {
      const cuerpo = completar(aviso!.textoLibre!, valores);
      resultado = await enviarYRegistrar({
        conversacionId: conversacion.id,
        waJid,
        mensaje: media
          ? { tipo: "media", clase: "document", media: { id: media.mediaId }, epigrafe: cuerpo, nombreArchivo: media.nombre }
          : { tipo: "texto", cuerpo },
        registro: { cuerpo, media: registroMedia, datos: { aviso: opciones.evento } },
        origen: "aviso",
        enviadoPorUserId: opciones.usuarioId ?? null,
      });
    } else {
      const completos = sugerirValores(plantilla!, valores);
      const cuerpo = vistaPrevia(plantilla!, completos);
      resultado = await enviarYRegistrar({
        conversacionId: conversacion.id,
        waJid,
        mensaje: {
          tipo: "plantilla",
          nombre: plantilla!.nombre,
          idioma: plantilla!.idioma,
          componentes: armarComponentes(plantilla!, completos, media ? { id: media.mediaId, nombre: media.nombre } : null),
        },
        registro: { cuerpo, media: registroMedia, plantilla: plantilla!.nombre, datos: { aviso: opciones.evento } },
        origen: "aviso",
        enviadoPorUserId: opciones.usuarioId ?? null,
      });
    }

    if (resultado.error) {
      log("error", `${opciones.evento}: ${resultado.error.texto}`);
      return registrar("fallida", resultado.error.texto, waJid, resultado.waMessageId);
    }

    log(decision.como === "texto" ? "enviado_texto" : "enviado_plantilla", opciones.evento);
    return registrar(
      simulado ? "simulada" : "enviada",
      decision.como === "texto" ? "Mensaje común (dentro de las 24 h)." : `Plantilla ${plantilla!.nombre}.`,
      waJid,
      resultado.waMessageId,
    );
  } catch (error) {
    // Se traga el error a propósito: la operación que lo disparó ya terminó.
    log("error_inesperado", error instanceof Error ? error.message : "desconocido");
    return { estado: "fallida", detalle: "Error inesperado." };
  }
}

/** La sucursal como la lee el cliente: nombre y dirección, y su horario. */
export function datosDeSucursal(nombre: string | null, slug: string | null) {
  const publicada = (slug && sucursalPublicada(slug)) || SUCURSALES.find((s) => s.nombre === nombre) || SUCURSALES[0];
  return {
    sucursal: publicada ? `${publicada.nombre}, ${publicada.direccion.replace(/, Mar del Plata$/, "")}` : nombre ?? "la sucursal",
    horario: publicada?.horario ?? "",
  };
}

/** El aviso del cambio de estado de un pedido (o del pedido recibido). */
export async function avisarCambioDePedido(orderId: string, nuevoEstado: string): Promise<void> {
  try {
    const [pedido] = await db
      .select({
        numero: orders.numero,
        contactoNombre: orders.contactoNombre,
        contactoTelefono: orders.contactoTelefono,
        clienteNombre: customers.nombre,
        clienteTelefono: customers.telefono,
        sucursal: branches.name,
        sucursalSlug: branches.slug,
      })
      .from(orders)
      .leftJoin(customers, eq(customers.id, orders.customerId))
      .leftJoin(branches, eq(branches.id, orders.branchId))
      .where(eq(orders.id, orderId))
      .limit(1);
    if (!pedido) return;

    await avisarPorWhatsapp({
      evento: nuevoEstado,
      // El teléfono de la ficha manda sobre el que se tipeó en el pedido: es
      // el que el negocio mantiene al día.
      telefono: pedido.clienteTelefono ?? pedido.contactoTelefono,
      nombre: pedido.clienteNombre ?? pedido.contactoNombre,
      valores: { pedido: pedido.numero, ...datosDeSucursal(pedido.sucursal, pedido.sucursalSlug) },
      orderId,
    });
  } catch (error) {
    log("error_inesperado", error instanceof Error ? error.message : "desconocido");
  }
}

/**
 * Deja creados los avisos que faltan, apagados.
 *
 * Se llama al abrir la configuración: es mejor mostrar los interruptores en
 * cero que una pantalla vacía. Solo agrega los que no están, así un aviso
 * nuevo aparece sin pisar lo que la maderera ya prendió o reescribió.
 */
export async function sembrarAvisos(): Promise<void> {
  await db
    .insert(avisosWhatsapp)
    .values(
      EVENTOS_WHATSAPP.map((e) => ({
        evento: e.evento,
        plantilla: e.plantilla,
        idioma: "es_AR",
        textoLibre: e.textoLibre,
        activo: false,
      })),
    )
    .onConflictDoNothing({ target: avisosWhatsapp.evento });

  // Los textos sembrados antes usaban {{1}}, {{2}}: se pasan a los nombres
  // que completa el aviso. Solo los que siguen con esa forma, que son los que
  // nadie tocó a mano.
  for (const e of EVENTOS_WHATSAPP) {
    await db
      .update(avisosWhatsapp)
      .set({ textoLibre: e.textoLibre, updatedAt: new Date() })
      .where(and(eq(avisosWhatsapp.evento, e.evento), sql`${avisosWhatsapp.textoLibre} ~ '\{\{[0-9]+\}\}'`));
  }
}
