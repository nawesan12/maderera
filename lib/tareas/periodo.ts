/**
 * El período de una tarea programada: lo que hace que correrla dos veces en
 * la misma hora, día o semana no haga nada dos veces (ver `tareas_corridas`).
 *
 * En hora de Buenos Aires y no en UTC: «el parte del día» es el día de la
 * maderera. En UTC, una corrida a las 22 h de acá ya sería «mañana» y la de
 * las 7 h del día siguiente no correría.
 */
export type Frecuencia = "hora" | "dia" | "semana";

const ZONA = "America/Argentina/Buenos_Aires";

function partes(fecha: Date): { anio: number; mes: number; dia: number; hora: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: ZONA,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(fecha)
      .map((x) => [x.type, x.value]),
  );
  return { anio: +p.year, mes: +p.month, dia: +p.day, hora: +p.hour };
}

const dos = (n: number) => String(n).padStart(2, "0");

export function periodoDe(frecuencia: Frecuencia, fecha: Date = new Date()): string {
  const { anio, mes, dia, hora } = partes(fecha);
  const diaIso = `${anio}-${dos(mes)}-${dos(dia)}`;

  if (frecuencia === "hora") return `${diaIso}T${dos(hora)}`;
  if (frecuencia === "dia") return diaIso;

  // Semana ISO 8601: la que contiene el jueves; el año es el de ese jueves.
  const utc = new Date(Date.UTC(anio, mes - 1, dia));
  const diaSemana = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - diaSemana);
  const inicioDelAnio = Date.UTC(utc.getUTCFullYear(), 0, 1);
  const semana = Math.ceil(((utc.getTime() - inicioDelAnio) / 86_400_000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${dos(semana)}`;
}
