/**
 * La sucursal que proponen los formularios de compras (orden, recepción,
 * gasto, pago en efectivo).
 *
 * Antes proponían la primera de la lista, y una recepción del aserradero
 * quedaba cargada en Casa Central si nadie miraba ese campo. El usuario del
 * panel no tiene sucursal asignada: lo más parecido es la caja que abrió hoy
 * (`deLaSesion`, lo dice Go). Si hay una sola sucursal, esa. Si no, ninguna:
 * se elige.
 */
export function sucursalPropuesta(
  sucursales: readonly { id: string; deLaSesion?: boolean }[],
): string {
  return (
    sucursales.find((s) => s.deLaSesion)?.id ??
    (sucursales.length === 1 ? sucursales[0].id : "")
  );
}
