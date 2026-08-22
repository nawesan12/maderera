/**
 * Formatos de la bandeja, del lado del cliente.
 *
 * `lib/formato.ts` no sirve acá para las fechas porque estos componentes son
 * "use client" y reciben las fechas ya serializadas; y `haceCuanto` de allá
 * espera un Date que puede venir null. Estas son las variantes que necesita la
 * bandeja, donde el tiempo se lee distinto: en un chat importa la hora del
 * mensaje, no cuántos días pasaron.
 */

const hora = new Intl.DateTimeFormat("es-AR", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const diaMes = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
});

const diaCompleto = new Intl.DateTimeFormat("es-AR", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

/** "hace 5 min" para la lista de conversaciones. */
export function haceCuanto(fecha: Date | string | null): string {
  if (!fecha) return "";

  const momento = typeof fecha === "string" ? new Date(fecha) : fecha;
  const minutos = Math.round((Date.now() - momento.getTime()) / 60000);

  if (minutos < 1) return "recién";
  if (minutos < 60) return `${minutos} min`;

  const horas = Math.round(minutos / 60);
  if (horas < 24) return hora.format(momento);

  const dias = Math.round(horas / 24);
  if (dias === 1) return "ayer";
  if (dias < 7) return `${dias} días`;

  return diaMes.format(momento);
}

/** Hora del mensaje dentro del hilo. */
export function horaMensaje(fecha: Date | string): string {
  return hora.format(typeof fecha === "string" ? new Date(fecha) : fecha);
}

/** Separador de día entre mensajes: "hoy", "ayer" o la fecha escrita. */
export function etiquetaDia(fecha: Date | string): string {
  const momento = typeof fecha === "string" ? new Date(fecha) : fecha;
  const hoy = new Date();

  const mismoDia = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (mismoDia(momento, hoy)) return "Hoy";

  const ayer = new Date(hoy);
  ayer.setDate(hoy.getDate() - 1);
  if (mismoDia(momento, ayer)) return "Ayer";

  return diaCompleto.format(momento);
}

/** Número legible a partir del JID de WhatsApp. */
export function jidCorto(waJid: string): string {
  const digitos = waJid.split("@")[0].replace(/\D/g, "");
  if (digitos.length < 10) return waJid;

  const sinPais = digitos.startsWith("549")
    ? digitos.slice(3)
    : digitos.replace(/^54/, "");

  const area = sinPais.slice(0, 3);
  const resto = sinPais.slice(3);

  return `${area} ${resto.slice(0, resto.length - 4)}-${resto.slice(-4)}`;
}

/** Cuántas horas quedan de la ventana de 24 h para contestar con texto libre. */
export function horasDeVentana(ultimoEntranteAt: Date | string | null): number {
  if (!ultimoEntranteAt) return 0;

  const momento =
    typeof ultimoEntranteAt === "string"
      ? new Date(ultimoEntranteAt)
      : ultimoEntranteAt;

  const restantes = 24 - (Date.now() - momento.getTime()) / 3_600_000;
  return Math.max(Math.floor(restantes), 0);
}
