import "server-only";

import { api, datos } from "@/lib/api/servidor";
import type { Esquemas } from "@/lib/api/tipos";

/**
 * Solicitudes de acceso profesional, para el panel (el ACCESO de
 * /admin/profesionales). Las sirve la API de Go
 * (backend/internal/profesionales), con la ficha que ya existe con ese CUIT.
 */

export type SolicitudListada = Omit<Esquemas["SolicitudProfesional"], "createdAt" | "resueltoAt"> & {
  createdAt: Date;
  resueltoAt: Date | null;
};

export async function listarSolicitudes(): Promise<SolicitudListada[]> {
  const filas = datos(await (await api()).GET("/api/v1/admin/profesionales/solicitudes"));
  return filas.map((f) => ({
    ...f,
    createdAt: new Date(f.createdAt),
    resueltoAt: f.resueltoAt ? new Date(f.resueltoAt) : null,
  }));
}

export interface ListaAsignable {
  id: string;
  nombre: string;
  esGeneral: boolean;
}

export async function listasAsignables(): Promise<ListaAsignable[]> {
  return datos(await (await api()).GET("/api/v1/admin/profesionales/listas"));
}

export interface ResumenProfesionales {
  pendientes: number;
  aprobadosMes: number;
  clientesProfesionales: number;
}

export async function resumenProfesionales(): Promise<ResumenProfesionales> {
  return datos(await (await api()).GET("/api/v1/admin/profesionales/resumen"));
}
