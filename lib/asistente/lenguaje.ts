/**
 * Minúsculas y sin acentos.
 *
 * Es el equivalente en TypeScript de lo que hace `f_unaccent` en la base, y
 * está para lo mismo: nadie escribe los acentos cuando busca rápido.
 *
 * **El motor del asistente ya no está acá.** Desde el 10/11/2026 lo que se
 * entiende de un texto lo decide Go (`backend/internal/asistente`, por
 * `POST /api/v1/asistente/entender`): es el mismo motor que contesta el bot de
 * WhatsApp, y tener una copia en cada lado era la forma de que el sitio y el
 * WhatsApp entendieran distinto. Esto queda porque el cortador lo usa para
 * elegir la placa por el material (`lib/cortes/enlace.ts`), y tiene que dar lo
 * mismo que `asistente.Normalizar`.
 */
export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w\s.,x/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * El mensaje de WhatsApp con lo que la persona escribió en el asistente, tal
 * cual: «quería consultar por necesito tirantes» no se leía (mes 23). Arranca
 * con mayúscula y cierra con punto si no traía signo.
 */
export function mensajeDesdeElAsistente(escrito: string): string {
  const t = escrito.trim().replace(/\s+/g, " ").slice(0, 200);
  if (!t) return "Hola! Vengo de la web.";
  const frase = t.replace(/^([¿¡"«]*)(\p{L})/u, (_, signos: string, letra: string) => signos + letra.toLocaleUpperCase("es-AR"));
  return `Hola! Vengo de la web. ${/[.!?…]$/.test(frase) ? frase : `${frase}.`}`;
}
