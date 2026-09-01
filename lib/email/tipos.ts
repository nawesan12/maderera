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
}

export interface ResultadoEmail {
  /** Falso cuando el correo no salió: el motivo va en `error`. */
  enviado: boolean;
  /** Verdadero cuando corrió el proveedor de demostración. */
  simulado: boolean;
  id?: string;
  error?: string;
}

export interface ProveedorEmail {
  nombre: "resend" | "demo";
  real: boolean;
  enviar(mensaje: MensajeEmail): Promise<ResultadoEmail>;
}
