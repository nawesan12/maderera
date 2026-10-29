// @ts-nocheck: copiado tal cual de git 9a17128, ver ../../README.md.
/**
 * Cuánto se gasta en Meta y cuándo se corta.
 *
 * Puro, sin base ni `server-only`: lo usan el servidor (para decidir si un
 * aviso automático sale), la configuración y la bandeja (para mostrarlo), y los
 * tests.
 *
 * **Qué se cobra.** Desde el 1/10/2026 Meta cobra cada mensaje que sale por la
 * Cloud API: las plantillas según su categoría y también las respuestas dentro
 * de la ventana de 24 h, que pasaron a costar lo mismo que una de utilidad. Lo
 * que se manda desde la app WhatsApp Business del teléfono es gratis —con el
 * número en coexistencia o sin ninguna API—, y por eso la plataforma ofrece
 * siempre ese camino al lado del pago.
 *
 * **De dónde sale el número.** Meta informa el cobro en cada estado
 * (`pricing.category` y `pricing.billable`), y la ingesta lo guarda en el
 * mensaje. Entre que el mensaje sale y llega el primer estado pasa un segundo;
 * esos mensajes se cuentan como **estimados** con la categoría que van a
 * tener, para que una ráfaga de avisos no pase el tope antes de que Meta
 * conteste. La factura de Meta es la que vale: esto es para no llevarse
 * sorpresas, no para conciliar.
 */

/** Las categorías de Meta que cobran, con el nombre con que se muestran. */
export const CATEGORIAS_COBRO = ["utility", "service", "marketing", "authentication"] as const;
export type CategoriaCobro = (typeof CATEGORIAS_COBRO)[number];

export const NOMBRE_CATEGORIA: Record<CategoriaCobro, string> = {
  utility: "Utilidad (avisos)",
  service: "Servicio (respuestas)",
  marketing: "Promoción",
  authentication: "Verificación",
};

/**
 * USD por mensaje entregado a un número argentino, vigentes desde el
 * 1/10/2026 (hoja de precios oficial de Meta). Se editan desde la
 * configuración: Meta los revisa cada trimestre.
 */
export const TARIFAS_POR_OMISION: Record<CategoriaCobro, number> = {
  utility: 0.026,
  service: 0.026,
  marketing: 0.0618,
  authentication: 0.026,
};

/** El tope del mes si nadie lo cambió, en USD. */
export const TOPE_POR_OMISION = 10;

/** Los umbrales en los que se avisa al admin, en porcentaje del tope. */
export const UMBRALES = [80, 100] as const;
export type Umbral = (typeof UMBRALES)[number];

/** Lo que queda en la bitácora cuando un aviso no sale por el tope. */
export const MOTIVO_TOPE = "Tope mensual de WhatsApp alcanzado: no salió por la API.";

/**
 * La categoría de tarifa de lo que informa Meta.
 *
 * Meta tiene subcategorías que se cobran como su madre (`marketing_lite`,
 * `authentication_international`) y otras que no se cobran nunca
 * (`referral_conversion`, lo que llega desde un anuncio). Lo que no se conoce
 * se cuenta como servicio: es preferible estimar de más.
 */
export function categoriaDeTarifa(categoria: string | null | undefined): CategoriaCobro | null {
  const c = (categoria ?? "").toLowerCase();
  if (c === "referral_conversion") return null;
  if (c.startsWith("marketing")) return "marketing";
  if (c.startsWith("authentication")) return "authentication";
  if (c.startsWith("utility")) return "utility";
  return "service";
}

/** Las tarifas guardadas, completadas con las de siempre y sin valores raros. */
export function tarifasEfectivas(guardadas?: Record<string, unknown> | null): Record<CategoriaCobro, number> {
  const tarifas = { ...TARIFAS_POR_OMISION };
  for (const categoria of CATEGORIAS_COBRO) {
    const valor = Number(guardadas?.[categoria]);
    if (Number.isFinite(valor) && valor >= 0 && valor < 10) tarifas[categoria] = valor;
  }
  return tarifas;
}

export interface FilaDeGasto {
  /** La categoría que informó Meta, o la estimada si todavía no informó. */
  categoria: string | null;
  /** Si Meta dijo que se factura. Null: todavía no dijo nada. */
  cobrable: boolean | null;
  total: number;
  /** Salió hace un momento y Meta todavía no informó el cobro. */
  estimado?: boolean;
}

export interface DetalleCategoria {
  gratis: number;
  cobrados: number;
  estimados: number;
  usd: number;
}

export interface Gasto {
  usd: number;
  /** Lo que Meta ya confirmó que cobra. */
  usdConfirmado: number;
  /** Lo que salió y todavía no tiene el cobro informado. */
  usdEstimado: number;
  porCategoria: Record<CategoriaCobro, DetalleCategoria>;
}

/** Suma lo que se gasta en el mes con lo que hay registrado. */
export function calcularGasto(filas: FilaDeGasto[], tarifas: Record<CategoriaCobro, number>): Gasto {
  const porCategoria = Object.fromEntries(
    CATEGORIAS_COBRO.map((c) => [c, { gratis: 0, cobrados: 0, estimados: 0, usd: 0 }]),
  ) as Record<CategoriaCobro, DetalleCategoria>;

  let usdConfirmado = 0;
  let usdEstimado = 0;

  for (const fila of filas) {
    const categoria = categoriaDeTarifa(fila.categoria);
    const cantidad = Math.max(0, Math.floor(Number(fila.total) || 0));
    if (!categoria || cantidad === 0) continue;
    const detalle = porCategoria[categoria];

    if (fila.estimado) {
      detalle.estimados += cantidad;
      const usd = cantidad * tarifas[categoria];
      detalle.usd += usd;
      usdEstimado += usd;
    } else if (fila.cobrable) {
      detalle.cobrados += cantidad;
      const usd = cantidad * tarifas[categoria];
      detalle.usd += usd;
      usdConfirmado += usd;
    } else {
      detalle.gratis += cantidad;
    }
  }

  // Centavos de dólar con cuatro decimales: 0,026 × 3 no puede dar 0,07800000001.
  const redondo = (n: number) => Math.round(n * 10_000) / 10_000;
  for (const c of CATEGORIAS_COBRO) porCategoria[c].usd = redondo(porCategoria[c].usd);
  return {
    usd: redondo(usdConfirmado + usdEstimado),
    usdConfirmado: redondo(usdConfirmado),
    usdEstimado: redondo(usdEstimado),
    porCategoria,
  };
}

export interface EstadoDelTope {
  /** De 0 en adelante: 1 es el tope justo. */
  proporcion: number;
  alcanzado: boolean;
  /** El umbral más alto que se pasó, o null. */
  umbral: Umbral | null;
}

/**
 * Dónde está el gasto respecto del tope.
 *
 * Un tope de cero es una decisión válida —«por la API, nada»—: se considera
 * alcanzado desde el primer momento.
 */
export function estadoDelTope(usd: number, tope: number): EstadoDelTope {
  if (!(tope > 0)) return { proporcion: 1, alcanzado: true, umbral: 100 };
  const proporcion = usd / tope;
  const umbral = [...UMBRALES].reverse().find((u) => proporcion * 100 >= u) ?? null;
  return { proporcion, alcanzado: usd >= tope, umbral };
}

/** Los umbrales que ya se pasaron, del más bajo al más alto. */
export function umbralesPasados(usd: number, tope: number): Umbral[] {
  const { proporcion } = estadoDelTope(usd, tope);
  return UMBRALES.filter((u) => proporcion * 100 >= u);
}

/* -------------------------------------------------------------------------- */
/* El mes, en la hora de Argentina                                             */
/* -------------------------------------------------------------------------- */

/**
 * Argentina está en UTC−3 todo el año (no usa horario de verano desde 2009),
 * así que el mes empieza a las 03:00 UTC del día 1. Se calcula con la zona
 * horaria de verdad para el año y el mes, y con el desplazamiento fijo para el
 * instante: un servidor en UTC —el de la VPS— cerraba el mes a las 21 del
 * último día, y un aviso de esa noche se cobraba en el mes que no era.
 */
const ZONA = "America/Argentina/Buenos_Aires";
const DESFASE_HORAS = 3;

function anioYMes(fecha: Date): { anio: number; mes: number } {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit" }).formatToParts(fecha);
  return {
    anio: Number(partes.find((p) => p.type === "year")?.value),
    mes: Number(partes.find((p) => p.type === "month")?.value),
  };
}

/** «2026-10»: la clave del mes en Argentina. */
export function mesArgentino(fecha: Date = new Date()): string {
  const { anio, mes } = anioYMes(fecha);
  return `${anio}-${String(mes).padStart(2, "0")}`;
}

/** El instante en que empezó el mes en Argentina. */
export function inicioDelMesArgentino(fecha: Date = new Date()): Date {
  const { anio, mes } = anioYMes(fecha);
  return new Date(Date.UTC(anio, mes - 1, 1, DESFASE_HORAS));
}

/** El instante en que empieza el mes siguiente: cuando vuelven los avisos. */
export function inicioDelMesSiguienteArgentino(fecha: Date = new Date()): Date {
  const { anio, mes } = anioYMes(fecha);
  return new Date(Date.UTC(anio, mes, 1, DESFASE_HORAS));
}

/** «USD 3,12» con coma decimal, como se lee acá. */
export function dolares(usd: number): string {
  return `USD ${usd.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Una tarifa por mensaje, con los decimales que tiene: «USD 0,026». */
export function tarifaLegible(usd: number): string {
  return `USD ${usd.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}
