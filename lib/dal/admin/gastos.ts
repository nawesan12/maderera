import "server-only";

import { api, datos } from "@/lib/api/servidor";

/**
 * Los gastos del negocio. Los sirve (y los anota) la API de Go
 * (backend/internal/compras): un gasto en efectivo también sale de la caja
 * del turno que lo contiene.
 */

function rango(desde: Date, hasta: Date) {
  return { desde: desde.toISOString(), hasta: hasta.toISOString() };
}

/** Los gastos de un período, los más nuevos primero. */
export async function listarGastos({ desde, hasta, limite = 200 }: { desde: Date; hasta: Date; limite?: number }) {
  const filas = datos(
    await (await api()).GET("/api/v1/admin/compras/gastos", { params: { query: { ...rango(desde, hasta), limite } } }),
  );
  return filas.map((f) => ({ ...f, fecha: new Date(f.fecha) }));
}

/** Cuánto se gastó por categoría en un período (lo más gastado primero). */
export async function gastosPorCategoria(desde: Date, hasta: Date) {
  const filas = datos(
    await (await api()).GET("/api/v1/admin/compras/gastos/por-categoria", { params: { query: rango(desde, hasta) } }),
  );
  return filas.map(({ clave, ...f }) => ({ categoria: clave, ...f }));
}

/** Cuánto salió por cada circuito en el período. */
export async function gastosPorCircuito(desde: Date, hasta: Date) {
  const filas = datos(
    await (await api()).GET("/api/v1/admin/compras/gastos/por-circuito", { params: { query: rango(desde, hasta) } }),
  );
  return filas.map(({ clave, ...f }) => ({ circuito: clave as "blanco" | "negro", ...f }));
}

/** Las sucursales donde se puede imputar un gasto en efectivo. */
export async function sucursalesParaGasto() {
  return datos(await (await api()).GET("/api/v1/admin/compras/gastos/sucursales"));
}
