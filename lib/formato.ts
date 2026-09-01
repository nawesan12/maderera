/**
 * Formatos compartidos por todo el sitio: importes, fechas, CUIT, plurales.
 *
 * Los precios llegan desde la base como string (columna `numeric`), no como
 * number: convertirlos a punto flotante para mostrarlos abre la puerta a que
 * alguien los sume así, y los importes que terminan en una factura no se calculan
 * con floats.
 *
 * Vive en `lib/` y no en `components/admin/` porque el portal del cliente
 * necesita exactamente los mismos formatos que el panel: una fecha que se lee
 * distinto de un lado y del otro es un error que nadie reporta pero todos notan.
 */

export const moneda = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

export function formatearPrecio(valor: string | number | null): string {
  if (valor === null) return "A consultar";

  const numero = typeof valor === "string" ? Number(valor) : valor;
  if (!Number.isFinite(numero) || numero <= 0) return "A consultar";

  return moneda.format(numero);
}

/**
 * Formatea un importe cualquiera, incluidos el cero y los negativos.
 *
 * `formatearPrecio` está pensado para el catálogo, donde un precio en cero
 * significa "todavía no lo cargamos" y por eso se lee "A consultar". Un saldo
 * de cuenta corriente es otra cosa: cero quiere decir que no se debe nada, y un
 * negativo es plata a favor del cliente. Confundir las dos cosas hacía que la
 * cuenta saldada apareciera como "A consultar".
 */
export function formatearMonto(valor: string | number | null): string {
  if (valor === null) return "—";

  const numero = typeof valor === "string" ? Number(valor) : valor;
  if (!Number.isFinite(numero)) return "—";

  return moneda.format(numero);
}

/* -------------------------------------------------------------------------- */
/* Fechas                                                                      */
/* -------------------------------------------------------------------------- */

export const fechaCorta = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
});

export const fechaLarga = new Intl.DateTimeFormat("es-AR", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

export const fechaHora = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export const hora = new Intl.DateTimeFormat("es-AR", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** "hace 3 días", para listados donde la fecha exacta no aporta. */
export function haceCuanto(fecha: Date | null): string {
  if (!fecha) return "—";

  const minutos = Math.round((Date.now() - fecha.getTime()) / 60000);
  if (minutos < 1) return "recién";
  if (minutos < 60) return `hace ${minutos} min`;

  const horas = Math.round(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;

  const dias = Math.round(horas / 24);
  if (dias === 1) return "ayer";
  if (dias < 30) return `hace ${dias} días`;

  const meses = Math.round(dias / 30);
  return meses === 1 ? "hace un mes" : `hace ${meses} meses`;
}

/** Días que faltan para una fecha. Negativo si ya pasó. */
export function diasHasta(fecha: Date | null): number | null {
  if (!fecha) return null;
  return Math.ceil((fecha.getTime() - Date.now()) / 86_400_000);
}

/* -------------------------------------------------------------------------- */
/* Texto                                                                       */
/* -------------------------------------------------------------------------- */

/** CUIT guardado sin guiones, mostrado como se lee. */
export function formatearCuit(cuit: string | null): string {
  if (!cuit) return "—";
  const limpio = cuit.replace(/\D/g, "");
  if (limpio.length !== 11) return cuit;
  return `${limpio.slice(0, 2)}-${limpio.slice(2, 10)}-${limpio.slice(10)}`;
}

/**
 * Unidad de venta como se dice en el mostrador.
 *
 * En la base se guarda `metro_cuadrado` porque la calculadora, el carrito y la
 * factura tienen que hablar el mismo idioma sin ambigüedad. Pero al cliente se
 * le muestra "m²": nadie pide quince metro_cuadrado de machimbre.
 */
const UNIDADES: Record<string, string> = {
  unidad: "u.",
  metro_lineal: "ml",
  metro_cuadrado: "m²",
  metro_cubico: "m³",
  placa: "placa",
  bolsa: "bolsa",
  kilo: "kg",
  litro: "l",
};

export function formatearUnidad(unidad: string | null): string {
  if (!unidad) return "u.";
  return UNIDADES[unidad] ?? unidad.replace(/_/g, " ");
}

/** Pluraliza sin que quede "1 ítems". */
export function plural(
  cantidad: number,
  singular: string,
  pluralForma?: string,
): string {
  return `${cantidad} ${cantidad === 1 ? singular : (pluralForma ?? singular + "s")}`;
}

/**
 * Fecha sin hora, formateada en UTC.
 *
 * Para fechas que representan un día y no un instante —inicio de actividades,
 * vencimiento del CAE— hay que leerlas en UTC. Con el formateador local, un
 * `1981-03-01` guardado a medianoche UTC se muestra como 28/02 en Argentina,
 * que está tres horas atrás.
 */
export const fechaSolaCorta = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
  timeZone: "UTC",
});

/**
 * Convierte a número un importe tipeado por una persona.
 *
 * Hay que aceptar las formas en que se escribe un precio, porque todas llegan:
 * "528300.00" desde un campo numérico del navegador, "528.300,50" como lo
 * escribe alguien en Argentina, y "1.500.000" cuando se tipea a mano sin
 * decimales.
 *
 * Tres reglas, en orden:
 *
 * 1. **Con coma**, la coma es el decimal y los puntos son de miles.
 * 2. **Sin coma y con más de un punto**, todos los puntos son de miles: no hay
 *    ninguna notación decimal con dos puntos.
 * 3. **Sin coma y con un solo punto**, el punto es decimal y se deja como está.
 *
 * La tercera regla es la importante y no se puede relajar: el error opuesto ya
 * ocurrió, y quitar todos los puntos siempre convertía un cobro de $528.300 en
 * uno de $52.830.000, con la factura dada por cobrada de más. Ante la
 * ambigüedad de un solo punto gana la lectura del navegador, que es la que
 * llega sin que nadie la escriba.
 */
export function parsearImporte(texto: string): number {
  const limpio = texto.trim().replace(/\s/g, "");
  if (!limpio) return NaN;

  if (limpio.includes(",")) {
    return Number(limpio.replace(/\./g, "").replace(",", "."));
  }

  const puntos = (limpio.match(/\./g) ?? []).length;
  if (puntos > 1) return Number(limpio.replace(/\./g, ""));

  return Number(limpio);
}

/**
 * El nombre de pila, para saludar.
 *
 * Salta el título profesional. Las fichas del mostrador vienen cargadas como
 * "Arq. Carolina Méndez" o "Ing. Silvia Roldán", y quedarse con la primera
 * palabra saludaba "Hola, Arq.". Se veía en el portal, en el navbar y —lo peor—
 * en las plantillas de WhatsApp, que son mensajes que salen para afuera.
 *
 * Si después del título no queda nada, devuelve el nombre entero: es preferible
 * un saludo formal a uno vacío.
 */
const TITULOS = new Set([
  "arq", "ing", "lic", "dr", "dra", "sr", "sra", "srta", "cont", "tec", "téc",
  "prof", "mg", "esc", "cr", "cra",
]);

export function primerNombre(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "";

  const sinTitulo = partes.filter(
    (p) => !TITULOS.has(p.replace(/\.$/, "").toLowerCase()),
  );

  return sinTitulo[0] ?? partes[0];
}
