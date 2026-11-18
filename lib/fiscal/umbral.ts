/**
 * El monto desde el que una factura B tiene que identificar al comprador.
 *
 * La regla es de Go (backend/internal/fiscal/umbral.go, que es el que frena
 * la emisión antes de quemar el número). Esto es para el mostrador: que el
 * DNI se pida en pantalla apenas el total llega al monto, antes de cobrar, y
 * no que el comprobante falle con el cliente ya pagando. El número es el
 * mismo que el de Go: tests/umbral-b.test.ts los compara.
 */
export const MONTO_IDENTIFICAR_CONSUMIDOR_FINAL = 10_000_000;

/** Si el documento identifica al comprador ante ARCA (CUIT o DNI). */
function identifica(documento: string | null | undefined): boolean {
  const d = (documento ?? "").replace(/\D/g, "");
  return d.length === 11 || d.length === 7 || d.length === 8;
}

/**
 * Si a esta venta le falta el documento del comprador: una B (o la letra
 * todavía sin calcular) que llega al monto sin ningún documento que lo
 * identifique. La A ya exige CUIT por su lado.
 */
export function faltaIdentificarComprador(
  letra: string | null,
  total: number,
  documentos: (string | null | undefined)[],
): boolean {
  if (letra === "A") return false;
  if (!(total >= MONTO_IDENTIFICAR_CONSUMIDOR_FINAL)) return false;
  return !documentos.some(identifica);
}
