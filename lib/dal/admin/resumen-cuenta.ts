import "server-only";

import { apiInterna, datos } from "@/lib/api/servidor";
import type { Esquemas } from "@/lib/api/tipos";

/**
 * El resumen de cuenta corriente para imprimir: todos los movimientos con el
 * saldo corrido y el aging. Lo arma la API de Go; se pide con el secreto
 * interno porque **quien llama ya decidió que se puede ver** (la página de
 * impresión es del panel, la ruta del PDF mira de quién es la cuenta, y
 * WhatsApp se lo manda a su dueño).
 */

type Crudo = Esquemas["ResumenDeCuenta"];

export interface MovimientoDelResumen extends Omit<Crudo["movimientos"][number], "fecha"> {
  fecha: Date;
}

export interface ResumenDeCuenta extends Omit<Crudo, "movimientos"> {
  movimientos: MovimientoDelResumen[];
}

export async function resumenDeCuenta(customerId: string): Promise<ResumenDeCuenta | null> {
  const r = await apiInterna.GET("/api/v1/admin/clientes/{id}/resumen", { params: { path: { id: customerId } } });
  if (r.response.status === 404 || r.response.status === 400) return null;
  const d = datos(r);
  return { ...d, movimientos: d.movimientos.map((m) => ({ ...m, fecha: new Date(m.fecha) })) };
}
