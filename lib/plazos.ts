/**
 * El plazo de respuesta de los presupuestos express.
 *
 * El contrato promete "respuesta en menos de 24 horas" (cláusulas 1.7 y 3.2 de
 * la propuesta). Interpretarlo como 24 horas de jornada laboral —tres días de
 * atención de ocho horas— sería técnicamente defendible y comercialmente
 * absurdo: nadie llama "express" a algo que tarda tres días.
 *
 * Así que son **24 horas de reloj, sin contar sábados ni domingos**. Es lo que
 * cualquiera entiende al leerlo: pido el jueves a las 15, me contestan el
 * viernes a las 15; pido el viernes a las 15, me contestan el lunes a las 15.
 *
 * Sin `server-only` ni dependencias: aritmética de fechas pura, y por eso
 * testeable.
 */

/** Horario de atención de MJBJ, de lunes a viernes. */
const APERTURA = 8;
const CIERRE = 16;

const UN_DIA_MS = 24 * 3_600_000;

function esFinDeSemana(fecha: Date): boolean {
  const dia = fecha.getDay();
  return dia === 0 || dia === 6;
}

/**
 * Vencimiento del compromiso de respuesta.
 *
 * Además de saltear el fin de semana, corre el vencimiento al horario de
 * atención: si cayera a las 3 de la mañana, marcaría como atrasado a las 8 algo
 * que recién se puede contestar a esa hora.
 */
export function vencimientoExpress(desde = new Date()): Date {
  const vence = new Date(desde.getTime() + UN_DIA_MS);

  // Un día completo por cada día no hábil que se atraviesa.
  let vueltas = 0;
  while (esFinDeSemana(vence) && vueltas < 7) {
    vence.setDate(vence.getDate() + 1);
    vueltas++;
  }

  if (vence.getHours() < APERTURA) {
    vence.setHours(APERTURA, 0, 0, 0);
  } else if (vence.getHours() >= CIERRE) {
    // Después del cierre no se contesta: el compromiso llega hasta el final de
    // ese día de atención.
    vence.setHours(CIERRE, 0, 0, 0);
  }

  return vence;
}

/**
 * Cómo se lee un plazo que corre.
 *
 * Devuelve el texto y si conviene marcarlo. La pantalla no debería decidir a
 * partir de cuántas horas algo es urgente: es una regla de negocio y vive acá.
 */
export function estadoDelPlazo(
  vence: Date | null,
  ahora = new Date(),
): { texto: string; urgente: boolean; vencido: boolean } {
  if (!vence) return { texto: "", urgente: false, vencido: false };

  const restanteMs = vence.getTime() - ahora.getTime();
  const horas = restanteMs / 3_600_000;

  if (restanteMs <= 0) {
    const pasadas = Math.floor(-horas);
    return {
      texto: pasadas < 1 ? "Se pasó de hora" : `Se pasó por ${pasadas} h`,
      urgente: true,
      vencido: true,
    };
  }

  if (horas < 1) {
    return {
      texto: `Quedan ${Math.max(1, Math.round(restanteMs / 60_000))} min`,
      urgente: true,
      vencido: false,
    };
  }

  if (horas < 24) {
    return {
      texto: `Quedan ${Math.floor(horas)} h`,
      urgente: horas < 4,
      vencido: false,
    };
  }

  return {
    texto: `Quedan ${Math.floor(horas / 24)} días`,
    urgente: false,
    vencido: false,
  };
}
