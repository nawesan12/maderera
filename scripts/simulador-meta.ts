/**
 * Simulador de la Graph API de Meta, para probar WhatsApp sin Meta.
 *
 *   npm run whatsapp:simulador
 *
 * y la aplicación levantada con:
 *
 *   WHATSAPP_GRAPH_URL=http://localhost:3199
 *   WHATSAPP_PHONE_NUMBER_ID=106540352242922
 *   WHATSAPP_BUSINESS_ACCOUNT_ID=102290129340398
 *   WHATSAPP_ACCESS_TOKEN=token-de-prueba
 *   WHATSAPP_APP_SECRET=secreto-de-prueba
 *   WHATSAPP_WEBHOOK_SECRET=verificacion-de-prueba
 *
 * Imita lo que usa la plataforma —mandar mensajes, subir y bajar archivos,
 * listar plantillas, consultar el número y la cuenta— con las respuestas y los
 * errores con la forma de la documentación. Y hace lo que hace Meta después de
 * un envío: **le manda a la aplicación los estados** (`sent`, `delivered`,
 * `read`), firmados con el secreto, por el webhook de verdad.
 *
 * Para hacer fallar cosas a propósito:
 *
 *   POST /_simulador/error   {"codigo":131047}            el próximo envío falla así
 *   POST /_simulador/error   {"codigo":190}               token vencido (401)
 *   POST /_simulador/error   {"codigo":131026,"tarde":true}  sale, y después llega «failed»
 *   POST /_simulador/entrante {"tipo":"imagen","de":"5492235550123"}  un cliente escribe
 *   POST /_simulador/entrante {"tipo":"eco","de":"5492235550123","texto":"…"}  el personal contesta desde el teléfono
 *   POST /_simulador/entrante {"tipo":"historial","de":"5492235550123"}  llega el historial de la app
 *   POST /_simulador/entrante {"tipo":"agenda","de":"5492235550123","nombre":"…"}  la agenda de la app
 *   GET  /_simulador/enviados                              lo que mandó la aplicación
 *
 * Los ids de adjunto que terminan en `0000` no se pueden bajar (404), para
 * probar la descarga que falla.
 */

import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { PLANTILLAS_BASE } from "../lib/whatsapp/plantillas-base";
import * as P from "../tests/fixtures/whatsapp/payloads";

const PUERTO = Number(process.env.SIMULADOR_PUERTO ?? 3199);
const APP = (process.env.SIMULADOR_APP_URL ?? "http://localhost:3103").replace(/\/$/, "");
const SECRETO = process.env.WHATSAPP_APP_SECRET ?? "secreto-de-prueba";
const TOKEN = process.env.WHATSAPP_ACCESS_TOKEN ?? "token-de-prueba";
const PNID = process.env.WHATSAPP_PHONE_NUMBER_ID ?? P.CONSTANTES.PHONE_NUMBER_ID;
const WABA = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ?? P.CONSTANTES.WABA_ID;

interface Medio {
  contenido: Buffer;
  mime: string;
}

const medios = new Map<string, Medio>();
const enviados: unknown[] = [];
let proximoError: { codigo: number; tarde?: boolean } | null = null;

/** Un PDF chiquito y válido, para los documentos que «manda» un cliente. */
function pdfDeEjemplo(texto: string): Buffer {
  const contenido = `BT /F1 18 Tf 72 720 Td (${texto}) Tj ET`;
  const objetos = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${contenido.length} >>\nstream\n${contenido}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const posiciones: number[] = [];
  objetos.forEach((o, i) => {
    posiciones.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (const p of posiciones) pdf += `${String(p).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

// Los adjuntos de los payloads de ejemplo, para que se puedan bajar.
const ICONO = readFileSync(path.join(process.cwd(), "public", "cropped-icon-180x180.png"));
medios.set("1037543291543636", { contenido: ICONO, mime: "image/png" });
medios.set("1541542463268411", { contenido: pdfDeEjemplo("Plano de la cocina"), mime: "application/pdf" });
medios.set("1218543282730410", { contenido: randomBytes(2048), mime: "audio/ogg" });
medios.set("1166846181421424", { contenido: randomBytes(4096), mime: "video/mp4" });
medios.set("1228061178226478", { contenido: ICONO, mime: "image/webp" });

/* -------------------------------------------------------------------------- */

function responder(res: ServerResponse, status: number, cuerpo: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(cuerpo));
}

function errorMeta(res: ServerResponse, codigo: number, mensaje: string, detalle?: string) {
  const status = codigo === 190 ? 401 : codigo === 130429 ? 429 : 400;
  responder(res, status, {
    error: {
      message: mensaje,
      type: codigo === 190 ? "OAuthException" : "OAuthException",
      code: codigo,
      ...(detalle ? { error_data: { messaging_product: "whatsapp", details: detalle } } : {}),
      fbtrace_id: randomBytes(9).toString("base64url"),
    },
  });
}

const MENSAJES_ERROR: Record<number, [string, string]> = {
  131047: [
    "(#131047) Re-engagement message",
    "Message failed to send because more than 24 hours have passed since the customer last replied to this number.",
  ],
  190: ["Error validating access token: Session has expired on Tuesday, 14-Oct-26 10:00:00 PDT.", ""],
  131026: ["(#131026) Message undeliverable", "Unable to deliver message."],
  130429: ["(#130429) Rate limit hit", "Cloud API message throughput has been reached."],
  132001: ["(#132001) Template name does not exist in the translation", "template name does not exist in es_AR"],
  131053: ["(#131053) Media upload error", "Unsupported media type."],
};

async function leerCuerpo(req: IncomingMessage): Promise<Buffer> {
  const partes: Buffer[] = [];
  for await (const parte of req) partes.push(parte as Buffer);
  return Buffer.concat(partes);
}

/** Lo mínimo de multipart/form-data para el `POST /media`. */
function leerMultipart(cuerpo: Buffer, tipo: string): { campos: Record<string, string>; archivo: Medio | null } {
  const limite = /boundary=(?:"([^"]+)"|([^;]+))/.exec(tipo);
  const campos: Record<string, string> = {};
  let archivo: Medio | null = null;
  if (!limite) return { campos, archivo };
  const separador = Buffer.from(`--${limite[1] ?? limite[2]}`);

  let inicio = cuerpo.indexOf(separador);
  while (inicio !== -1) {
    const siguiente = cuerpo.indexOf(separador, inicio + separador.length);
    if (siguiente === -1) break;
    const parte = cuerpo.subarray(inicio + separador.length + 2, siguiente - 2);
    const corte = parte.indexOf("\r\n\r\n");
    const cabeceras = parte.subarray(0, corte).toString();
    const datos = parte.subarray(corte + 4);
    const nombre = /name="([^"]+)"/.exec(cabeceras)?.[1];
    if (/filename=/.test(cabeceras)) {
      archivo = { contenido: Buffer.from(datos), mime: /Content-Type:\s*([^\r\n]+)/i.exec(cabeceras)?.[1] ?? "application/octet-stream" };
    } else if (nombre) {
      campos[nombre] = datos.toString();
    }
    inicio = siguiente;
  }
  return { campos, archivo };
}

/** Le manda un payload a la aplicación, firmado como lo firma Meta. */
async function aLaApp(payload: unknown, opciones: { firmaMala?: boolean } = {}): Promise<number> {
  const cuerpo = JSON.stringify(payload);
  const firma = createHmac("sha256", opciones.firmaMala ? "otro-secreto" : SECRETO).update(cuerpo).digest("hex");
  try {
    const res = await fetch(`${APP}/api/whatsapp/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${firma}` },
      body: cuerpo,
    });
    return res.status;
  } catch (error) {
    console.error("No se pudo avisar a la aplicación:", (error as Error).message);
    return 0;
  }
}

function esperar(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Lo que hace Meta después de aceptar un mensaje: avisar cómo le fue. */
async function avisarEstados(id: string, para: string, categoria: "service" | "utility" | "marketing" | "authentication", falla?: number) {
  await esperar(400);
  if (falla) {
    const [titulo, detalle] = MENSAJES_ERROR[falla] ?? ["Error", ""];
    await aLaApp(P.estado({ id, estado: "failed", para, phoneNumberId: PNID, error: { code: falla, title: titulo.replace(/^\(#\d+\) /, ""), details: detalle } }));
    return;
  }
  await aLaApp(P.estado({ id, estado: "sent", para, categoria, phoneNumberId: PNID }));
  await esperar(900);
  await aLaApp(P.estado({ id, estado: "delivered", para, categoria, phoneNumberId: PNID }));
  await esperar(2500);
  await aLaApp(P.estado({ id, estado: "read", para, categoria, phoneNumberId: PNID }));
}

function plantillas() {
  const nuestras = PLANTILLAS_BASE.map((p, i) => ({
    id: String(594425479261596 + i),
    name: p.nombre,
    language: p.idioma,
    // Una en revisión, para ver cómo lo muestra la configuración.
    status: p.nombre === "cheque_rechazado" ? "PENDING" : "APPROVED",
    category: p.categoria,
    parameter_format: "NAMED",
    components: p.componentes,
  }));
  return [
    ...nuestras,
    {
      id: "1192339204654487",
      name: "hello_world",
      language: "en_US",
      status: "APPROVED",
      category: "UTILITY",
      parameter_format: "POSITIONAL",
      components: [
        { type: "HEADER", format: "TEXT", text: "Hello World" },
        { type: "BODY", text: "Welcome and congratulations!! This message demonstrates your ability to send a WhatsApp message notification from the Cloud API, hosted by Meta. Thank you for taking the time to test with us." },
        { type: "FOOTER", text: "WhatsApp Business Platform sample message" },
      ],
    },
  ];
}

/* -------------------------------------------------------------------------- */

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PUERTO}`);
  const partes = url.pathname.split("/").filter(Boolean);
  console.info(`${req.method} ${url.pathname}${url.search}`);

  try {
    /* ------------------------------ control ------------------------------ */
    if (partes[0] === "_simulador") {
      if (partes[1] === "error" && req.method === "POST") {
        proximoError = JSON.parse((await leerCuerpo(req)).toString() || "null");
        return responder(res, 200, { ok: true, proximoError });
      }
      if (partes[1] === "enviados") return responder(res, 200, enviados);
      if (partes[1] === "entrante" && req.method === "POST") {
        const datos = JSON.parse((await leerCuerpo(req)).toString() || "{}") as {
          tipo?: string;
          de?: string;
          nombre?: string;
          texto?: string;
          citado?: string;
          aMensaje?: string;
          emoji?: string;
          mediaId?: string;
          repetir?: boolean;
          firmaMala?: boolean;
        };
        const base = { phoneNumberId: PNID, de: datos.de, nombre: datos.nombre, citado: datos.citado };
        const constructores: Record<string, () => unknown> = {
          texto: () => P.texto({ ...base, cuerpo: datos.texto }),
          imagen: () => P.imagen({ ...base, caption: datos.texto, mediaId: datos.mediaId }),
          documento: () => P.documento({ ...base, mediaId: datos.mediaId }),
          audio: () => P.audio({ ...base, mediaId: datos.mediaId }),
          video: () => P.video({ ...base, mediaId: datos.mediaId }),
          sticker: () => P.sticker({ ...base, mediaId: datos.mediaId }),
          ubicacion: () => P.ubicacion(base),
          contactos: () => P.contactos(base),
          boton: () => P.respuestaBoton(base),
          lista: () => P.respuestaLista(base),
          reaccion: () => P.reaccion({ ...base, aMensaje: datos.aMensaje ?? "", emoji: datos.emoji }),
          "no-soportado": () => P.noSoportado(base),
          sistema: () => P.sistema(base),
          "sin-numero": () => P.texto({ ...base, de: null, usuario: "AR.0123456789ABCDEF", cuerpo: datos.texto }),
          eco: () => P.ecoDelTelefono({ phoneNumberId: PNID, para: datos.de, cuerpo: datos.texto }),
          "eco-foto": () => P.ecoConImagen({ phoneNumberId: PNID, para: datos.de, mediaId: datos.mediaId }),
          historial: () =>
            P.historial({
              phoneNumberId: PNID,
              ...(datos.de ? { hilos: [{ cliente: datos.de, mensajes: [{ delNegocio: false, cuerpo: datos.texto ?? "Hola, ¿abren el sábado?" }, { delNegocio: true, cuerpo: "Sí, de 8 a 12." }] }] } : {}),
            }),
          agenda: () => P.contactosDeLaApp({ phoneNumberId: PNID, contactos: [{ telefono: datos.de ?? "5492235550123", nombre: datos.nombre ?? "Marta Gómez" }] }),
        };
        const construir = constructores[datos.tipo ?? "texto"];
        if (!construir) return responder(res, 400, { error: `Tipos: ${Object.keys(constructores).join(", ")}` });
        const payload = construir();
        const estados = [await aLaApp(payload, { firmaMala: datos.firmaMala })];
        if (datos.repetir) estados.push(await aLaApp(payload));
        return responder(res, 200, { enviado: payload, respuestaDeLaApp: estados });
      }
      if (partes[1] === "_media" || partes[1] === "medio") {
        const medio = medios.get(partes[2] ?? "");
        if (!medio) return responder(res, 404, { error: "no está" });
        res.writeHead(200, { "content-type": medio.mime });
        return res.end(medio.contenido);
      }
      return responder(res, 404, { error: "control desconocido" });
    }

    /* ------------------------------ Graph -------------------------------- */
    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      return errorMeta(res, 190, "Invalid OAuth access token - Cannot parse access token");
    }
    if (proximoError?.codigo === 190) {
      proximoError = null;
      return errorMeta(res, 190, MENSAJES_ERROR[190][0]);
    }

    // La versión va primero: /v26.0/...
    const [, ...ruta] = partes;

    if (ruta[0] === "me") return responder(res, 200, { id: "122100000000001", name: "Sistema MJBJ" });

    if (ruta[0] === PNID && ruta.length === 1 && req.method === "GET") {
      return responder(res, 200, {
        id: PNID,
        display_phone_number: "+54 9 223 590-3118",
        verified_name: "Maderera Juan B. Justo",
        quality_rating: "GREEN",
        code_verification_status: "VERIFIED",
        name_status: "APPROVED",
        platform_type: "CLOUD_API",
        whatsapp_business_manager_messaging_limit: "TIER_250",
        throughput: { level: "STANDARD" },
        status: "CONNECTED",
      });
    }

    if (ruta[0] === WABA && ruta[1] === "phone_numbers") return responder(res, 200, { data: [{ id: PNID }] });
    if (ruta[0] === WABA && ruta[1] === "subscribed_apps") {
      return responder(res, 200, { data: [{ whatsapp_business_api_data: { name: "MJBJ Plataforma", id: "1234567890" } }] });
    }
    if (ruta[0] === WABA && ruta[1] === "message_templates") {
      return responder(res, 200, { data: plantillas(), paging: { cursors: { before: "a", after: "b" } } });
    }

    if (ruta[0] === PNID && ruta[1] === "media" && req.method === "POST") {
      const { archivo, campos } = leerMultipart(await leerCuerpo(req), req.headers["content-type"] ?? "");
      if (proximoError?.codigo === 131053) {
        proximoError = null;
        return errorMeta(res, 131053, ...MENSAJES_ERROR[131053]);
      }
      if (!archivo || campos.messaging_product !== "whatsapp") {
        return errorMeta(res, 100, "(#100) The parameter file is required.");
      }
      const id = String(Date.now()) + String(Math.floor(Math.random() * 1000)).padStart(3, "1");
      medios.set(id, { contenido: archivo.contenido, mime: campos.type || archivo.mime });
      return responder(res, 200, { id });
    }

    if (ruta[0] === PNID && ruta[1] === "messages" && req.method === "POST") {
      const cuerpo = JSON.parse((await leerCuerpo(req)).toString()) as Record<string, unknown>;
      if (cuerpo.messaging_product !== "whatsapp") return errorMeta(res, 100, "(#100) Param messaging_product is required");

      // Confirmación de lectura: no devuelve id.
      if (cuerpo.status === "read") return responder(res, 200, { success: true });

      const para = String(cuerpo.to ?? cuerpo.recipient ?? "");
      if (!para) return errorMeta(res, 100, "(#100) The parameter to is required.");

      if (proximoError && !proximoError.tarde) {
        const { codigo } = proximoError;
        proximoError = null;
        return errorMeta(res, codigo, ...(MENSAJES_ERROR[codigo] ?? ["Error", ""]));
      }

      const id = P.wamid();
      enviados.push({ id, ...cuerpo });

      const plantilla = cuerpo.type === "template" ? (cuerpo.template as { name?: string })?.name : null;
      const categoria = plantilla
        ? ((plantillas().find((p) => p.name === plantilla)?.category ?? "UTILITY").toLowerCase() as "utility")
        : "service";
      const falla = proximoError?.tarde ? proximoError.codigo : undefined;
      proximoError = null;
      void avisarEstados(id, para, categoria, falla);

      return responder(res, 200, {
        messaging_product: "whatsapp",
        contacts: [{ input: para, wa_id: para }],
        messages: [{ id, ...(plantilla ? { message_status: "accepted" } : {}) }],
      });
    }

    // GET /{media-id}: la dirección temporal para bajarlo.
    if (ruta.length === 1 && /^\d+$/.test(ruta[0]) && req.method === "GET") {
      const id = ruta[0];
      if (id.endsWith("0000") || !medios.has(id)) {
        return errorMeta(res, 100, "(#100) Invalid parameter", "Media not found or expired.");
      }
      const medio = medios.get(id)!;
      return responder(res, 200, {
        messaging_product: "whatsapp",
        url: `http://localhost:${PUERTO}/_simulador/medio/${id}?ext=${Date.now()}`,
        mime_type: medio.mime,
        sha256: "simulado",
        file_size: medio.contenido.byteLength,
        id,
      });
    }

    return errorMeta(res, 100, `(#100) Unsupported request: ${req.method} ${url.pathname}`);
  } catch (error) {
    return responder(res, 500, { error: { message: (error as Error).message, code: 1 } });
  }
});

servidor.listen(PUERTO, () => {
  console.info(`Simulador de Meta en http://localhost:${PUERTO} — avisa a ${APP}/api/whatsapp/webhook`);
});
