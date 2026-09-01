import "server-only";

import { hayMercadoPago } from "./config";
import { proveedorDemo } from "./proveedor-demo";
import { proveedorMercadoPago } from "./proveedor-mercadopago";
import type { NombreProveedorPago, ProveedorPagos } from "./tipos";

/**
 * Elige con qué se cobra.
 *
 * El checkout, la conciliación y el pago de deuda piden el proveedor acá y solo
 * conocen la interfaz de `tipos.ts`. Sin `MP_ACCESS_TOKEN` cargado —que es la
 * situación de hoy— corre el de demostración, y todas las pantallas lo avisan.
 */
export function proveedorPagos(): ProveedorPagos {
  if (process.env.PAGOS_PROVIDER === "demo") return proveedorDemo;
  return hayMercadoPago() ? proveedorMercadoPago : proveedorDemo;
}

export function proveedorPorNombre(
  nombre: NombreProveedorPago,
): ProveedorPagos | null {
  if (nombre === "demo") return proveedorDemo;
  if (nombre === "mercado_pago") {
    return hayMercadoPago() ? proveedorMercadoPago : null;
  }
  return null;
}

/** Si los cobros online salen de verdad o son una simulación. */
export function cobrosEnVivo(): boolean {
  return proveedorPagos().real;
}

export * from "./tipos";
