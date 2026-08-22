/**
 * Contrato del adaptador de WhatsApp.
 *
 * La bandeja y las Server Actions importan SOLO esta interfaz, nunca un
 * proveedor concreto. Hoy hay dos: la Cloud API de Meta (`cloud`) y uno de
 * demostración (`demo`) que no llama a ningún servicio.
 *
 * Esa separación no es purismo: MJBJ atiende con WhatsApp Business común en un
 * teléfono, y pasar a la Cloud API implica dar de alta el WABA, verificar la
 * empresa y migrar el número. Con el adaptador, todo el panel se construye y se
 * prueba de verdad mientras tanto, y el día que estén las credenciales cambia
 * una variable de entorno.
 */

export type ProveedorId = "cloud" | "demo";

export interface EstadoConexion {
  conectado: boolean;
  proveedor: ProveedorId;
  /** Número del negocio, informativo. */
  telefono: string | null;
  /** Última señal de actividad (epoch ms). */
  ultimaSenal: number | null;
  /** Qué falta para conectar, cuando no lo está. */
  detalle: string | null;
}

export interface ResultadoEnvio {
  waMessageId?: string;
  error?: string;
  /**
   * true cuando el envío falló por estar fuera de la ventana de 24 h. La
   * bandeja lo usa para ofrecer las plantillas en vez de repetir el error.
   */
  fueraDeVentana?: boolean;
}

export type TipoMedia = "image" | "document" | "video" | "audio" | "sticker";

/** Adjunto que sale, ya subido y con URL pública. */
export interface MediaSaliente {
  url: string;
  tipo: Exclude<TipoMedia, "sticker">;
  nombre?: string | null;
  mime?: string | null;
}

/**
 * Plantilla aprobada por Meta.
 *
 * Fuera de la ventana de 24 h es la única forma de escribirle a alguien: el
 * texto lo aprueba Meta de antemano y solo se completan las variables.
 */
export interface PlantillaSaliente {
  nombre: string;
  idioma: string;
  /** Valores de {{1}}, {{2}}, … en orden. */
  variables: string[];
}

export interface PlantillaAprobada {
  nombre: string;
  idioma: string;
  /** Cuerpo con los marcadores {{1}}, {{2}}, … para previsualizar. */
  cuerpo: string;
  variables: number;
  /** Categoría de Meta: marketing, utility, authentication. */
  categoria: string | null;
}

/** Adjunto entrante ya guardado en el almacenamiento propio. */
export interface MediaEntrante {
  url: string;
  tipo: TipoMedia;
  mime?: string | null;
  nombre?: string | null;
}

/** Mensaje entrante ya normalizado, listo para persistir. */
export interface MensajeEntrante {
  waJid: string;
  displayName?: string | null;
  cuerpo: string;
  waMessageId?: string | null;
  /** Momento del mensaje según WhatsApp (epoch ms). */
  timestamp?: number | null;
  media?: MediaEntrante | null;
}

export interface ProveedorWhatsapp {
  readonly id: ProveedorId;
  estado(): Promise<EstadoConexion>;
  enviarTexto(
    waJid: string,
    cuerpo: string,
    media?: MediaSaliente | null,
  ): Promise<ResultadoEnvio>;
  enviarPlantilla(
    waJid: string,
    plantilla: PlantillaSaliente,
  ): Promise<ResultadoEnvio>;
  /** Plantillas aprobadas del WABA, para el selector de la bandeja. */
  listarPlantillas(): Promise<PlantillaAprobada[]>;
}
