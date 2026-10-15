/**
 * Manda al webhook de la aplicación un payload de Meta, firmado.
 *
 *   npm run whatsapp:webhook -- texto --de 5492235550123 --texto "Hola"
 *   npm run whatsapp:webhook -- imagen --de 5492235550123
 *   npm run whatsapp:webhook -- texto --repetir          (el mismo payload dos veces)
 *   npm run whatsapp:webhook -- texto --firma-mala       (tiene que dar 401)
 *   npm run whatsapp:webhook -- verificar                (el GET de alta del webhook)
 *
 * Coexistencia (el número en la app del teléfono y en la plataforma a la vez):
 *
 *   npm run whatsapp:webhook -- eco --de 5492235550123 --texto "Te lo dejo separado"
 *   npm run whatsapp:webhook -- eco --repetir            (el mismo eco dos veces: entra uno)
 *   npm run whatsapp:webhook -- eco --sin to             (eco sin destinatario: se descarta)
 *   npm run whatsapp:webhook -- eco-foto --de 5492235550123
 *   npm run whatsapp:webhook -- eco-borrado --original <wamid>
 *   npm run whatsapp:webhook -- eco-editado --original <wamid> --texto "Mejor el lunes"
 *   npm run whatsapp:webhook -- historial --de 5492235550123 [--repetir]
 *   npm run whatsapp:webhook -- historial-medio --id <wamid del media_placeholder>
 *   npm run whatsapp:webhook -- historial-rechazado
 *   npm run whatsapp:webhook -- agenda --de 5492235550123 --nombre "Marta (obra Alem)"
 *   npm run whatsapp:webhook -- coexistencia-cortada
 *
 * Los payloads salen de `tests/fixtures/whatsapp/payloads.ts`, con la forma de
 * la documentación de Meta. Firma con `WHATSAPP_APP_SECRET` (de `.env.local`)
 * y apunta a `SIMULADOR_APP_URL` (por omisión, el dev server en el 3103).
 * Para los adjuntos, la aplicación los va a pedir a la Graph API: con el
 * simulador corriendo, se bajan; sin él, quedan como «no se pudo bajar».
 */

import { createHmac } from "node:crypto";
import * as P from "../tests/fixtures/whatsapp/payloads";

const APP = (process.env.SIMULADOR_APP_URL ?? "http://localhost:3103").replace(/\/$/, "");
const SECRETO = process.env.WHATSAPP_APP_SECRET ?? "secreto-de-prueba";
const PNID = process.env.WHATSAPP_PHONE_NUMBER_ID ?? P.CONSTANTES.PHONE_NUMBER_ID;

const argumentos = process.argv.slice(2);
const tipo = argumentos[0] ?? "texto";
function opcion(nombre: string): string | undefined {
  const i = argumentos.indexOf(`--${nombre}`);
  return i === -1 ? undefined : argumentos[i + 1];
}
const bandera = (nombre: string) => argumentos.includes(`--${nombre}`);

async function verificar() {
  const token = process.env.WHATSAPP_WEBHOOK_SECRET ?? "verificacion-de-prueba";
  const url = `${APP}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(token)}&hub.challenge=1158201444`;
  const res = await fetch(url);
  console.info(`GET verificación → ${res.status} «${await res.text()}»`);
}

async function mandar() {
  const base = { phoneNumberId: PNID, de: opcion("de"), nombre: opcion("nombre"), citado: opcion("citado") };
  const constructores: Record<string, () => unknown> = {
    texto: () => P.texto({ ...base, cuerpo: opcion("texto") }),
    imagen: () => P.imagen({ ...base, mediaId: opcion("media"), caption: opcion("texto") }),
    documento: () => P.documento({ ...base, mediaId: opcion("media") }),
    audio: () => P.audio({ ...base, mediaId: opcion("media") }),
    video: () => P.video({ ...base, mediaId: opcion("media") }),
    sticker: () => P.sticker({ ...base, mediaId: opcion("media") }),
    ubicacion: () => P.ubicacion(base),
    contactos: () => P.contactos(base),
    boton: () => P.respuestaBoton(base),
    lista: () => P.respuestaLista(base),
    reaccion: () => P.reaccion({ ...base, aMensaje: opcion("a") ?? "", emoji: opcion("emoji") }),
    "no-soportado": () => P.noSoportado(base),
    sistema: () => P.sistema(base),
    estado: () =>
      P.estado({
        phoneNumberId: PNID,
        id: opcion("id") ?? "",
        estado: (opcion("estado") as P.EstadoMeta) ?? "delivered",
        para: opcion("de"),
      }),
    plantilla: () => P.plantillaAprobada({ phoneNumberId: PNID, nombre: opcion("nombre") ?? "pedido_listo", evento: opcion("evento") }),
    calidad: () => P.calidad({ evento: opcion("evento") }),
    eco: () =>
      P.ecoDelTelefono({
        phoneNumberId: PNID,
        para: opcion("de"),
        cuerpo: opcion("texto"),
        id: opcion("id"),
        sinCampo: opcion("sin") as "to" | "id" | "from" | undefined,
      }),
    "eco-foto": () => P.ecoConImagen({ phoneNumberId: PNID, para: opcion("de"), mediaId: opcion("media") }),
    "eco-borrado": () => P.ecoCambio({ phoneNumberId: PNID, original: opcion("original") ?? "", cambio: "revoke" }),
    "eco-editado": () =>
      P.ecoCambio({ phoneNumberId: PNID, original: opcion("original") ?? "", cambio: "edit", cuerpo: opcion("texto") }),
    historial: () =>
      P.historial({
        phoneNumberId: PNID,
        ...(opcion("de")
          ? {
              hilos: [
                {
                  cliente: opcion("de")!,
                  mensajes: [
                    { delNegocio: false, cuerpo: "Hola, ¿cuánto sale la placa de MDF de 18?", id: "wamid.HISTORIAL-1", ts: Math.floor(Date.now() / 1000) - 86_400 * 3 },
                    { delNegocio: true, cuerpo: "Hola, $ 48.500 la entera.", id: "wamid.HISTORIAL-2", ts: Math.floor(Date.now() / 1000) - 86_400 * 3 + 600 },
                    { delNegocio: true, tipo: "media_placeholder" as const, id: "wamid.HISTORIAL-3", ts: Math.floor(Date.now() / 1000) - 86_400 * 3 + 700 },
                  ],
                },
              ],
            }
          : {}),
      }),
    "historial-medio": () => P.historialMedio({ phoneNumberId: PNID, id: opcion("id") ?? "wamid.HISTORIAL-3", mediaId: opcion("media") }),
    "historial-rechazado": () => P.historialRechazado({ phoneNumberId: PNID }),
    agenda: () =>
      P.contactosDeLaApp({
        phoneNumberId: PNID,
        contactos: [{ telefono: opcion("de") ?? "5492235550123", nombre: opcion("nombre") ?? "Marta Gómez (obra Alem)" }],
      }),
    "coexistencia-cortada": () => P.coexistenciaCortada(),
  };

  const construir = constructores[tipo];
  if (!construir) {
    console.error(`Tipo desconocido. Opciones: verificar, ${Object.keys(constructores).join(", ")}`);
    process.exit(1);
  }

  const cuerpo = JSON.stringify(construir());
  const firma = createHmac("sha256", bandera("firma-mala") ? "no-es-el-secreto" : SECRETO).update(cuerpo).digest("hex");

  for (let i = 0; i < (bandera("repetir") ? 2 : 1); i++) {
    const res = await fetch(`${APP}/api/whatsapp/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${firma}` },
      body: cuerpo,
    });
    console.info(`POST ${tipo}${i ? " (repetido)" : ""} → ${res.status} ${await res.text()}`);
  }
}

(tipo === "verificar" ? verificar() : mandar()).catch((error) => {
  console.error(error);
  process.exit(1);
});
