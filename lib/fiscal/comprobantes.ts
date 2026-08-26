/**
 * Qué comprobante corresponde emitir, y cómo lo nombra ARCA.
 *
 * La letra de una factura no se elige: sale de cruzar la condición frente al
 * IVA de quien emite con la de quien recibe. Dejarlo a criterio de quien
 * factura es la vía más rápida a emitir una A a un consumidor final, que
 * después hay que anular con una nota de crédito.
 */

export type CondicionIva =
  | "responsable_inscripto"
  | "monotributista"
  | "exento"
  | "consumidor_final"
  | "no_categorizado";

export type Letra = "A" | "B" | "C";

export type TipoComprobante =
  | "factura_a"
  | "factura_b"
  | "factura_c"
  | "nota_credito_a"
  | "nota_credito_b"
  | "nota_credito_c"
  | "nota_debito_a"
  | "nota_debito_b"
  | "nota_debito_c";

/**
 * Letra que corresponde según quién emite y quién recibe.
 *
 * - Un responsable inscripto emite **A** a otro responsable inscripto —el único
 *   que puede computarse el crédito fiscal— y **B** a todos los demás.
 * - Un monotributista emite siempre **C**, sin discriminar IVA: no lo cobra.
 * - Un exento emite **C**.
 */
export function letraQueCorresponde(
  emisor: CondicionIva,
  receptor: CondicionIva,
): Letra {
  if (emisor === "responsable_inscripto") {
    return receptor === "responsable_inscripto" ? "A" : "B";
  }
  return "C";
}

export function tipoFactura(letra: Letra): TipoComprobante {
  return `factura_${letra.toLowerCase()}` as TipoComprobante;
}

/** La nota de crédito lleva la misma letra que el comprobante que corrige. */
export function notaDeCredito(tipo: TipoComprobante): TipoComprobante {
  return tipo.replace(/^factura/, "nota_credito") as TipoComprobante;
}

export function notaDeDebito(tipo: TipoComprobante): TipoComprobante {
  return tipo.replace(/^factura/, "nota_debito") as TipoComprobante;
}

export function letraDe(tipo: TipoComprobante): Letra {
  return tipo.slice(-1).toUpperCase() as Letra;
}

export function esNotaDeCredito(tipo: TipoComprobante): boolean {
  return tipo.startsWith("nota_credito");
}

/**
 * En la factura A el IVA se discrimina; en la B y la C, no.
 *
 * Ojo con la lectura fácil: que no se discrimine **no** significa que no haya
 * IVA. En una factura B el IVA está adentro del precio y hay que informarlo a
 * ARCA igual; lo único que cambia es que no se imprime como renglón aparte.
 */
export function discriminaIva(tipo: TipoComprobante): boolean {
  return letraDe(tipo) === "A";
}

/* -------------------------------------------------------------------------- */
/* Códigos de ARCA                                                             */
/* -------------------------------------------------------------------------- */

/** Códigos de tipo de comprobante de WSFEv1 (`CbteTipo`). */
export const CODIGO_COMPROBANTE: Record<TipoComprobante, number> = {
  factura_a: 1,
  nota_debito_a: 2,
  nota_credito_a: 3,
  factura_b: 6,
  nota_debito_b: 7,
  nota_credito_b: 8,
  factura_c: 11,
  nota_debito_c: 12,
  nota_credito_c: 13,
};

/** Tipos de documento del receptor (`DocTipo`). */
export const DOC_CUIT = 80;
export const DOC_DNI = 96;
export const DOC_CONSUMIDOR_FINAL = 99;

/**
 * `CondicionIVAReceptorId`, obligatorio en toda factura desde abril de 2026.
 *
 * Es el riesgo R3 del plan: sin este campo ARCA rechaza el comprobante, y por
 * eso la condición frente al IVA se pide desde el registro y no recién al
 * momento de facturar.
 */
export const CONDICION_IVA_RECEPTOR: Record<CondicionIva, number> = {
  responsable_inscripto: 1,
  exento: 4,
  consumidor_final: 5,
  monotributista: 6,
  no_categorizado: 7,
};

/**
 * Documento con el que se identifica al receptor.
 *
 * Sin CUIT se factura a consumidor final con documento 99 y número 0, que es lo
 * que ARCA espera para una venta de mostrador. Por encima de cierto importe
 * exige identificar a la persona, pero ese control lo hace ARCA al recibir.
 */
export function documentoReceptor(cuit: string | null): {
  tipo: number;
  numero: number;
} {
  const limpio = (cuit ?? "").replace(/\D/g, "");

  if (limpio.length === 11) return { tipo: DOC_CUIT, numero: Number(limpio) };
  if (limpio.length === 7 || limpio.length === 8) {
    return { tipo: DOC_DNI, numero: Number(limpio) };
  }

  return { tipo: DOC_CONSUMIDOR_FINAL, numero: 0 };
}

/** Nombre para mostrar: "Factura A", "Nota de crédito B". */
export function nombreComprobante(tipo: TipoComprobante): string {
  const letra = letraDe(tipo);

  if (tipo.startsWith("nota_credito")) return `Nota de crédito ${letra}`;
  if (tipo.startsWith("nota_debito")) return `Nota de débito ${letra}`;
  return `Factura ${letra}`;
}

/** "0003-00000127", como se lee en el papel. */
export function numeroFormateado(puntoVenta: number, numero: number): string {
  return `${String(puntoVenta).padStart(4, "0")}-${String(numero).padStart(8, "0")}`;
}

/** Fecha en el formato AAAAMMDD que usa WSFEv1. */
export function fechaArca(fecha: Date): string {
  return [
    fecha.getFullYear(),
    String(fecha.getMonth() + 1).padStart(2, "0"),
    String(fecha.getDate()).padStart(2, "0"),
  ].join("");
}

/** Pasa una fecha AAAAMMDD de ARCA a Date. */
export function desdeFechaArca(texto: string): Date | null {
  if (!/^\d{8}$/.test(texto)) return null;
  return new Date(
    Number(texto.slice(0, 4)),
    Number(texto.slice(4, 6)) - 1,
    Number(texto.slice(6, 8)),
  );
}
