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
  /** Físico: lo que el sistema cuenta en la sucursal. */
  qty: number;
  reservado: number;
  /** Físico − reservado, con signo: negativo es lo vendido de más. */
  disponible: number;
  /** Lo que va en el camión: remitos de envío sin firmar y pedidos en camino sin remito. */
  enReparto: number;
  /** Lo que hay en el estante. */
  galpon: number;
  /** Lo que viene en un traslado sin recibir. */
  llegando: number;
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
  /** La suma de lo disponible de las sucursales que tienen: un negativo no resta. */
  total: number;
  /** Lo vendido de más, sumado de las sucursales en negativo. */
  faltante: number;
  /** El mismo criterio que la pestaña «Para reponer» y el inicio. */
  paraReponer: boolean;
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
export async function listarStock(
  filtros: FiltrosDeCatalogo & { sucursal?: string } = {},
  porPagina = STOCK_POR_PAGINA,
) {
  const estado = estadoDeStock(filtros.estado);
  // Los grupos de una sola sucursal (M2S1-028): el slug, o todas.
  const sucursal = filtros.sucursal && filtros.sucursal !== "todas" ? filtros.sucursal.slice(0, 80) : undefined;
  const query = { ...consultaDeCatalogo(filtros, porPagina), ...(estado ? { estado } : {}), ...(sucursal ? { sucursal } : {}) };
  const r = datos(await (await api()).GET("/api/v1/admin/stock", { params: { query } }));
  return { ...r, filas: r.filas as FilaStock[] };
}

/** Las medidas cuyo disponible llegó al mínimo, las más justas primero. */
export async function alertasDeStock(limite = 8) {
  return datos(await (await api()).GET("/api/v1/admin/stock/alertas", { params: { query: { limite } } }));
}

/**
 * Los últimos movimientos de las medidas que pasan el mismo filtro que la
 * grilla: buscando un tirante, los de ese tirante.
 */
export async function ultimosMovimientos(limite = 10, filtros: FiltrosDeCatalogo = {}) {
  const { busqueda, categoria, marca, proveedor } = consultaDeCatalogo(filtros, limite) as FiltrosDeCatalogo;
  const filas = datos(
    await (await api()).GET("/api/v1/admin/stock/movimientos", {
      params: { query: { busqueda, categoria, marca, proveedor, limite } },
    }),
  );
  return filas.map((f) => ({ ...f, createdAt: new Date(f.createdAt) }));
}

/** Los traslados entre sucursales que nadie recibió todavía. */
export async function trasladosEnCamino() {
  const filas = datos(await (await api()).GET("/api/v1/admin/stock/traslados"));
  return filas.map((t) => ({ ...t, createdAt: new Date(t.createdAt) }));
}

/** El comprobante de un traslado, o null si no existe. */
export async function verTraslado(id: string) {
  const r = await (await api()).GET("/api/v1/admin/stock/traslados/{id}", { params: { path: { id } } });
  if (r.response.status === 404) return null;
  const t = datos(r);
  return {
    ...t,
    createdAt: new Date(t.createdAt),
    recibidoAt: t.recibidoAt ? new Date(t.recibidoAt) : null,
    anuladoAt: t.anuladoAt ? new Date(t.anuladoAt) : null,
  };
}

export async function listarSucursales() {
  const filas = datos(await (await api()).GET("/api/v1/admin/sucursales"));
  return filas.map((f) => ({ ...f, createdAt: new Date(f.createdAt) }));
}
