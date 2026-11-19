import { parsearImporte } from "@/lib/formato";

/**
 * Lo que hace falta para editar un precio en la tabla, sin React.
 *
 * Go manda el precio como texto `numeric` con punto: «84500.00». El campo
 * arrancaba con ese texto y lo leía quitando todos los puntos, así que abrir
 * un precio y salir sin tocarlo lo guardaba en $8.450.000. En el teléfono
 * alcanzaba con tocar Lista y después Profesional.
 */

/** El texto con que arranca el campo: «84500» o «84500,5», como se tipea acá. */
export function textoParaEditar(valor: string): string {
  const n = Number(valor);
  return Number.isFinite(n) ? String(n).replace(".", ",") : valor;
}

/**
 * Qué hacer con lo tipeado: `null` si no cambió (no se guarda nada), `NaN` si
 * no se puede leer, o el precio nuevo. Se lee con `parsearImporte`, la misma
 * regla de los cobros: «84.500» son miles y «84500.00» trae decimales.
 */
export function precioTipeado(texto: string, valor: string): number | null {
  if (texto === textoParaEditar(valor) || texto === valor) return null;
  const n = parsearImporte(texto);
  if (n === Number(valor)) return null;
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}
