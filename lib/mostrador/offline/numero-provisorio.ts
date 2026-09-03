/**
 * El número que se lleva el cliente cuando la venta se hizo sin internet.
 *
 * Del estilo `CAJA1-017`: el código lo asigna el servidor al vincular la
 * máquina, y el contador lo lleva la máquina en su almacén local.
 *
 * **Nunca se reinicia.** Ni por día ni por turno: un ticket de ayer y uno de
 * hoy no pueden compartir etiqueta, porque el papel provisorio es lo único que
 * tiene el cliente para reclamar y lo único con lo que el mostrador puede
 * encontrar la venta.
 *
 * Es una función pura para poder probarla: decide qué dice un papel que se
 * entrega, y eso es plata.
 */

/** Tres dígitos con ceros adelante hasta el 999, y de ahí en más lo que haga falta. */
export function numeroProvisorio(codigoDeCaja: string, contador: number): string {
  const n = Math.max(1, Math.floor(contador));
  return `${codigoDeCaja}-${String(n).padStart(3, "0")}`;
}

/** ¿Es un número provisorio y no un `PED-n` del servidor? */
export function esProvisorio(numero: string | null | undefined): boolean {
  return Boolean(numero) && !/^PED-/i.test(numero!);
}

/**
 * Acota la hora que reclama el mostrador antes de guardarla como fecha de la
 * venta.
 *
 * El reloj de la máquina puede estar mal, y de esa hora salen las ventas del
 * día y el cierre de caja. Nunca en el futuro —una venta con fecha de mañana
 * desaparece de todos los listados— y nunca más de una semana atrás, que es
 * más de lo que puede durar un corte real.
 */
const SIETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;

export function fechaAcotada(reclamada: Date, ahora: Date = new Date()): Date {
  const t = reclamada.getTime();

  if (!Number.isFinite(t)) return ahora;
  if (t > ahora.getTime()) return ahora;
  if (t < ahora.getTime() - SIETE_DIAS_MS) return new Date(ahora.getTime() - SIETE_DIAS_MS);

  return reclamada;
}
