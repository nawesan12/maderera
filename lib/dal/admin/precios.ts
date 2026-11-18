import "server-only";

import { cache } from "react";
import { api, datos } from "@/lib/api/servidor";
import { consultaDeCatalogo, type FiltrosDeCatalogo } from "./products";

/**
 * Lo que lee el panel de precios. Lo sirve la API de Go
 * (backend/internal/precios): la grilla con las dos listas, el historial y las
 * listas. Las formas son las de antes: precios como texto.
 */

export interface FilaPrecio {
  variantId: string;
  productId: string;
  sku: string;
  producto: string;
  medida: string;
  categoria: string;
  categoriaSlug: string;
  unidad: string;
  imagen: string | null;
  precioGeneral: string;
  precioProfesional: string;
  /** Cuánto más barata es la profesional, en %; null si falta alguna. */
  brecha: number | null;
  actualizado: Date | null;
  /** Hace más de DIAS_PARA_REVISAR que no se toca. */
  desactualizado: boolean;
}

export const DIAS_PARA_REVISAR = 60;

/** Las filas de cada página de la grilla: es una tabla, entran más que en tarjetas. */
export const PRECIOS_POR_PAGINA = 50;

const ESTADOS_DE_PRECIO = ["sin-precio", "para-revisar", "al-dia"] as const;
export type EstadoDePrecio = (typeof ESTADOS_DE_PRECIO)[number];

export function estadoDePrecio(v: string | undefined): EstadoDePrecio | undefined {
  return ESTADOS_DE_PRECIO.find((e) => e === v);
}

/** Una página de la grilla, con el total del filtro y los conteos de cada grupo. */
export async function listarPrecios(filtros: FiltrosDeCatalogo = {}) {
  const estado = estadoDePrecio(filtros.estado);
  const query = { ...consultaDeCatalogo(filtros, PRECIOS_POR_PAGINA), ...(estado ? { estado } : {}) };
  const r = datos(await (await api()).GET("/api/v1/admin/precios", { params: { query } }));
  return {
    ...r,
    filas: r.filas.map((f): FilaPrecio => ({ ...f, actualizado: f.actualizado ? new Date(f.actualizado) : null })),
  };
}

export async function historialDePrecios(limite = 40) {
  const filas = datos(await (await api()).GET("/api/v1/admin/precios/historial", { params: { query: { limite } } }));
  return filas.map((f) => ({ ...f, createdAt: new Date(f.createdAt) }));
}

/** Todas las listas, la general primero, con cuántos precios propios tiene cada una. */
export const listarListasDePrecios = cache(async () => {
  const filas = datos(await (await api()).GET("/api/v1/admin/precios/listas"));
  return filas.map((f) => ({ ...f, createdAt: new Date(f.createdAt) }));
});

export async function rubrosParaAjuste() {
  return datos(await (await api()).GET("/api/v1/admin/precios/rubros"));
}

/** Todos los escalones de descuento por medio de pago, también los apagados. */
export async function descuentosDePago() {
  const filas = datos(await (await api()).GET("/api/v1/admin/precios/descuentos"));
  return filas.map((f) => ({ ...f, createdAt: new Date(f.createdAt) }));
}

/** El último ajuste masivo, para ofrecer deshacerlo. Null si no hay. */
export async function ultimoAjuste() {
  const u = datos(await (await api()).GET("/api/v1/admin/precios/ajuste/ultimo"));
  return u ? { ...u, cuando: new Date(u.cuando) } : null;
}
