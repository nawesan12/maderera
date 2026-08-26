import "server-only";

import type { AmbienteArca } from "./tipos";

/**
 * Credenciales y endpoints de ARCA.
 *
 * El certificado y la clave privada son lo más sensible del sistema: con ellos
 * se emiten comprobantes fiscales a nombre de la empresa. Viven solo en
 * variables de entorno del servidor, nunca en el repo ni en la base, y este
 * módulo es el único que los lee.
 *
 * Variables (`.env.local`):
 *   ARCA_CUIT                CUIT del emisor, solo dígitos
 *   ARCA_CERTIFICADO         certificado en PEM (o en base64)
 *   ARCA_CLAVE_PRIVADA       clave privada en PEM (o en base64)
 *   ARCA_AMBIENTE            "homologacion" (por defecto) o "produccion"
 *
 * En Vercel conviene cargarlos en base64: los PEM son multilínea y el panel de
 * variables de entorno los corta.
 */

export interface ConfigArca {
  cuit: string;
  certificado: string;
  clavePrivada: string;
  ambiente: AmbienteArca;
  urlWsaa: string;
  urlWsfe: string;
}

const ENDPOINTS = {
  homologacion: {
    wsaa: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms",
    wsfe: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",
  },
  produccion: {
    wsaa: "https://wsaa.afip.gov.ar/ws/services/LoginCms",
    wsfe: "https://servicios1.afip.gov.ar/wsfev1/service.asmx",
  },
} as const;

/**
 * Acepta el PEM tal cual o codificado en base64.
 *
 * Se detecta por el encabezado: un PEM siempre arranca con "-----BEGIN". Si no
 * está, se asume base64 y se decodifica.
 */
function leerPem(valor: string | undefined): string | null {
  if (!valor) return null;

  const limpio = valor.trim();
  if (limpio.includes("-----BEGIN")) return limpio.replace(/\\n/g, "\n");

  try {
    const decodificado = Buffer.from(limpio, "base64").toString("utf8");
    return decodificado.includes("-----BEGIN") ? decodificado : null;
  } catch {
    return null;
  }
}

export function configArca(): ConfigArca | null {
  const cuit = (process.env.ARCA_CUIT ?? "").replace(/\D/g, "");
  const certificado = leerPem(process.env.ARCA_CERTIFICADO);
  const clavePrivada = leerPem(process.env.ARCA_CLAVE_PRIVADA);

  if (cuit.length !== 11 || !certificado || !clavePrivada) return null;

  const ambiente: AmbienteArca =
    process.env.ARCA_AMBIENTE === "produccion" ? "produccion" : "homologacion";

  return {
    cuit,
    certificado,
    clavePrivada,
    ambiente,
    urlWsaa: ENDPOINTS[ambiente].wsaa,
    urlWsfe: ENDPOINTS[ambiente].wsfe,
  };
}

export function hayArca(): boolean {
  return configArca() !== null;
}

/** Qué falta para poder emitir con valor fiscal, en castellano. */
export function faltaParaArca(): string | null {
  const cuit = (process.env.ARCA_CUIT ?? "").replace(/\D/g, "");
  const faltantes: string[] = [];

  if (cuit.length !== 11) faltantes.push("el CUIT del emisor (ARCA_CUIT)");
  if (!leerPem(process.env.ARCA_CERTIFICADO)) {
    faltantes.push("el certificado digital (ARCA_CERTIFICADO)");
  }
  if (!leerPem(process.env.ARCA_CLAVE_PRIVADA)) {
    faltantes.push("la clave privada (ARCA_CLAVE_PRIVADA)");
  }

  if (faltantes.length === 0) return null;

  return `Falta cargar ${faltantes.join(", ")}.`;
}
