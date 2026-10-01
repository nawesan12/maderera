/**
 * El número de un cheque, como se busca en el banco.
 *
 * De la clienta (30/9/2026): «cuando se carga un cheque, cargar número de
 * cheque para que la gente sepa cuál cheque es en el banco». El número ya se
 * pedía en algunos formularios y en otros —el cobro de una factura— era un
 * texto libre que podía decir «cheque del martes».
 *
 * Se guarda solo con dígitos: «0012-3456», «12 3456» y «123456» son el mismo
 * cheque, y la comparación contra duplicados tiene que verlos iguales. Los
 * ceros de adelante se conservan: en el banco el número es de largo fijo.
 */

/** Deja solo los dígitos. */
export function normalizarNumeroDeCheque(texto: string): string {
  return texto.replace(/\D/g, "");
}

/**
 * Si el número tiene forma de número de cheque.
 *
 * Los cheques argentinos traen 8 dígitos y los e-Cheq hasta 11 o 12; se
 * aceptan de 4 a 20 para no rechazar un formato de otro banco, pero no un
 * «1» que es claramente un error de tipeo.
 */
export function revisarNumeroDeCheque(texto: string): string | null {
  const numero = normalizarNumeroDeCheque(texto);
  if (numero.length === 0) return "Poné el número del cheque: es como se lo encuentra en el banco.";
  if (numero.length < 4) return "El número del cheque es muy corto. Revisalo contra el papel.";
  if (numero.length > 20) return "El número del cheque es muy largo. Revisalo contra el papel.";
  return null;
}

/** «Banco Nación N° 12345678», para el recibo, la cartera y Mi cuenta. */
export function nombreDelCheque(cheque: {
  tipo?: "fisico" | "echeq" | null;
  banco: string | null;
  numero: string;
}): string {
  const clase = cheque.tipo === "echeq" ? "e-Cheq" : "Cheque";
  return `${clase}${cheque.banco ? ` ${cheque.banco}` : ""} N° ${cheque.numero}`;
}
