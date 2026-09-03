/**
 * Cómo se llaman los comprobantes que recibimos.
 *
 * Vive aparte del catálogo de ventas porque los tipos no son los mismos: acá
 * llega la M —la que ARCA le asigna a un proveedor observado— y el ticket de la
 * ferretería, y no llega ninguno de los que la maderera emite.
 *
 * Sin `server-only`: lo usan la pantalla, la exportación y el PDF.
 */
export const COMPROBANTES_DE_COMPRA = {
  factura_a: "Factura A",
  factura_b: "Factura B",
  factura_c: "Factura C",
  factura_m: "Factura M",
  nota_credito_a: "Nota de crédito A",
  nota_credito_b: "Nota de crédito B",
  nota_credito_c: "Nota de crédito C",
  nota_debito_a: "Nota de débito A",
  nota_debito_b: "Nota de débito B",
  nota_debito_c: "Nota de débito C",
  ticket: "Ticket",
  otro: "Otro comprobante",
} as const;

export type TipoComprobanteCompra = keyof typeof COMPROBANTES_DE_COMPRA;

export function nombreComprobanteCompra(tipo: string): string {
  return (
    COMPROBANTES_DE_COMPRA[tipo as TipoComprobanteCompra] ?? "Comprobante"
  );
}

/**
 * El número como lo escribe el proveedor: `0003-00001274`.
 *
 * Con ceros a la izquierda a propósito: es lo que está impreso en el papel, y
 * quien busca una factura la busca tal como la ve.
 */
export function numeroDeCompra(puntoVenta: number, numero: number): string {
  return `${String(puntoVenta).padStart(4, "0")}-${String(numero).padStart(8, "0")}`;
}

/**
 * Si el comprobante da crédito fiscal computable.
 *
 * La B y la C no discriminan IVA: el impuesto está adentro del precio y **no se
 * puede computar**. Tratarlas como si dieran crédito es de los errores que más
 * caro salen, porque infla el crédito del mes contra un papel que no lo
 * respalda.
 */
export function daCreditoFiscal(tipo: string): boolean {
  return tipo === "factura_a" || tipo === "factura_m" ||
    tipo === "nota_credito_a" || tipo === "nota_debito_a";
}
