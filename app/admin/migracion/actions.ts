"use server";

import { revalidatePath, updateTag } from "next/cache";
import { ETIQUETAS } from "@/lib/cache-publico";
import { api, comoFormulario, mensajeDe, soloCampos, type Problema } from "@/lib/api/servidor";
import type { ClaveEntidad, Control, Mapeo, RechazoMigracion } from "@/lib/migracion/tipos";

/*
 * La migración del sistema anterior. Leer el archivo, proponer el mapeo,
 * validar y escribir por lotes lo hace la API de Go
 * (backend/internal/migracion); acá quedan las firmas que usa la pantalla y
 * lo que Next revalida al cerrar. Todo es del admin: la migración reescribe
 * la cartera, el catálogo y los saldos de una sola vez.
 */

export interface ArchivoAnalizado {
  error?: string;
  archivo?: string;
  columnas?: string[];
  filas?: string[][];
  codificacion?: string;
  mapeo?: Mapeo;
}

/** Lee el archivo subido y propone el mapeo de columnas. No escribe nada. */
export async function analizarArchivo(entidad: ClaveEntidad, formData: FormData): Promise<ArchivoAnalizado> {
  const cuerpo = soloCampos(formData);
  cuerpo.set("entidad", entidad);
  const r = await (await api()).POST("/api/v1/admin/migracion/analizar", { body: cuerpo as never, ...comoFormulario });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined) };
  return r.data;
}

export interface FilaPrevia {
  linea: number;
  identificador: string;
  resumen: string;
  errores: string[];
  avisos: string[];
}

export interface VistaPrevia {
  error?: string;
  validas?: number;
  conAviso?: number;
  conError?: number;
  muestra?: FilaPrevia[];
  rechazos?: RechazoMigracion[];
}

/** Valida el archivo entero sin escribir nada. */
export async function previsualizar(entidad: ClaveEntidad, mapeo: Mapeo, filas: string[][]): Promise<VistaPrevia> {
  const r = await (await api()).POST("/api/v1/admin/migracion/previa", { body: { entidad, mapeo, filas } });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined) };
  return r.data;
}

export interface CorridaIniciada {
  error?: string;
  runId?: string;
}

/** Abre la corrida. A partir de acá cada lote se acumula sobre esta fila. */
export async function iniciarCorrida(
  entidad: ClaveEntidad,
  datos: { archivo: string; codificacion: string; mapeo: Mapeo; filasTotales: number },
): Promise<CorridaIniciada> {
  const r = await (await api()).POST("/api/v1/admin/migracion/corridas", { body: { entidad, ...datos } });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "No se pudo iniciar la migración.") };
  return { runId: r.data.runId };
}

export interface LoteAplicado {
  error?: string;
  creados?: number;
  actualizados?: number;
  omitidos?: number;
  conError?: number;
  rechazos?: RechazoMigracion[];
}

/**
 * Aplica un lote y lo suma a la corrida. Los contadores se suman en la base:
 * si el navegador se cierra a la mitad, lo que quedó escrito sigue siendo
 * cierto.
 */
export async function ejecutarLote(
  runId: string,
  entidad: ClaveEntidad,
  mapeo: Mapeo,
  filas: string[][],
): Promise<LoteAplicado> {
  const r = await (await api()).POST("/api/v1/admin/migracion/corridas/{id}/lote", {
    params: { path: { id: runId } },
    body: { entidad, mapeo, filas },
  });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined) };
  return r.data;
}

export interface CorridaCerrada {
  error?: string;
  controles?: Control[];
}

/** Cierra la corrida y contrasta el archivo contra lo que quedó en la base. */
export async function cerrarCorrida(
  runId: string,
  entidad: ClaveEntidad,
  mapeo: Mapeo,
  filas: string[][],
): Promise<CorridaCerrada> {
  const r = await (await api()).POST("/api/v1/admin/migracion/corridas/{id}/cerrar", {
    params: { path: { id: runId } },
    body: { entidad, mapeo, filas },
  });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined) };

  // La importación de productos crea categorías, y las categorías están
  // cacheadas entre visitas porque las lee el menú del sitio.
  updateTag(ETIQUETAS.catalogo);

  revalidatePath("/admin/migracion");
  revalidatePath("/admin/clientes");
  revalidatePath("/admin/productos");
  revalidatePath("/admin/stock");
  revalidatePath("/admin/precios");
  revalidatePath("/catalogo");

  return { controles: r.data.controles };
}
