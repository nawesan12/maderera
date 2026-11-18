import "server-only";

import { api, datos } from "@/lib/api/servidor";
import { consultaDeCatalogo, type FiltrosDeCatalogo } from "./products";
import type { StockLevel } from "@/lib/stock-level";

/**
 * El stock del panel. Lo sirve la API de Go (backend/internal/stock): la
 * grilla por sucursal (con lo reservado), las alertas y los movimientos.
 */

/** El stock de una medida en una sucursal activa (la fila de `branches`). */
export interface StockEnSucursal {
  id: string;
  slug: string;
  nombre: string;
  qty: number;
  reservado: number;
  min: number;
  nivel: StockLevel;
}

export interface FilaStock {
  variantId: string;
  productId: string;
  productSlug: string;
  productName: string;
  label: string;
  sku: string;
  codigoBarras: string | null;
  categoryName: string;
  unidad: string;
  largoMm: number | null;
  imagen: string | null;
  /** Una por sucursal activa, en el orden de la base. */
  sucursales: StockEnSucursal[];
  total: number;
}

/** Dos columnas de tarjetas. */
export const STOCK_POR_PAGINA = 30;

const ESTADOS_DE_STOCK = ["sin-stock", "reponer", "con-stock"] as const;
export type EstadoDeStock = (typeof ESTADOS_DE_STOCK)[number];

export function estadoDeStock(v: string | undefined): EstadoDeStock | undefined {
  return ESTADOS_DE_STOCK.find((e) => e === v);
}

/**
 * Una página de la grilla, con el total del filtro, los conteos de cada grupo
 * y las sucursales activas (las columnas). `porPagina` lo cambia quien busca
 * una medida para elegirla (la transferencia, las etiquetas).
 */
export async function listarStock(filtros: FiltrosDeCatalogo = {}, porPagina = STOCK_POR_PAGINA) {
  const estado = estadoDeStock(filtros.estado);
  const query = { ...consultaDeCatalogo(filtros, porPagina), ...(estado ? { estado } : {}) };
  const r = datos(await (await api()).GET("/api/v1/admin/stock", { params: { query } }));
  return { ...r, filas: r.filas as FilaStock[] };
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
