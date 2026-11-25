/**
 * Si se le puede anotar a cuenta corriente sin conexión (revisión del carril F).
 *
 * Sin servidor no se sabe el saldo, pero sí lo que trae el padrón local: la
 * cuenta bloqueada y el límite. La cola rechaza la bloqueada al subirse
 * (mostrador/venta.go), cuando la mercadería ya salió; y a quien no tiene
 * cuenta habilitada se le cargaba deuda sin que nadie lo autorizara. Las dos
 * se frenan acá, antes de entregar. Lo que el padrón no trae (una copia
 * vieja) no frena: Go igual lo marca.
 *
 * Devuelve el motivo, o `null` si se puede.
 */
export function cuentaSinConexion(
  cliente: { nombre: string; cuentaBloqueada?: boolean; limiteCredito?: number } | null,
): string | null {
  if (!cliente) return null;
  if (cliente.cuentaBloqueada) return `La cuenta corriente de ${cliente.nombre} está bloqueada.`;
  if (cliente.limiteCredito !== undefined && !(cliente.limiteCredito > 0)) {
    return `${cliente.nombre} no tiene cuenta corriente.`;
  }
  return null;
}
