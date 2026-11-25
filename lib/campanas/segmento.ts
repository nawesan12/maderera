import type { Esquemas } from "@/lib/api/tipos";

type SegmentoCampana = Esquemas["SegmentoCampana"];

/*
 * Lo que queda en TS del segmento de una campaña: lo que usa el editor en el
 * navegador. Leerlo, describirlo y contar a quién llega lo hace Go
 * (backend/internal/campanas/logica.go); `duracionDelEnvio` está también ahí,
 * con el mismo golden (testdata/golden/campanas/duraciones.json).
 */

export const SEGMENTO_TODOS: SegmentoCampana = { tipo: "todos", rubros: [], actividad: null };

/**
 * Cuánto tarda en salir una campaña, dicho como se dice: «unos 20 minutos»,
 * «unas 3 horas». Con el tope del servidor propio, mil direcciones son más de
 * cinco horas, y eso hay que saberlo antes de apretar «Enviar».
 */
export function duracionDelEnvio(cantidad: number, porMinuto: number): string {
  const minutos = Math.max(1, Math.ceil(cantidad / Math.max(1, porMinuto)));
  if (minutos < 2) return "un minuto";
  if (minutos < 60) return `unos ${minutos} minutos`;
  const horas = Math.round(minutos / 6) / 10;
  if (horas < 24) return `unas ${String(horas).replace(".", ",")} horas`;
  return `unos ${Math.ceil(horas / 24)} días`;
}
