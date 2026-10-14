/**
 * Contrato del adaptador de WhatsApp.
 *
 * La bandeja, los avisos y la ingesta piden el proveedor a `lib/whatsapp` y
 * solo conocen esta interfaz. Hay dos: la Cloud API de Meta (`cloud`) y uno de
 * demostración (`demo`) que no llama a ningún servicio.
 *
 * La Cloud API también se prueba sin Meta: con `WHATSAPP_GRAPH_URL` apuntando
 * al simulador (`scripts/simulador-meta.ts`) el proveedor `cloud` habla HTTP de
 * verdad, con los mismos pedidos y las mismas respuestas —errores incluidos—
 * que daría Meta. El de demostración queda para cuando no hay nada configurado.
 */

import type { Accion } from "./errores";
import type { ComponenteMeta } from "./plantillas";

export type ProveedorId = "cloud" | "demo";

export interface EstadoConexion {
  conectado: boolean;
  proveedor: ProveedorId;
  /** Número del negocio, informativo. */
  telefono: string | null;
  /** Último movimiento (epoch ms). */
  ultimaSenal: number | null;
  /** Qué falta para conectar, cuando no lo está. */
  detalle: string | null;
}

export interface ErrorDeEnvio {
  codigo: number | null;
  /** Para la bandeja, en castellano y con qué hacer. */
  texto: string;
  accion: Accion;
  /** Lo que dijo Meta, tal cual, para el registro. */
  detalle: string | null;
}

export interface ResultadoEnvio {
  waMessageId?: string;
  error?: ErrorDeEnvio;
}

export type ClaseMedia = "image" | "document" | "audio" | "video";

/** Un adjunto que sale: ya subido a Meta (id) o en una URL que Meta pueda bajar. */
export type ReferenciaMedia = { id: string } | { link: string };

export type MensajeSaliente =
  | {
      tipo: "texto";
      cuerpo: string;
      /** Responde citando este mensaje. */
      citado?: string | null;
    }
  | {
      tipo: "media";
      clase: ClaseMedia;
      media: ReferenciaMedia;
      epigrafe?: string | null;
      nombreArchivo?: string | null;
      citado?: string | null;
    }
  | {
      tipo: "plantilla";
      nombre: string;
      idioma: string;
      /** Los `components` ya armados (ver `armarComponentes`). */
      componentes: Record<string, unknown>[];
    }
  | {
      tipo: "reaccion";
      aMensaje: string;
      /** Vacío para sacar la reacción. */
      emoji: string;
    };

/** Una plantilla tal como la devuelve `GET /{waba}/message_templates`. */
export interface PlantillaRemota {
  metaId: string | null;
  nombre: string;
  idioma: string;
  categoria: string | null;
  estado: string;
  motivoRechazo: string | null;
  formatoParametros: "POSITIONAL" | "NAMED";
  componentes: ComponenteMeta[];
}

/** Un punto del chequeo de la configuración. */
export interface PuntoDeDiagnostico {
  clave: string;
  titulo: string;
  estado: "ok" | "aviso" | "error";
  detalle: string;
}

export interface Diagnostico {
  puntos: PuntoDeDiagnostico[];
  numero: {
    telefono: string | null;
    nombreVerificado: string | null;
    calidad: string | null;
    limite: string | null;
    estadoNombre: string | null;
    plataforma: string | null;
  } | null;
}

export interface ProveedorWhatsapp {
  readonly id: ProveedorId;
  estado(): Promise<EstadoConexion>;
  /** Manda un mensaje a un número (`wa_id`, solo dígitos). Nunca lanza. */
  enviar(waId: string, mensaje: MensajeSaliente): Promise<ResultadoEnvio>;
  /**
   * Sube un archivo a Meta y devuelve su id. Es la forma de mandar un PDF de
   * la plataforma sin publicarlo en una URL: el presupuesto de un cliente no
   * tiene por qué estar en internet para que Meta lo vaya a buscar.
   */
  subirMedia(
    contenido: Uint8Array,
    mime: string,
    nombre: string,
  ): Promise<{ id?: string; error?: ErrorDeEnvio }>;
  /** Baja un adjunto que mandó un cliente, por su id. */
  bajarMedia(
    mediaId: string,
  ): Promise<{ contenido: Uint8Array; mime: string } | { error: string }>;
  /** Avisa que se leyó un mensaje: el cliente ve los dos tildes azules. */
  marcarLeido(waMessageId: string): Promise<void>;
  /** Todas las plantillas del WABA, con su estado. */
  listarPlantillas(): Promise<{ plantillas: PlantillaRemota[] } | { error: string }>;
  /** El chequeo de la configuración: token, número, WABA, webhook. */
  diagnosticar(): Promise<Diagnostico>;
}
