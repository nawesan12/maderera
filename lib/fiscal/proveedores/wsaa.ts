import "server-only";

import { randomUUID } from "node:crypto";
import forge from "node-forge";
import { XMLParser } from "fast-xml-parser";
import { and, desc, eq, gt } from "drizzle-orm";
import { db } from "@/lib/db";
import { arcaTokens } from "@/lib/db/schema";
import { configArca, type ConfigArca } from "./config-arca";

/**
 * WSAA: el ticket de acceso de ARCA.
 *
 * Antes de poder facturar hay que pedir un ticket. El trámite es: armar un XML
 * con el servicio y una ventana de validez, firmarlo como CMS/PKCS#7 con el
 * certificado de la empresa, mandarlo por SOAP y recibir un token y una firma
 * que después viajan en cada llamada a WSFEv1.
 *
 * **El ticket se cachea y no es negociable.** Dura 12 horas y ARCA rechaza
 * pedir uno nuevo mientras el anterior siga vigente: pedirlo en cada factura
 * hace que a la segunda venta el sistema deje de emitir.
 */

export interface TicketAcceso {
  token: string;
  sign: string;
  expira: Date;
}

/**
 * Arma el Ticket de Requerimiento de Acceso.
 *
 * La ventana arranca diez minutos antes de ahora a propósito: si el reloj del
 * servidor está unos minutos adelantado respecto del de ARCA, un TRA que
 * empieza "ahora" se rechaza por venir del futuro.
 */
function armarTra(servicio: string): string {
  const ahora = Date.now();
  const desde = new Date(ahora - 10 * 60_000).toISOString();
  const hasta = new Date(ahora + 12 * 3_600_000).toISOString();

  return `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${Math.floor(ahora / 1000)}</uniqueId>
    <generationTime>${desde}</generationTime>
    <expirationTime>${hasta}</expirationTime>
  </header>
  <service>${servicio}</service>
</loginTicketRequest>`;
}

/**
 * Firma el TRA como CMS/PKCS#7 en base64.
 *
 * Es el equivalente de `openssl cms -sign`, hecho con node-forge para no
 * depender de que haya un binario de openssl en el servidor. El CMS va
 * *attached*: lleva el TRA adentro, que es lo que espera el WSAA.
 */
export function firmarTra(tra: string, config: ConfigArca): string {
  const certificado = forge.pki.certificateFromPem(config.certificado);
  const clave = forge.pki.privateKeyFromPem(config.clavePrivada);

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(tra, "utf8");
  p7.addCertificate(certificado);
  p7.addSigner({
    key: clave,
    certificate: certificado,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date().toISOString() },
    ],
  });

  p7.sign({ detached: false });

  return forge.util.encode64(
    forge.asn1.toDer(p7.toAsn1()).getBytes(),
  );
}

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,
});

/** Pide un ticket nuevo al WSAA. */
async function pedirTicket(
  config: ConfigArca,
  servicio: string,
): Promise<TicketAcceso> {
  const cms = firmarTra(armarTra(servicio), config);

  const sobre = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desa.afip.gov">
  <soapenv:Header/>
  <soapenv:Body>
    <wsaa:loginCms>
      <wsaa:in0>${cms}</wsaa:in0>
    </wsaa:loginCms>
  </soapenv:Body>
</soapenv:Envelope>`;

  const respuesta = await fetch(config.urlWsaa, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: "",
    },
    body: sobre,
    signal: AbortSignal.timeout(20_000),
  });

  const texto = await respuesta.text();

  if (!respuesta.ok) {
    throw new Error(motivoDeFalla(texto) ?? `WSAA respondió ${respuesta.status}`);
  }

  const sobreParseado = parser.parse(texto);
  const contenido =
    sobreParseado?.Envelope?.Body?.loginCmsResponse?.loginCmsReturn;

  if (typeof contenido !== "string") {
    throw new Error(motivoDeFalla(texto) ?? "WSAA devolvió una respuesta que no se pudo leer.");
  }

  const ticket = parser.parse(contenido);
  const credenciales = ticket?.loginTicketResponse?.credentials;
  const expira = ticket?.loginTicketResponse?.header?.expirationTime;

  if (!credenciales?.token || !credenciales?.sign) {
    throw new Error("El ticket de ARCA vino sin token.");
  }

  return {
    token: String(credenciales.token),
    sign: String(credenciales.sign),
    expira: expira ? new Date(String(expira)) : new Date(Date.now() + 11 * 3_600_000),
  };
}

/** Saca el mensaje de error de un SOAP Fault, para poder mostrarlo. */
function motivoDeFalla(xml: string): string | null {
  const coincidencia = xml.match(/<faultstring>([\s\S]*?)<\/faultstring>/i);
  return coincidencia ? coincidencia[1].trim() : null;
}

/**
 * Devuelve un ticket válido, del caché o pidiendo uno nuevo.
 *
 * Se descarta el que vence dentro de los próximos cinco minutos: renovar justo
 * antes evita que un ticket se venza en el medio de una tanda de facturación.
 */
export async function ticketDeAcceso(
  servicio = "wsfe",
): Promise<TicketAcceso> {
  const config = configArca();
  if (!config) throw new Error("ARCA no está configurado en el servidor.");

  const margen = new Date(Date.now() + 5 * 60_000);

  const [guardado] = await db
    .select()
    .from(arcaTokens)
    .where(
      and(
        eq(arcaTokens.servicio, servicio),
        eq(arcaTokens.ambiente, config.ambiente),
        gt(arcaTokens.expiraAt, margen),
      ),
    )
    .orderBy(desc(arcaTokens.expiraAt))
    .limit(1);

  if (guardado) {
    return {
      token: guardado.token,
      sign: guardado.sign,
      expira: guardado.expiraAt,
    };
  }

  const ticket = await pedirTicket(config, servicio);

  await db.insert(arcaTokens).values({
    servicio,
    ambiente: config.ambiente,
    token: ticket.token,
    sign: ticket.sign,
    expiraAt: ticket.expira,
  });

  return ticket;
}

/** Identificador único de la operación, para el log. */
export function idOperacion(): string {
  return randomUUID().slice(0, 8);
}
