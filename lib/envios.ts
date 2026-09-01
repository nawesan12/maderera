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
}

export function calcularEnvio(zona: ZonaEnvio, subtotal: number): number {
  // Cero desactiva la promoción: sin esto, un `envioGratisDesde` sin configurar
  // regalaría el envío en todas las compras.
  if (zona.envioGratisDesde > 0 && subtotal >= zona.envioGratisDesde) return 0;
  return zona.costo;
}
