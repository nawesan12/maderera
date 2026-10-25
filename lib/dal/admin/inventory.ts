import "server-only";

import { api, datos } from "@/lib/api/servidor";
import type { StockLevel } from "@/lib/stock-level";

/**
 * El stock del panel. Lo sirve la API de Go (backend/internal/stock): la
 * grilla por sucursal (con lo reservado), las alertas y los movimientos.
 */

export interface FilaStock {
  variantId: string;
  productId: string;
  productSlug: string;
  productName: string;
  label: string;
  sku: string;
  categoryName: string;
  unidad: string;
  largoMm: number | null;
  imagen: string | null;
  qtyCentral: number;
  qtyAserradero: number;
  reservadoCentral: number;
  reservadoAserradero: number;
  minCentral: number;
  minAserradero: number;
  nivelCentral: StockLevel;
  nivelAserradero: StockLevel;
  total: number;
}

export async function listarStock(filtros: { busqueda?: string; categoria?: string } = {}): Promise<FilaStock[]> {
  const query = {
    ...(filtros.busqueda ? { busqueda: filtros.busqueda.slice(0, 200) } : {}),
    ...(filtros.categoria ? { categoria: filtros.categoria } : {}),
  };
  return datos(await (await api()).GET("/api/v1/admin/stock", { params: { query } }));
}

/** Las medidas cuyo disponible llegó al mínimo, las más justas primero. */
export async function alertasDeStock(limite = 8) {
  return datos(await (await api()).GET("/api/v1/admin/stock/alertas", { params: { query: { limite } } }));
}

export async function ultimosMovimientos(limite = 10) {
  const filas = datos(await (await api()).GET("/api/v1/admin/stock/movimientos", { params: { query: { limite } } }));
  return filas.map((f) => ({ ...f, createdAt: new Date(f.createdAt) }));
}

export async function listarSucursales() {
  const filas = datos(await (await api()).GET("/api/v1/admin/sucursales"));
  return filas.map((f) => ({ ...f, createdAt: new Date(f.createdAt) }));
}
