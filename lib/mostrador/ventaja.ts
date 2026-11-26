/**
 * Si la lista del cliente le da a algún renglón un precio mejor que la
 * general. Con ventaja, su lista es de contado (la regla que Go vuelve a
 * mirar al cobrar, mostrador/venta.go). Un renglón sin precio general cuenta
 * como ventaja: solo existe en su lista.
 */
export function hayVentaja(
  ids: string[],
  suyos: Record<string, number>,
  generales: Record<string, number>,
): boolean {
  return ids.some((id) => suyos[id] > 0 && (!(generales[id] > 0) || suyos[id] < generales[id] - 0.005));
}
