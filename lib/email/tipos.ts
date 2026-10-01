/**
 * La forma de un proveedor de correo.
 *
 * Mismo patrón que WhatsApp, ARCA y cobros: quien manda un aviso conoce esta
 * interfaz y no Resend. Sin `RESEND_API_KEY` cargada corre el proveedor de
 * demostración, que arma el correo entero y lo registra sin enviarlo.
 */

export interface AdjuntoEmail {
  nombre: string;
  contenido: Uint8Array;
  tipo: string;
}

export interface MensajeEmail {
  para: string;
  asunto: string;
  html: string;
  /**
   * Versión en texto plano.
   *
   * No es opcional en la práctica: un correo solo-HTML puntúa peor en los
   * filtros de spam, y un aviso de pedido que cae en correo no deseado es un
   * aviso que no existió.
   */
  texto: string;
  responderA?: string;
  adjuntos?: AdjuntoEmail[];
  /**
   * Cabeceras extra. Las usan las campañas para `List-Unsubscribe`: Gmail y
   * Yahoo exigen la baja con un clic a quien manda correo masivo.
   */
  cabeceras?: Record<string, string>;
}

export interface ResultadoEmail {
  /** Falso cuando el correo no salió: el motivo va en `error`. */
  enviado: boolean;
  /** Verdadero cuando corrió el proveedor de demostración. */
  simulado: boolean;
  id?: string;
  error?: string;
  /**
   * El rechazo es temporal (un 4xx del servidor, la conexión que se cortó):
   * reintentarlo más tarde va a andar. Hostinger, por ejemplo, deja salir
   * cinco correos por minuto desde la VPS, y el sexto se rechaza así.
   */
  temporal?: boolean;
}

export interface ProveedorEmail {
  nombre: "resend" | "smtp" | "demo";
  real: boolean;
  enviar(mensaje: MensajeEmail): Promise<ResultadoEmail>;
}
