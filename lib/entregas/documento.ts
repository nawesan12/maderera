/**
 * El documento de quien retira, revisado antes de mandar el remito.
 *
 * Espejo de entregas.RevisarDocumento (backend/internal/entregas/logica.go):
 * Go lo vuelve a revisar. Acá sirve para frenar antes de preguntar «sin
 * cobrar», y no avisar del documento recién después (mes simulado 2).
 */
export const FALTA_DOCUMENTO = "Falta el documento de quien retira.";
export const DOCUMENTO_INVALIDO = "Revisá el documento: un DNI tiene 7 u 8 números y un CUIT, 11.";

/** El problema del documento, o null si sirve. Vacío es «falta». */
export function revisarDocumentoDeRetiro(documento: string): string | null {
  const limpio = documento.trim().replace(/[.\- ]/g, "");
  if (limpio === "") return FALTA_DOCUMENTO;
  if (documento.trim().length > 30) return "El documento es muy largo.";
  if (!/^[0-9A-Za-z]+$/.test(limpio)) return DOCUMENTO_INVALIDO;
  const digitos = limpio.replace(/[^0-9]/g, "").length;
  const otros = limpio.length - digitos;
  if (otros === 0 && (digitos < 7 || digitos > 11)) return DOCUMENTO_INVALIDO;
  if (otros > 0 && (limpio.length < 6 || limpio.length > 15)) return DOCUMENTO_INVALIDO;
  return null;
}
