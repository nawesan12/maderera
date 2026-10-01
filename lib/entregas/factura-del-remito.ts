import { fechaSolaCorta } from "@/lib/formato";

/**
 * Cómo dice el remito con qué factura viaja la mercadería.
 *
 * La misma redacción en la hoja impresa y en el PDF. Tres casos, y ninguno
 * inventa nada: la factura con su CAE y vencimiento; la factura emitida sin
 * CAE —el proveedor interno, mientras falta el certificado de ARCA—, dicho
 * con todas las letras; o ninguna factura todavía.
 */
export function lineasDeLaFactura(
  factura: { etiqueta: string; cae: string | null; caeVencimiento: Date | null } | null,
): string[] {
  if (!factura) return ["Sin factura asociada"];
  if (!factura.cae) return [factura.etiqueta, "Sin CAE: sin valor fiscal"];
  return [
    factura.etiqueta,
    `CAE ${factura.cae}${
      factura.caeVencimiento ? ` · vto. ${fechaSolaCorta.format(factura.caeVencimiento)}` : ""
    }`,
  ];
}
