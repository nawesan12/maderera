/**
 * El documento de un cliente nuevo: CUIT o DNI, y lo que se deduce de él.
 *
 * En el mostrador el dato llega como se lo dicen —«20-12345678-9», «12.345.678»—
 * y hay que saber qué es antes de guardarlo: un CUIT mal tipeado termina en una
 * factura A que ARCA rechaza, y uno guardado con guiones no se encuentra la
 * próxima vez y el cliente se duplica.
 *
 * Es lógica pura: la usa el alta del mostrador y la prueban los tests.
 */

import { cuitValido, dniValido, soloDigitos } from "@/lib/cuit";

export type CondicionIva =
  | "responsable_inscripto"
  | "monotributista"
  | "exento"
  | "consumidor_final"
  | "no_categorizado";

export type Documento =
  | { tipo: "cuit"; digitos: string }
  | { tipo: "dni"; digitos: string }
  | { tipo: "ninguno" };

/**
 * Qué documento es lo que se tipeó, o el motivo por el que no es ninguno.
 *
 * Vacío es válido: un consumidor final que solo deja el nombre y el teléfono.
 */
export function leerDocumento(texto: string | null | undefined): Documento | { error: string } {
  const digitos = soloDigitos(texto ?? "");
  if (digitos.length === 0) return { tipo: "ninguno" };

  if (digitos.length === 11) {
    return cuitValido(digitos)
      ? { tipo: "cuit", digitos }
      : { error: "El CUIT no es válido: revisá los números, el último es el verificador." };
  }
  if (digitos.length === 7 || digitos.length === 8) {
    return dniValido(digitos) ? { tipo: "dni", digitos } : { error: "El DNI no es válido." };
  }
  return { error: "Un CUIT tiene 11 números y un DNI, 7 u 8." };
}

/**
 * La condición de IVA que se propone a partir del documento.
 *
 * Es una sugerencia, no una deducción: un CUIT 30 es siempre una sociedad, y
 * una sociedad es responsable inscripta casi siempre; un CUIT 20 o 27 puede ser
 * monotributista o inscripto, y eso no lo sabe nadie sin preguntar —por eso
 * para las personas se propone consumidor final y quien atiende lo cambia—.
 */
export function sugerirCondicionIva(documento: Documento): CondicionIva {
  if (documento.tipo !== "cuit") return "consumidor_final";
  const prefijo = documento.digitos.slice(0, 2);
  if (prefijo === "30" || prefijo === "33" || prefijo === "34") return "responsable_inscripto";
  return "consumidor_final";
}

/**
 * Qué parte de lo que se tipeó en el buscador sirve para el alta.
 *
 * Si se buscó «20123456789» y no apareció nadie, eso es un documento y va a
 * ese campo; si se buscó «García», es el nombre. Ahorra volver a tipearlo con
 * el cliente enfrente.
 */
export function precargaDelAlta(busqueda: string): { nombre: string; documento: string } {
  const limpio = busqueda.trim();
  const digitos = soloDigitos(limpio);
  const pareceDocumento = digitos.length >= 7 && digitos.length >= limpio.replace(/[\s.-]/g, "").length;
  return pareceDocumento ? { nombre: "", documento: limpio } : { nombre: limpio, documento: "" };
}
