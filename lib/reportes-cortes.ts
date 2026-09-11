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
  | "rubro"
  | "elaboracion"
  | "cliente"
  | "vendedor"
  | "sucursal"
  | "canal";

export const CORTES: { clave: CorteDelReporte; etiqueta: string }[] = [
  { clave: "producto", etiqueta: "Por producto" },
  /*
   * Es el que la clienta lleva hoy en Excel: cuánta utilidad deja cada rubro.
   * Va segundo, pegado al de producto, porque son el mismo dato a dos alturas
   * y es el que se mira todos los meses.
   */
  { clave: "rubro", etiqueta: "Por rubro" },
  /*
   * La otra mitad de la frase de la clienta: "de cada rubro cuánta utilidad
   * hay, **qué porcentaje dejan las materias que se maquinan**". El corte por
   * rubro contestaba la primera parte; esta contesta la segunda, que es la que
   * decide si conviene seguir maquinando en planta o vender la madera en
   * bruto.
   */
  { clave: "elaboracion", etiqueta: "Elaborado vs. bruto" },
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
