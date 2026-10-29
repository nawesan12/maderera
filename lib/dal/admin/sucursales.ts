import "server-only";

import { api, datos } from "@/lib/api/servidor";
import { sucursalPublicada } from "@/lib/sucursales";

/*
 * Los números de cada sucursal los da la API de Go (backend/internal/stock/
 * sucursales.go); la dirección, el teléfono y el horario son datos fijos del
 * sitio (lib/sucursales.ts) y se suman acá.
 */

export interface SucursalConMetricas {
  id: string;
  slug: string;
  nombre: string;
  direccion: string;
  telefono: string | null;
  horario: string | null;
  sortOrder: number;
  active: boolean;
  /** Importe vendido hoy: pedidos no cancelados con fecha de hoy. */
  ventasHoy: number;
  pedidosHoy: number;
  /** Pedidos abiertos, sin importar la fecha: es la cola de trabajo real. */
  pedidosAbiertos: number;
  cortesEnCola: number;
  /** Personas distintas atendidas hoy, no pedidos: dos pedidos de la misma persona son una. */
  clientesAtendidos: number;
  /** Stock valorizado a la lista general. Es una estimación, no un balance. */
  stockValor: number;
  productosStockBajo: number;
}

/**
 * Las sucursales con sus números, calculados de la base.
 *
 * La pantalla era la última maqueta del panel: leía `lib/dashboard-data.ts`,
 * con las direcciones y las métricas escritas a mano. El problema no era que
 * los números fueran inventados —eso se nota— sino que la dirección y el
 * teléfono estaban ahí duplicados: cuando el aserradero cambió de teléfono,
 * el panel siguió mostrando el viejo sin que nadie lo notara.
 *
 * Las seis consultas van en paralelo y se cruzan por `branchId` en memoria: son
 * dos sucursales, y hacer un `join` de todo contra `branches` obligaría a un
 * `group by` por cada métrica igual.
 */
export async function sucursalesConMetricas(): Promise<SucursalConMetricas[]> {
  const filas = datos(await (await api()).GET("/api/v1/admin/sucursales/metricas"));
  return filas.map((f) => ({
    ...f,
    direccion: sucursalPublicada(f.slug)?.direccion ?? "",
    telefono: sucursalPublicada(f.slug)?.telefono ?? null,
    horario: sucursalPublicada(f.slug)?.horario ?? null,
  }));
}

/** Pedidos abiertos y cortes en cola que no tienen sucursal asignada. */
export async function sinSucursalAsignada() {
  return datos(await (await api()).GET("/api/v1/admin/sucursales/sin-asignar"));
}
