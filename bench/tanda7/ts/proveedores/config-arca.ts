// Copia de git 56ef2a1 (antes de la mudanza a Go) para el benchmark de la tanda 7.
import "server-only";

import { readFileSync } from "node:fs";
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
 *
 * **En el servidor propio van como archivos**, no como variables:
 *   ARCA_CERTIFICADO_ARCHIVO     ruta al certificado (PEM)
 *   ARCA_CLAVE_PRIVADA_ARCHIVO   ruta a la clave privada (PEM)
 *
 * El compose monta la carpeta `secretos/arca/` del servidor en solo lectura y
 * ya trae las dos rutas puestas. Así la clave no queda en `.env.produccion` —que
 * se copia, se pega y se muestra con `docker inspect`— ni horneada en la
 * imagen. Si están las dos formas, gana la variable con el contenido.
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

/**
 * El contenido de una credencial: de la variable, o del archivo que nombra
 * `<VARIABLE>_ARCHIVO`.
 *
 * Un archivo que no está o no se puede leer cuenta como «no hay credencial»:
 * el sistema sigue con el proveedor interno, igual que sin variables, y la
 * pantalla de facturación dice qué falta. El compose declara las rutas aunque
 * el certificado todavía no se haya tramitado.
 */
function leerCredencial(variable: string): string | undefined {
  const directa = process.env[variable];
  if (directa) return directa;

  const ruta = process.env[`${variable}_ARCHIVO`];
  if (!ruta) return undefined;

  try {
    return readFileSync(ruta, "utf8");
  } catch {
    return undefined;
  }
}

export function configArca(): ConfigArca | null {
  const cuit = (process.env.ARCA_CUIT ?? "").replace(/\D/g, "");
  const certificado = leerPem(leerCredencial("ARCA_CERTIFICADO"));
  const clavePrivada = leerPem(leerCredencial("ARCA_CLAVE_PRIVADA"));

  if (cuit.length !== 11 || !certificado || !clavePrivada) return null;

  const ambiente: AmbienteArca =
    process.env.ARCA_AMBIENTE === "produccion" ? "produccion" : "homologacion";

  return {
    cuit,
    certificado,
    clavePrivada,
    ambiente,
    // Solo en la copia del benchmark: el simulador de ARCA.
    urlWsaa: process.env.ARCA_URL_WSAA || ENDPOINTS[ambiente].wsaa,
    urlWsfe: process.env.ARCA_URL_WSFE || ENDPOINTS[ambiente].wsfe,
  };
}

export function hayArca(): boolean {
  return configArca() !== null;
}

/**
 * Si el certificado y la clave están cargados, cada uno por su lado.
 *
 * Los usa la lista de pasos de `/admin/arca`. Antes miraba las variables a
 * secas, y con los archivos montados del servidor propio el paso habría
 * quedado sin tildar aunque el certificado estuviera puesto.
 */
export function hayCertificadoArca(): boolean {
  return leerPem(leerCredencial("ARCA_CERTIFICADO")) !== null;
}

export function hayClaveArca(): boolean {
  return leerPem(leerCredencial("ARCA_CLAVE_PRIVADA")) !== null;
}

/** Qué falta para poder emitir con valor fiscal, en castellano. */
export function faltaParaArca(): string | null {
  const cuit = (process.env.ARCA_CUIT ?? "").replace(/\D/g, "");
  const faltantes: string[] = [];

  if (cuit.length !== 11) faltantes.push("el CUIT del emisor (ARCA_CUIT)");
  if (!leerPem(leerCredencial("ARCA_CERTIFICADO"))) {
    faltantes.push(
      process.env.ARCA_CERTIFICADO_ARCHIVO
        ? `el certificado digital (${process.env.ARCA_CERTIFICADO_ARCHIVO})`
        : "el certificado digital (ARCA_CERTIFICADO)",
    );
  }
  if (!leerPem(leerCredencial("ARCA_CLAVE_PRIVADA"))) {
    faltantes.push(
      process.env.ARCA_CLAVE_PRIVADA_ARCHIVO
        ? `la clave privada (${process.env.ARCA_CLAVE_PRIVADA_ARCHIVO})`
        : "la clave privada (ARCA_CLAVE_PRIVADA)",
    );
  }

  if (faltantes.length === 0) return null;

  return `Falta cargar ${faltantes.join(", ")}.`;
}
