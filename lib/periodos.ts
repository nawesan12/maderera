/**
 * Períodos para filtrar las pantallas del panel.
 *
 * Existe para que "este mes" signifique lo mismo en el Resumen, en Cobros y en
 * Facturación. Antes cada pantalla calculaba su propio corte con
 * `new Date()` y `setDate(1)` repetido en tres archivos, y la que no lo hacía
 * mostraba todo junto sin decirlo.
 *
 * Es puro y recibe el "ahora" como parámetro: una función de fechas que lee el
 * reloj por su cuenta no se puede probar, y estas deciden qué números ve
 * alguien que está por tomar una decisión con ellos.
 */

export type ClavePeriodo =
  | "mes"
  | "mes-pasado"
  | "trimestre"
  | "anio"
  | "todo";

export interface Periodo {
  clave: ClavePeriodo;
  etiqueta: string;
  /** Desde cuándo cuenta. `null` en "todo". */
  desde: Date | null;
  /** Hasta cuándo, exclusivo. `null` si llega hasta ahora. */
  hasta: Date | null;
  /** El mismo lapso inmediatamente anterior, para comparar. */
  anterior: { desde: Date; hasta: Date } | null;
}

export const PERIODOS: { clave: ClavePeriodo; etiqueta: string }[] = [
  { clave: "mes", etiqueta: "Este mes" },
  { clave: "mes-pasado", etiqueta: "Mes pasado" },
  { clave: "trimestre", etiqueta: "Últimos 90 días" },
  { clave: "anio", etiqueta: "Este año" },
  { clave: "todo", etiqueta: "Todo" },
];

export const PERIODO_POR_OMISION: ClavePeriodo = "mes";

function inicioDeMes(fecha: Date, desplazamiento = 0): Date {
  return new Date(
    fecha.getFullYear(),
    fecha.getMonth() - desplazamiento,
    1,
    0,
    0,
    0,
    0,
  );
}

/** Lee la clave que vino en la URL. Cualquier cosa rara cae en la de siempre. */
export function leerPeriodo(valor?: string): ClavePeriodo {
  return PERIODOS.some((p) => p.clave === valor)
    ? (valor as ClavePeriodo)
    : PERIODO_POR_OMISION;
}

export function resolverPeriodo(
  clave: ClavePeriodo,
  ahora: Date = new Date(),
): Periodo {
  const etiqueta =
    PERIODOS.find((p) => p.clave === clave)?.etiqueta ?? "Este mes";

  if (clave === "todo") {
    return { clave, etiqueta, desde: null, hasta: null, anterior: null };
  }

  if (clave === "mes-pasado") {
    const desde = inicioDeMes(ahora, 1);
    const hasta = inicioDeMes(ahora, 0);
    return {
      clave,
      etiqueta,
      desde,
      hasta,
      anterior: { desde: inicioDeMes(ahora, 2), hasta: desde },
    };
  }

  if (clave === "trimestre") {
    const desde = new Date(ahora);
    desde.setDate(desde.getDate() - 90);
    desde.setHours(0, 0, 0, 0);
    const anteriorDesde = new Date(desde);
    anteriorDesde.setDate(anteriorDesde.getDate() - 90);
    return {
      clave,
      etiqueta,
      desde,
      hasta: null,
      anterior: { desde: anteriorDesde, hasta: desde },
    };
  }

  if (clave === "anio") {
    const desde = new Date(ahora.getFullYear(), 0, 1, 0, 0, 0, 0);
    return {
      clave,
      etiqueta,
      desde,
      hasta: null,
      anterior: {
        desde: new Date(ahora.getFullYear() - 1, 0, 1, 0, 0, 0, 0),
        hasta: desde,
      },
    };
  }

  const desde = inicioDeMes(ahora, 0);
  return {
    clave,
    etiqueta,
    desde,
    hasta: null,
    anterior: { desde: inicioDeMes(ahora, 1), hasta: desde },
  };
}

/**
 * El período mensual de la URL, del estilo `2026-03`.
 *
 * Lo usan el libro IVA de ventas, el de compras y el cierre del mes. Estaba
 * escrito dos veces —la página y su exportación— con la misma fórmula copiada,
 * que es como una arregla un borde y la otra no.
 *
 * `hasta` incluye el último milisegundo del último día: un comprobante emitido
 * a las 23:50 del 31 pertenece a ese mes.
 */
export function leerPeriodoMensual(
  valor: string | null | undefined,
  ahora: Date = new Date(),
): { anio: number; mes: number; desde: Date; hasta: Date; clave: string } {
  const [anioTexto, mesTexto] = (valor ?? "").split("-");

  const anio = Number(anioTexto) || ahora.getFullYear();
  const mesCrudo = Number(mesTexto) || ahora.getMonth() + 1;
  const mes = Math.min(Math.max(mesCrudo, 1), 12);

  return {
    anio,
    mes,
    desde: new Date(anio, mes - 1, 1, 0, 0, 0, 0),
    hasta: new Date(anio, mes, 0, 23, 59, 59, 999),
    clave: `${anio}-${String(mes).padStart(2, "0")}`,
  };
}

/**
 * Un rango de fechas libre, del estilo `2026-03-01` a `2026-03-15`.
 *
 * Existe porque los presets no alcanzan para la pregunta que la clienta hace
 * todos los días: **«¿cuánto facturamos de contado el sábado?»**. Ni «este mes»
 * ni «últimos 90 días» contestan eso, y el selector de mes tampoco: hace falta
 * poder decir un día, o una semana.
 *
 * Reglas, que son las que evitan los rangos imposibles:
 *
 * - Una sola fecha vale: si falta el `hasta`, es ese día solo. Es el caso más
 *   común —un día concreto— y obligar a escribirlo dos veces sería un paso de
 *   más.
 * - Si vienen al revés, se dan vuelta. Quien escribe «del 15 al 1» quiere del 1
 *   al 15, no un resultado vacío.
 * - `hasta` incluye el día entero: una factura de las 23:50 entra en su día.
 */
export function leerRango(
  desdeCrudo: string | null | undefined,
  hastaCrudo: string | null | undefined,
): { desde: Date; hasta: Date; clave: string } | null {
  const desde = fechaDeTexto(desdeCrudo);
  const hasta = fechaDeTexto(hastaCrudo);

  if (!desde && !hasta) return null;

  const a = desde ?? hasta!;
  const b = hasta ?? desde!;

  const inicio = a <= b ? a : b;
  const fin = a <= b ? b : a;

  return {
    desde: new Date(
      inicio.getFullYear(),
      inicio.getMonth(),
      inicio.getDate(),
      0,
      0,
      0,
      0,
    ),
    hasta: new Date(
      fin.getFullYear(),
      fin.getMonth(),
      fin.getDate(),
      23,
      59,
      59,
      999,
    ),
    clave: `${comoTexto(inicio)}_${comoTexto(fin)}`,
  };
}

/** `2026-03-15` a fecha local. Cualquier otra cosa es `null`. */
function fechaDeTexto(valor: string | null | undefined): Date | null {
  if (!valor) return null;

  const [anio, mes, dia] = valor.split("-").map(Number);
  if (!anio || !mes || !dia) return null;
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;

  const fecha = new Date(anio, mes - 1, dia);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

/** Al revés: fecha a `2026-03-15`, que es lo que espera un input de fecha. */
export function comoTexto(fecha: Date): string {
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}-${String(
    fecha.getDate(),
  ).padStart(2, "0")}`;
}
