import "server-only";

import { api, datos } from "@/lib/api/servidor";
import type { Esquemas } from "@/lib/api/tipos";

/**
 * El cierre del mes: los asientos para que el estudio los importe, lo que
 * conviene resolver antes de cerrar y los números del mes. Lo arma la API de
 * Go (backend/internal/reportes/cierre.go, con los asientos de
 * asientos.go).
 *
 * Lo que este módulo **no** hace, y conviene decirlo de frente: libro diario,
 * mayor, balance y plan de cuentas. Eso es contabilidad registrada y la lleva
 * el estudio con su sistema.
 *
 * El período es el de la URL (`2026-03`). El mes corta en UTC, como siempre:
 * ver internal/reportes/cierre.go.
 */

export type Asiento = Omit<Esquemas["CierreAsiento"], "fecha"> & { fecha: Date };
export type PendienteDelCierre = Esquemas["CierrePendiente"];

/** Los asientos del período, en orden de fecha, cada uno con si balancea. */
export async function asientosDelPeriodo(periodo: string): Promise<Asiento[]> {
  const filas = datos(await (await api()).GET("/api/v1/admin/cierre/asientos", { params: { query: { periodo } } }));
  return filas.map((a) => ({ ...a, fecha: new Date(a.fecha) }));
}

/** Lo que conviene resolver antes de cerrar. No bloquea nada. */
export async function pendientesDelCierre(periodo: string): Promise<PendienteDelCierre[]> {
  return datos(await (await api()).GET("/api/v1/admin/cierre/pendientes", { params: { query: { periodo } } }));
}

/** Los números del mes, todos juntos. */
export async function resumenDelMes(periodo: string) {
  return datos(await (await api()).GET("/api/v1/admin/cierre/resumen", { params: { query: { periodo } } }));
}

/** Cuántos asientos no cierran. Debería ser siempre cero. */
export function asientosDesbalanceados(asientos: Asiento[]): Asiento[] {
  return asientos.filter((a) => !a.balancea);
}
