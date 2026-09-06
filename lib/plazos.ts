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

/** Horario de atención, de lunes a viernes. Del brief: de 8 a 16. */
const APERTURA = 8;
const CIERRE = 16;

/**
 * El sábado se atiende media jornada.
 *
 * Del brief: la cola de cortes se atiende *"de Lunes a Viernes de 8 a 16hs y
 * los Sabados de 8 a 12hs"*. El código saltaba el sábado entero, así que un
 * pedido del viernes a la tarde se comprometía para el lunes cuando en los
 * hechos se contesta el sábado a la mañana.
 */
const CIERRE_SABADO = 12;

const UN_DIA_MS = 24 * 3_600_000;

function esDomingo(fecha: Date): boolean {
  return fecha.getDay() === 0;
}

function esSabado(fecha: Date): boolean {
  return fecha.getDay() === 6;
}

/** Hasta qué hora se atiende ese día. Cero significa cerrado. */
function cierreDelDia(fecha: Date): number {
  if (esDomingo(fecha)) return 0;
  return esSabado(fecha) ? CIERRE_SABADO : CIERRE;
}

/**
 * Vencimiento del compromiso de respuesta.
 *
 * Además de saltear el fin de semana, corre el vencimiento al horario de
 * atención: si cayera a las 3 de la mañana, marcaría como atrasado a las 8 algo
 * que recién se puede contestar a esa hora.
 */
export function vencimientoExpress(desde = new Date()): Date {
  return acomodarAlHorario(new Date(desde.getTime() + UN_DIA_MS));
}

/**
 * El compromiso general: **el mismo día**.
 *
 * Del brief, a "¿en cuánto tiempo responden un presupuesto?": *"Mismo día"*.
 * Hasta ahora solo los profesionales aprobados entraban con un plazo y el
 * resto no tenía ninguno, así que un presupuesto pedido desde el sitio no
 * aparecía en ninguna cola con urgencia y podía quedar días sin contestar.
 *
 * Vence al cierre del día en que entró. Si llega después del cierre —o un
 * domingo—, el compromiso es el cierre del próximo día de atención: prometer
 * "hoy" a las once de la noche sería prometer algo que ya no se puede cumplir.
 */
export function vencimientoDelDia(desde = new Date()): Date {
  const vence = new Date(desde);
  const cierre = cierreDelDia(vence);

  if (cierre > 0 && vence.getHours() < cierre) {
    vence.setHours(cierre, 0, 0, 0);
    return vence;
  }

  // Ya cerró: al día de atención siguiente.
  vence.setDate(vence.getDate() + 1);
  vence.setHours(APERTURA, 0, 0, 0);
  return acomodarAlHorario(vence);
}

/**
 * Corre una fecha al horario en que efectivamente se atiende.
 *
 * Sin esto un vencimiento a las 3 de la mañana marca como atrasado a las 8
 * algo que recién se puede contestar a esa hora.
 */
function acomodarAlHorario(fecha: Date): Date {
  const vence = new Date(fecha);

  // Salta los días cerrados. El tope de vueltas evita un bucle si alguna vez
  // se marcaran todos los días como cerrados.
  let vueltas = 0;
  while (cierreDelDia(vence) === 0 && vueltas < 7) {
    vence.setDate(vence.getDate() + 1);
    vence.setHours(APERTURA, 0, 0, 0);
    vueltas++;
  }

  const cierre = cierreDelDia(vence);

  if (vence.getHours() < APERTURA) {
    vence.setHours(APERTURA, 0, 0, 0);
  } else if (vence.getHours() >= cierre) {
    // Después del cierre no se contesta: el compromiso llega hasta el final de
    // ese día de atención.
    vence.setHours(cierre, 0, 0, 0);
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
