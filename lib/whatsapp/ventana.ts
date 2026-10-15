/**
 * La ventana de 24 horas, en un solo lugar.
 *
 * Es la regla que más condiciona la bandeja: desde el último mensaje del
 * cliente hay 24 horas para contestarle lo que sea —texto, fotos, el PDF del
 * presupuesto—. Pasado ese plazo WhatsApp solo deja mandar una plantilla
 * aprobada. Desde el 1/10/2026 las dos cosas se cobran (ver `costos.ts`).
 *
 * **Solo un mensaje del cliente abre la ventana.** Con el número en
 * coexistencia, lo que el personal escribe desde la app del teléfono no la
 * abre, no la estira ni se cobra (lo dice Meta en «Onboarding WhatsApp
 * Business app users»): por eso los ecos no tocan `ultimoEntranteAt`. Lo usan el servidor (para decidir qué
 * mandar) y el navegador (para decirlo en pantalla), así que es puro.
 */

export const VENTANA_HORAS = 24;
export const VENTANA_MS = VENTANA_HORAS * 3_600_000;

function aFecha(valor: Date | string | number | null | undefined): Date | null {
  if (valor === null || valor === undefined) return null;
  const fecha = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

/** Si todavía se puede contestar con mensaje libre. */
export function ventanaAbierta(
  ultimoEntranteAt: Date | string | number | null | undefined,
  ahora: number = Date.now(),
): boolean {
  const fecha = aFecha(ultimoEntranteAt);
  if (!fecha) return false;
  const pasado = ahora - fecha.getTime();
  return pasado >= 0 ? pasado < VENTANA_MS : true;
}

/** Cuándo se cierra, o null si ya está cerrada. */
export function cierreDeVentana(
  ultimoEntranteAt: Date | string | number | null | undefined,
  ahora: number = Date.now(),
): Date | null {
  const fecha = aFecha(ultimoEntranteAt);
  if (!fecha || !ventanaAbierta(fecha, ahora)) return null;
  return new Date(fecha.getTime() + VENTANA_MS);
}

/**
 * Lo que queda de ventana, para decirlo como lo diría una persona: «3 h»,
 * «40 min». Por debajo de una hora se cuentan minutos porque es justo cuando
 * importa apurarse.
 */
export function restanteLegible(
  ultimoEntranteAt: Date | string | number | null | undefined,
  ahora: number = Date.now(),
): string | null {
  const cierre = cierreDeVentana(ultimoEntranteAt, ahora);
  if (!cierre) return null;
  const minutos = Math.max(Math.floor((cierre.getTime() - ahora) / 60_000), 0);
  if (minutos < 60) return `${minutos} min`;
  return `${Math.floor(minutos / 60)} h`;
}

export type DecisionDeEnvio =
  | { como: "texto" }
  | { como: "plantilla" }
  | { como: "omitir"; motivo: "baja" | "sin-plantilla" | "apagado" };

/**
 * Cómo sale un aviso automático.
 *
 * - Si el número pidió la baja, no sale nada: ni gratis ni pago.
 * - Dentro de la ventana y con texto libre cargado, sale como mensaje común
 *   (que desde el 1/10/2026 se cobra como uno de utilidad).
 * - Si no, sale la plantilla (la que se cobra según su categoría), y si no hay
 *   plantilla aprobada no sale: un aviso que Meta rechazaría no se intenta.
 */
export function decidirEnvio(opciones: {
  activo: boolean;
  baja: boolean;
  ventanaAbierta: boolean;
  hayTextoLibre: boolean;
  hayPlantilla: boolean;
}): DecisionDeEnvio {
  if (!opciones.activo) return { como: "omitir", motivo: "apagado" };
  if (opciones.baja) return { como: "omitir", motivo: "baja" };
  if (opciones.ventanaAbierta && opciones.hayTextoLibre) return { como: "texto" };
  if (opciones.hayPlantilla) return { como: "plantilla" };
  return { como: "omitir", motivo: "sin-plantilla" };
}

/**
 * Si un texto entrante es un pedido de baja.
 *
 * WhatsApp no tiene un «desuscribirse» propio para los avisos de utilidad, así
 * que la convención es la de los SMS: escribir BAJA. Se aceptan las variantes
 * que escribe la gente de verdad —«baja», «STOP», «no me manden más»,
 * «darme de baja»—, pero solo si el mensaje es eso y nada más: «¿me das de
 * baja el pedido de ayer?» es una consulta, no una baja.
 */
export function esPedidoDeBaja(texto: string): boolean {
  const limpio = normalizar(texto);
  if (!limpio || limpio.length > 40) return false;
  return PATRONES_BAJA.some((patron) => patron.test(limpio));
}

/** «ALTA» vuelve a habilitar los avisos a quien se había dado de baja. */
export function esPedidoDeAlta(texto: string): boolean {
  const limpio = normalizar(texto);
  return /^(alta|start|darme de alta|quiero recibir (los )?avisos)$/.test(limpio);
}

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const PATRONES_BAJA = [
  /^(baja|stop|parar|basta|cancelar suscripcion|desuscribir(me)?)$/,
  /^(dar(me)? de baja|darse de baja|quiero (darme de )?baja|quiero la baja|baja por favor|por favor baja)$/,
  /^no (me )?(manden|envien|escriban|mandes|envies|escribas) mas( (avisos|mensajes|nada))?( por favor)?$/,
  /^no quiero (recibir )?mas (avisos|mensajes)( por favor)?$/,
];
