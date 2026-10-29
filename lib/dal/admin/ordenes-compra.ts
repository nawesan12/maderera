import "server-only";

import { api, datos } from "@/lib/api/servidor";

/**
 * Las órdenes de compra: **qué está por llegar**. Las sirve la API de Go
 * (backend/internal/compras).
 */
export async function listarOrdenesDeCompra(limite = 60) {
  const filas = datos(await (await api()).GET("/api/v1/admin/compras/ordenes", { params: { query: { limite } } }));
  return filas.map((f) => ({
    ...f,
    fechaPrometida: f.fechaPrometida ? new Date(f.fechaPrometida) : null,
    createdAt: new Date(f.createdAt),
  }));
}

export async function obtenerOrdenDeCompra(id: string) {
  const r = await (await api()).GET("/api/v1/admin/compras/ordenes/{id}", { params: { path: { id } } });
  if (r.response.status === 404) return null;
  const o = datos(r);
  return {
    ...o,
    fechaPrometida: o.fechaPrometida ? new Date(o.fechaPrometida) : null,
    createdAt: new Date(o.createdAt),
    enviadaAt: o.enviadaAt ? new Date(o.enviadaAt) : null,
  };
}

/**
 * Lo que todavía falta recibir, por variante, de las órdenes vivas (enviadas
 * o parciales).
 */
export async function loQueEstaPorLlegar(branchId?: string) {
  const filas = datos(
    await (await api()).GET("/api/v1/admin/compras/por-llegar", { params: { query: branchId ? { sucursal: branchId } : {} } }),
  );
  return filas.map((f) => ({ ...f, proximaEntrega: f.proximaEntrega ? new Date(f.proximaEntrega) : null }));
}
