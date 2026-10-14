import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversaciones, mensajes, sesionWhatsapp } from "@/lib/db/schema";
import { configCloud, secretoDeLaApp } from "./config";
import { firmaValida as validarFirma } from "./firma";
import { proveedorWhatsapp } from "./index";
import { actualizarEstadoMensaje, ingresarEntrante, registrarEco, registrarSenal } from "./ingesta";
import { guardarMedioPrivado, limpiarMime, TAMANO_MAXIMO_MEDIO } from "./medios";
import { jidDeBsuid, jidDeWaId } from "./numeros";
import { leerPayload, type EstadoDeMeta, type MensajeDeMeta } from "./payload";
import { esPedidoDeAlta, esPedidoDeBaja } from "./ventana";

/**
 * El webhook de la WhatsApp Cloud API, del lado del trabajo.
 *
 * La ruta (`app/api/whatsapp/webhook`) valida la firma, encola el payload y le
 * contesta a Meta. Lo que sigue corre en la cola (`lib/cola`): traducir el
 * payload (`payload.ts`), guardar cada evento, bajar los adjuntos y avisar al
 * panel. Todo es idempotente —Meta reintenta durante días, y la cola también—:
 * los mensajes se cortan por su id, los estados no retroceden, las reacciones
 * se pisan.
 */

/** El payload tal como llega, sin tipar: lo valida `leerPayload`. */
export type PayloadWebhook = unknown;

/** La firma de Meta contra el secreto configurado (ver `firma.ts`). */
export function firmaValida(cuerpoCrudo: string | Uint8Array, cabecera: string | null): boolean {
  return validarFirma(cuerpoCrudo, cabecera, secretoDeLaApp());
}

function log(evento: string, detalle?: string) {
  console.info(JSON.stringify({ scope: "whatsapp.webhook", evento, detalle }));
}

/**
 * Procesa un payload ya verificado. Si algo tira, la cola reintenta el
 * payload entero, y por la idempotencia no se duplica nada.
 */
export async function procesarPayload(payload: PayloadWebhook): Promise<void> {
  const config = configCloud();
  const eventos = leerPayload(payload);
  await registrarSenal(true);

  for (const evento of eventos) {
    // El número tiene que ser el nuestro: un webhook mal configurado puede
    // mandar eventos de otro número del mismo portafolio.
    if (
      (evento.tipo === "mensaje" || evento.tipo === "estado" || evento.tipo === "eco") &&
      config &&
      evento.phoneNumberId &&
      evento.phoneNumberId !== config.phoneNumberId
    ) {
      log("otro_numero", evento.phoneNumberId);
      continue;
    }

    switch (evento.tipo) {
      case "estado":
        await aplicarEstado(evento.estado, 0);
        break;

      case "mensaje": {
        const m = evento.mensaje;
        await atenderEntrante(m, m.de ? jidDeWaId(m.de) : jidDeBsuid(m.usuarioMeta!));
        break;
      }

      case "eco": {
        const m = evento.mensaje;
        const id = await registrarEco({ ...m, waJidDestino: jidDeWaId(m.para) });
        if (id && m.media) await descargarMedio(id);
        break;
      }

      case "plantilla": {
        const { actualizarEstadoPlantilla } = await import("./catalogo");
        await actualizarEstadoPlantilla(evento);
        break;
      }

      case "calidad":
        await db
          .update(sesionWhatsapp)
          .set({
            calidad: evento.evento,
            limiteMensajes: evento.limite,
            updatedAt: new Date(),
          });
        if (evento.evento === "DOWNGRADE" || evento.evento === "FLAGGED") {
          const { avisarAlPanel } = await import("@/lib/notificaciones/push");
          await avisarAlPanel({
            titulo: "Bajó la calidad del número de WhatsApp",
            cuerpo: "Hay clientes marcando los mensajes como no deseados. Revisá los avisos automáticos.",
            url: "/admin/whatsapp/configuracion",
            etiqueta: "whatsapp-calidad",
            para: { pantalla: "/admin/whatsapp/configuracion" },
          });
        }
        break;

      case "otro":
        log("campo_sin_manejar", evento.campo);
        break;
    }
  }
}

/**
 * Lo que pasa cuando escribe un cliente: se guarda, se baja el adjunto, se
 * atiende el «BAJA» y se avisa al personal. Lo usan el webhook y el simulador
 * del modo demostración, para que los dos se comporten igual.
 */
export async function atenderEntrante(m: MensajeDeMeta, waJid: string): Promise<string | null> {
  const guardado = await ingresarEntrante({ ...m, waJid });
  if (!guardado) return null;

  if (guardado.mediaId) await descargarMedio(guardado.mensajeId);
  await atenderBajaOAlta(guardado.conversacionId, waJid, guardado.cuerpo);
  await avisarAlPersonal(guardado);
  return guardado.mensajeId;
}

/**
 * Aplica un estado. Si el mensaje todavía no está —Meta puede avisar «sent»
 * antes de que el envío termine de guardar su id—, se deja para dentro de
 * medio minuto, hasta tres veces. Después se descarta: es un estado de un
 * mensaje que no salió de acá.
 */
export async function aplicarEstado(estado: EstadoDeMeta, intento: number): Promise<void> {
  let aplicado = await actualizarEstadoMensaje(estado);
  // Lo normal es que el envío termine de guardar el id en menos de un segundo:
  // se espera un poco acá antes de mandarlo a la cola, que puede tardar un
  // minuto en volver a mirarlo.
  for (let espera = 0; !aplicado && intento === 0 && espera < 3; espera++) {
    await new Promise((r) => setTimeout(r, 700));
    aplicado = await actualizarEstadoMensaje(estado);
  }
  if (aplicado || intento >= 3) return;

  const { encolar } = await import("@/lib/cola");
  await encolar("whatsapp.estado", { estado, intento: intento + 1 }, { en: new Date(Date.now() + 30_000) });
}

/* -------------------------------------------------------------------------- */
/* Adjuntos                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Baja el adjunto de un mensaje y lo guarda en lo privado.
 *
 * Primero se guarda el mensaje y después se baja el archivo: si Meta no lo
 * entrega, el mensaje igual está en la bandeja, con el aviso de que el archivo
 * no se pudo bajar y un botón para reintentar. El id de Meta dura siete días
 * para los adjuntos que llegan, así que hay margen; los reintentos automáticos
 * van por la cola, espaciados.
 */
export async function descargarMedio(mensajeId: string, intento = 0): Promise<"listo" | "pendiente" | "fallido"> {
  const [mensaje] = await db
    .select({ mediaId: mensajes.mediaId, mediaEstado: mensajes.mediaEstado, mime: mensajes.mediaMime })
    .from(mensajes)
    .where(eq(mensajes.id, mensajeId))
    .limit(1);

  if (!mensaje?.mediaId) return "fallido";
  if (mensaje.mediaEstado === "listo") return "listo";

  const bajado = await proveedorWhatsapp().bajarMedia(mensaje.mediaId);

  // Guardarlo también puede fallar (disco lleno, Blob caído). Nunca tira: si
  // tirara, la cola reintentaría el payload entero, el mensaje ya estaría y el
  // adjunto no se volvería a intentar nunca.
  let guardado: { referencia: string; bytes: number } | null = null;
  let errorAlGuardar: string | null = null;
  if (!("error" in bajado) && bajado.contenido.byteLength <= TAMANO_MAXIMO_MEDIO) {
    try {
      guardado = await guardarMedioPrivado(bajado.contenido, limpiarMime(bajado.mime || mensaje.mime));
    } catch (error) {
      errorAlGuardar = error instanceof Error ? error.message : "No se pudo guardar el archivo.";
    }
  }

  if ("error" in bajado || !guardado) {
    const motivo =
      "error" in bajado ? bajado.error : (errorAlGuardar ?? "El archivo es demasiado grande.");
    log("media_no_bajada", `${mensajeId}: ${motivo}`);

    // Tres reintentos automáticos (30 s, 1 min, 2 min por la espera de la
    // cola); después queda el botón.
    const sigue = intento < 3 && ("error" in bajado || errorAlGuardar !== null);
    await db
      .update(mensajes)
      .set({ mediaEstado: sigue ? "pendiente" : "fallido", errorDetalle: motivo.slice(0, 300) })
      .where(eq(mensajes.id, mensajeId));

    if (sigue) {
      const { encolar } = await import("@/lib/cola");
      await encolar(
        "whatsapp.medio",
        { mensajeId, intento: intento + 1 },
        { en: new Date(Date.now() + 30_000 * 2 ** intento) },
      );
      return "pendiente";
    }
    return "fallido";
  }

  const mime = limpiarMime(bajado.mime || mensaje.mime);

  await db
    .update(mensajes)
    .set({
      mediaUrl: guardado.referencia,
      mediaMime: mime,
      mediaBytes: guardado.bytes,
      mediaEstado: "listo",
      errorDetalle: null,
    })
    .where(eq(mensajes.id, mensajeId));

  return "listo";
}

/* -------------------------------------------------------------------------- */
/* Bajas y avisos al personal                                                  */
/* -------------------------------------------------------------------------- */

const TEXTO_BAJA =
  "Listo, no te vamos a mandar más avisos automáticos por WhatsApp. Si nos escribís, te contestamos igual. Si querés volver a recibirlos, escribí ALTA.";
const TEXTO_ALTA = "Listo, vas a volver a recibir los avisos de tus pedidos por WhatsApp.";

/**
 * «BAJA» y «ALTA».
 *
 * La política de WhatsApp obliga a respetar cualquier pedido de no recibir más
 * mensajes, se haga por donde se haga. Se registra en la conversación (cuándo
 * y con qué palabras) y se le confirma en el momento: como acaba de escribir,
 * la ventana está abierta y la confirmación no necesita plantilla.
 */
async function atenderBajaOAlta(conversacionId: string, waJid: string, texto: string): Promise<void> {
  const baja = esPedidoDeBaja(texto);
  const alta = !baja && esPedidoDeAlta(texto);
  if (!baja && !alta) return;

  const [conversacion] = await db
    .select({ bajaAt: conversaciones.bajaAt })
    .from(conversaciones)
    .where(eq(conversaciones.id, conversacionId))
    .limit(1);

  if (baja && conversacion?.bajaAt) return;
  if (alta && !conversacion?.bajaAt) return;

  await db
    .update(conversaciones)
    .set(
      baja
        ? { bajaAt: new Date(), bajaDetalle: `Escribió «${texto.trim().slice(0, 80)}»` }
        : { bajaAt: null, bajaDetalle: null },
    )
    .where(eq(conversaciones.id, conversacionId));

  const { enviarYRegistrar } = await import("./envio");
  const cuerpo = baja ? TEXTO_BAJA : TEXTO_ALTA;
  await enviarYRegistrar({
    conversacionId,
    waJid,
    mensaje: { tipo: "texto", cuerpo },
    registro: { cuerpo },
    origen: "sistema",
  });
}

/**
 * El aviso al teléfono del personal: «escribió Marta». Solo a quien puede
 * abrir la bandeja, y si la conversación ya la atiende alguien, solo a esa
 * persona. Uno por conversación: el siguiente reemplaza al anterior en vez de
 * apilar diez notificaciones de la misma charla.
 */
async function avisarAlPersonal(guardado: {
  conversacionId: string;
  nombre: string;
  cuerpo: string;
  asignadoA: string | null;
}): Promise<void> {
  const { avisarAlPanel } = await import("@/lib/notificaciones/push");
  await avisarAlPanel({
    titulo: `WhatsApp de ${guardado.nombre}`,
    cuerpo: guardado.cuerpo.trim().slice(0, 140) || "Mandó un archivo.",
    url: `/admin/whatsapp?chat=${guardado.conversacionId}`,
    etiqueta: `whatsapp-${guardado.conversacionId}`,
    para: guardado.asignadoA ? { usuarioId: guardado.asignadoA } : { pantalla: "/admin/whatsapp" },
  });
}
