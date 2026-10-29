/**
 * Los tipos de la migración del sistema anterior, del contrato de la API de
 * Go (backend/api/migracion.yaml). Leer el archivo, mapear, validar y
 * escribir vive en Go (backend/internal/migracion); acá quedan las formas
 * para las pantallas.
 */
import type { Esquemas } from "@/lib/api/tipos";

export type ClaveEntidad = Esquemas["ClaveEntidad"];
export type DefinicionEntidad = Esquemas["EntidadDeMigracion"];
export type CampoDestino = Esquemas["CampoDeMigracion"];
export type DefinicionesDeMigracion = Esquemas["DefinicionesDeMigracion"];
/** Índice de columna por cada campo de destino. -1 es "sin mapear". */
export type Mapeo = Record<string, number>;
export type RechazoMigracion = Esquemas["RechazoDeMigracion"];
export type Control = Esquemas["ControlDeMigracion"];

/** Campos que hay que mapear sí o sí para poder seguir. */
export function faltantes(entidad: DefinicionEntidad, mapeo: Mapeo): string[] {
  return entidad.campos
    .filter((campo) => campo.requerido && (mapeo[campo.clave] ?? -1) < 0)
    .map((campo) => campo.etiqueta);
}
