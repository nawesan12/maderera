/**
 * Si el remito todavía se puede firmar desde el link.
 *
 * El token queda en la fila aunque el remito se anule o ya se haya firmado,
 * y la ficha ofrecía «Firmar» sobre un remito anulado (comité final, M17).
 * Go ya rechaza esa firma; esto evita mandar al cliente a un link muerto.
 */
export function seOfreceLaFirma(remito: {
  estado: string;
  firmaToken?: string | null;
  firmadoAt?: Date | string | null;
}): boolean {
  return Boolean(remito.firmaToken) && remito.estado !== "anulada" && !remito.firmadoAt;
}
