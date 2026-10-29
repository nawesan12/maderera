import "server-only";

import { api, datos } from "@/lib/api/servidor";
import type { Esquemas } from "@/lib/api/tipos";
import type { DefinicionesDeMigracion } from "@/lib/migracion/tipos";

/*
 * La migración del sistema anterior: lo lee la API de Go
 * (backend/internal/migracion).
 */

export type CorridaMigracion = Omit<Esquemas["CorridaDeMigracion"], "createdAt" | "finishedAt"> & {
  createdAt: Date;
  finishedAt: Date | null;
};

/** Últimas corridas, para saber qué se migró y qué quedó por el camino. */
export async function historialDeMigraciones(limite = 20): Promise<CorridaMigracion[]> {
  const filas = datos(await (await api()).GET("/api/v1/admin/migracion/corridas", { params: { query: { limite } } }));
  return filas.map((fila) => ({
    ...fila,
    createdAt: new Date(fila.createdAt),
    finishedAt: fila.finishedAt ? new Date(fila.finishedAt) : null,
  }));
}

export type EstadoDelSistema = Esquemas["EstadoDeMigracion"];

/**
 * Lo que ya hay cargado, para poder mirar antes de subir nada: contesta
 * «¿esto ya lo corrí?» sin abrir el historial.
 */
export async function estadoDelSistema(): Promise<EstadoDelSistema> {
  return datos(await (await api()).GET("/api/v1/admin/migracion/estado"));
}

/** Las siete entidades, con sus campos, y el tamaño del lote. */
export async function definicionesDeMigracion(): Promise<DefinicionesDeMigracion> {
  return datos(await (await api()).GET("/api/v1/admin/migracion/entidades"));
}
