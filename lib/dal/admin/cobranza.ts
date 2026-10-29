import "server-only";

import type { ClienteListado } from "@/lib/dal/admin/clientes";
import type { Prioridad } from "@/lib/cuenta-corriente/prioridad";

/**
 * La cartera a cobrar, ordenada por a quién llamar primero.
 *
 * La deuda vencida y la prioridad ya vienen en el listado de clientes (la API
 * de Go imputa los pagos contra las deudas más viejas con el mismo aging que
 * el resto): esto solo las junta por cliente, como las usa la pantalla.
 */

export interface DeudaDeCliente {
  customerId: string;
  vencido: number;
  diasDeLaMasVieja: number | null;
  prioridad: Prioridad;
}

export function deudaPorCliente(clientes: Pick<ClienteListado, "id" | "deuda">[]): Map<string, DeudaDeCliente> {
  const porCliente = new Map<string, DeudaDeCliente>();
  for (const c of clientes) {
    if (c.deuda) porCliente.set(c.id, { customerId: c.id, ...c.deuda, prioridad: c.deuda.prioridad as Prioridad });
  }
  return porCliente;
}
