/**
 * Por dónde se puede cortar el reporte de ventas.
 *
 * Vive fuera de `lib/dal/admin/reportes.ts` porque ese módulo es `server-only`
 * —arrastra `next/headers` por el control de sesión— y los botones que eligen
 * el corte corren en el navegador. Es la misma separación que ya hay entre
 * `lib/dal/carrito.ts` y `lib/carrito-vacio.ts`.
 */
export type CorteDelReporte =
  | "producto"
  | "cliente"
  | "vendedor"
  | "sucursal"
  | "canal";

export const CORTES: { clave: CorteDelReporte; etiqueta: string }[] = [
  { clave: "producto", etiqueta: "Por producto" },
  { clave: "cliente", etiqueta: "Por cliente" },
  { clave: "vendedor", etiqueta: "Por vendedor" },
  { clave: "sucursal", etiqueta: "Por sucursal" },
  { clave: "canal", etiqueta: "Por canal" },
];

/** El corte pedido, o el de siempre si lo de la URL no existe. */
export function leerCorte(valor?: string): CorteDelReporte {
  return CORTES.some((c) => c.clave === valor)
    ? (valor as CorteDelReporte)
    : "producto";
}
