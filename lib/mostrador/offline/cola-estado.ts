/**
 * Las reglas de la cola de ventas sin conexión.
 *
 * Puro y sin IndexedDB a propósito: acá se decide si una venta se reintenta, se
 * archiva o se da por perdida, y eso es exactamente lo que hay que poder probar
 * sin levantar un navegador.
 *
 * **La regla que gobierna todo: una venta nunca se descarta.** Si el servidor
 * la rechaza por algo que no se va a arreglar solo, queda apartada para que
 * una persona la mire. Perder una venta cobrada es el único error que este
 * módulo no puede cometer.
 */

export type EstadoEnCola =
  | "pendiente"
  | "enviando"
  | "confirmada"
  /** El servidor dijo que no y no tiene sentido insistir. */
  | "rechazada"
  /** Se intentó muchas veces sin suerte: la mira una persona. */
  | "atascada";

export interface ItemDeCola {
  clave: string;
  estado: EstadoEnCola;
  intentos: number;
  /** Momento (epoch ms) a partir del cual se puede volver a intentar. */
  proximoIntentoAt: number;
  ultimoError: string | null;
  /**
   * Lo que devolvió el servidor. `orderId` falta en los movimientos de caja:
   * no generan pedido, y no hay nada que abrir después.
   */
  resultado?: { numero: string; orderId?: string; invoiceId?: string };
}

export type EventoDeCola =
  | { tipo: "enviando" }
  | { tipo: "sincronizada"; numero: string; orderId?: string; invoiceId?: string }
  /** Definitivo: Zod, reglas de negocio, una venta imposible. */
  | { tipo: "rechazada"; motivo: string }
  /** Transitorio: se cayó la red, la base tardó, el servidor devolvió 500. */
  | { tipo: "reintentar"; motivo: string }
  /** No hay sesión: se retiene todo y no se cuenta como intento. */
  | { tipo: "sin_sesion" };

/**
 * Cuántas veces se insiste antes de apartar la venta.
 *
 * Ocho intentos con el retroceso de abajo son unos cinco minutos de porfía.
 * Más que eso deja de ser un problema de red y pasa a ser algo que alguien
 * tiene que mirar.
 */
export const INTENTOS_MAXIMOS = 8;

/** Tope del retroceso: un minuto. Más espaciado se siente colgado. */
export const ESPERA_MAXIMA_MS = 60_000;

export function esperaPara(intentos: number): number {
  return Math.min(2 ** Math.max(intentos, 0) * 1000, ESPERA_MAXIMA_MS);
}

export function nuevoItem(clave: string, ahora = Date.now()): ItemDeCola {
  return {
    clave,
    estado: "pendiente",
    intentos: 0,
    proximoIntentoAt: ahora,
    ultimoError: null,
  };
}

/**
 * La transición.
 *
 * Devuelve un item nuevo, sin tocar el que recibe: así el llamador decide
 * cuándo escribirlo, y el test compara sin sorpresas.
 */
export function reducirCola(
  item: ItemDeCola,
  evento: EventoDeCola,
  ahora = Date.now(),
): ItemDeCola {
  // Lo confirmado no se toca. Una respuesta que llega tarde de un intento
  // anterior no puede devolver la venta a la cola.
  if (item.estado === "confirmada") return item;

  switch (evento.tipo) {
    case "enviando":
      return { ...item, estado: "enviando" };

    case "sincronizada":
      return {
        ...item,
        estado: "confirmada",
        ultimoError: null,
        resultado: {
          numero: evento.numero,
          orderId: evento.orderId,
          invoiceId: evento.invoiceId,
        },
      };

    case "rechazada":
      /*
       * Definitivo: no se reintenta nunca.
       *
       * Un fallo de validación no se arregla insistiendo, y hacerlo sería un
       * bucle infinito contra el servidor. Queda apartada, no borrada.
       */
      return {
        ...item,
        estado: "rechazada",
        ultimoError: evento.motivo,
      };

    case "sin_sesion":
      /*
       * No cuenta como intento.
       *
       * Que se haya vencido la sesión no dice nada sobre la venta: si contara,
       * una jornada larga sin volver a entrar consumiría los ocho intentos y
       * apartaría ventas perfectamente válidas.
       */
      return {
        ...item,
        estado: "pendiente",
        ultimoError: "Hay que volver a iniciar sesión para subir las ventas.",
        proximoIntentoAt: ahora + 5_000,
      };

    case "reintentar": {
      const intentos = item.intentos + 1;

      if (intentos >= INTENTOS_MAXIMOS) {
        return {
          ...item,
          estado: "atascada",
          intentos,
          ultimoError: evento.motivo,
          proximoIntentoAt: ahora,
        };
      }

      return {
        ...item,
        estado: "pendiente",
        intentos,
        ultimoError: evento.motivo,
        proximoIntentoAt: ahora + esperaPara(intentos),
      };
    }
  }
}

/** ¿Le toca a este item ahora? */
export function estaListo(item: ItemDeCola, ahora = Date.now()): boolean {
  return item.estado === "pendiente" && item.proximoIntentoAt <= ahora;
}

export interface ResumenDeCola {
  pendientes: number;
  atascadas: number;
  rechazadas: number;
  /** Lo que hay que subir: pendientes más lo que se está mandando. */
  sinSubir: number;
}

export function resumir(items: ItemDeCola[]): ResumenDeCola {
  const cuenta = (estado: EstadoEnCola) =>
    items.filter((i) => i.estado === estado).length;

  const pendientes = cuenta("pendiente");

  return {
    pendientes,
    atascadas: cuenta("atascada"),
    rechazadas: cuenta("rechazada"),
    sinSubir: pendientes + cuenta("enviando"),
  };
}
