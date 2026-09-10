/**
 * La aritmética del reporte de reposición.
 *
 * La clienta pidió un reporte "accionable para tomar buenas acciones de
 * compra": stock actual por sucursal y rubro, cruzado con lo que se vendió,
 * cuánto convendría reponer y cuándo. La cuenta vive acá, sin base, para
 * poder probarla: de estos números salen órdenes de compra.
 */

export interface DatosDeReposicion {
  /** Disponible hoy: físico menos reservado, sumado entre sucursales. */
  disponible: number;
  /** Unidades vendidas en el período. */
  vendido: number;
  /** Días del período medido. */
  diasDelPeriodo: number;
}

/**
 * La venta por día del período. Es el ritmo, no una promesa: un producto
 * estacional medido en su mes fuerte va a sugerir de más, y por eso el
 * período se elige en pantalla.
 */
export function ventaDiaria(vendido: number, diasDelPeriodo: number): number {
  if (diasDelPeriodo <= 0 || vendido <= 0) return 0;
  return vendido / diasDelPeriodo;
}

/**
 * Cuántos días de venta cubre el stock de hoy. `null` cuando no hay ventas en
 * el período: sin ritmo no hay cobertura que calcular, y un "infinito"
 * disfrazado de número grande ordenaría mal cualquier tabla.
 */
export function diasDeCobertura(datos: DatosDeReposicion): number | null {
  const ritmo = ventaDiaria(datos.vendido, datos.diasDelPeriodo);
  if (ritmo <= 0) return null;
  return Math.round(Math.max(datos.disponible, 0) / ritmo);
}

/**
 * Cuánto convendría comprar para llegar a la cobertura objetivo.
 *
 * `objetivo − disponible`, con el objetivo en unidades (venta diaria × días
 * deseados), redondeado hacia arriba: media placa no se compra. Cero cuando
 * el stock ya alcanza o no hay ritmo de venta.
 */
export function sugerenciaDeCompra(
  datos: DatosDeReposicion,
  coberturaObjetivoDias: number,
): number {
  const ritmo = ventaDiaria(datos.vendido, datos.diasDelPeriodo);
  if (ritmo <= 0 || coberturaObjetivoDias <= 0) return 0;

  const objetivo = ritmo * coberturaObjetivoDias;
  const faltante = objetivo - Math.max(datos.disponible, 0);

  return faltante > 0 ? Math.ceil(faltante) : 0;
}
