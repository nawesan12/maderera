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
