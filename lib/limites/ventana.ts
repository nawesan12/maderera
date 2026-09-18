/**
 * Cuántas veces se puede hacer algo, y cada cuánto.
 *
 * **Por qué hace falta.** No había ni una línea de límite de frecuencia en todo
 * el sistema: ni por IP, ni por sesión, ni por correo. El formulario de ingreso
 * no tenía ninguno —el que trae Better Auth no se aplica, porque las acciones de
 * servidor no pasan por su ruta HTTP— y `confirmarCompra` es pública: cada
 * llamada quema un número de pedido, reserva stock de verdad y manda una orden
 * al aserradero. Un bot no tira el sitio: llena el panel de pedidos falsos y
 * manda a cortar placas que nadie pidió.
 *
 * Acá vive la aritmética, que es lo que se puede probar sin base: **cuándo
 * empieza la ventana y si la cuenta ya se pasó**. El guardado está en
 * `lib/limites/index.ts`.
 *
 * **Ventana fija y no deslizante.** Una ventana deslizante es más justa —no deja
 * pasar una ráfaga a caballo de dos ventanas— pero necesita guardar cada intento
 * con su hora. Con ventana fija alcanza una fila por clave, un contador y un
 * `INSERT … ON CONFLICT`: la operación más barata que puede hacer Postgres. Para
 * lo que esto tiene que frenar —la ráfaga automática, no el fraude fino— es el
 * intercambio correcto.
 */

export interface Limite {
  /** Cuántas veces se permite dentro de la ventana. */
  maximo: number;
  /** El largo de la ventana, en segundos. */
  ventanaSegundos: number;
}

/**
 * El comienzo de la ventana a la que pertenece un momento.
 *
 * Todos los intentos de la misma ventana comparten este valor, y por eso pueden
 * compartir una sola fila. Al pasar a la ventana siguiente el valor cambia, la
 * fila se pisa y la cuenta arranca de cero: no hace falta borrar nada.
 */
export function inicioDeVentana(ahora: Date, ventanaSegundos: number): Date {
  const ms = ventanaSegundos * 1000;
  return new Date(Math.floor(ahora.getTime() / ms) * ms);
}

export interface Veredicto {
  permitido: boolean;
  /** Cuántos intentos quedan en esta ventana. Nunca negativo. */
  quedan: number;
  /** Cuántos segundos faltan para poder reintentar. Cero si se puede ahora. */
  esperaSegundos: number;
}

/**
 * Si un intento entra o no.
 *
 * `cuenta` es cuántos van **incluyendo este**, que es lo que devuelve el
 * `INSERT … ON CONFLICT DO UPDATE SET cuenta = cuenta + 1 RETURNING cuenta`.
 * Contar antes de decidir es lo que hace que dos requests simultáneas no puedan
 * colarse las dos: la base serializa el incremento.
 */
export function evaluar(
  cuenta: number,
  limite: Limite,
  ahora: Date,
  inicio: Date,
): Veredicto {
  const permitido = cuenta <= limite.maximo;

  const finVentana = inicio.getTime() + limite.ventanaSegundos * 1000;
  const faltan = Math.max(0, Math.ceil((finVentana - ahora.getTime()) / 1000));

  return {
    permitido,
    quedan: Math.max(0, limite.maximo - cuenta),
    esperaSegundos: permitido ? 0 : faltan,
  };
}

/**
 * Cómo se le dice a una persona que espere.
 *
 * Quien ve esto es un cliente llenando un formulario, no un atacante leyendo un
 * 429: el texto dice cuánto falta y en qué unidad se entiende. «Esperá 94
 * segundos» no se entiende; «un minuto y medio», sí.
 */
export function cuantoFalta(segundos: number): string {
  if (segundos <= 45) return "unos segundos";
  if (segundos <= 90) return "un minuto";

  const minutos = Math.ceil(segundos / 60);
  if (minutos < 60) return `${minutos} minutos`;

  const horas = Math.ceil(minutos / 60);
  return horas === 1 ? "una hora" : `${horas} horas`;
}
