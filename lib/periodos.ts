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
