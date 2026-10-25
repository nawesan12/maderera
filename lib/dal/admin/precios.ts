import "server-only";

import { cache } from "react";
import { api, datos } from "@/lib/api/servidor";

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

export async function listarPrecios(filtros: { busqueda?: string; categoria?: string } = {}): Promise<FilaPrecio[]> {
  const query = {
    ...(filtros.busqueda ? { busqueda: filtros.busqueda.slice(0, 200) } : {}),
    ...(filtros.categoria ? { categoria: filtros.categoria } : {}),
  };
  const filas = datos(await (await api()).GET("/api/v1/admin/precios", { params: { query } }));
  return filas.map((f) => ({ ...f, actualizado: f.actualizado ? new Date(f.actualizado) : null }));
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
