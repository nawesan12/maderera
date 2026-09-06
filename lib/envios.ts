/**
 * Cálculo del costo de envío.
 *
 * Va fuera del DAL —y por lo tanto sin `server-only`— porque es aritmética
 * pura: no consulta nada. Tenerlo separado permite probarlo, y sobre todo
 * garantiza que el precio que se muestra en el checkout y el que se cobra al
 * confirmar salgan de la misma función. Cuando el cálculo vive en la pantalla,
 * tarde o temprano las dos cuentas se separan.
 */

export interface ZonaEnvio {
  id: string;
  nombre: string;
  costo: number;
  envioGratisDesde: number;
  demoraEstimada: string | null;
  /**
   * El flete de esta zona se cotiza caso por caso.
   *
   * El cliente contestó "depende" al costo y al plazo de las tres zonas que
   * atiende: según el volumen sale en camión propio o por comisionista. Sin
   * esta marca, la única forma de expresarlo era dejar el costo en cero, y la
   * pantalla lo muestra como "Sin cargo" — que es lo contrario de lo que pasa.
   */
  aCotizar: boolean;
}

/**
 * Lo que se cobra de envío al confirmar el pedido.
 *
 * Una zona a cotizar suma **cero**, y es a propósito: el pedido entra con el
 * flete pendiente y el importe se agrega cuando el negocio lo cotiza. Cobrar
 * un número inventado sería peor, y no cobrar nada y avisarlo es lo que el
 * mostrador ya hace por teléfono.
 */
export function calcularEnvio(zona: ZonaEnvio, subtotal: number): number {
  if (zona.aCotizar) return 0;
  // Cero desactiva la promoción: sin esto, un `envioGratisDesde` sin configurar
  // regalaría el envío en todas las compras.
  if (zona.envioGratisDesde > 0 && subtotal >= zona.envioGratisDesde) return 0;
  return zona.costo;
}
