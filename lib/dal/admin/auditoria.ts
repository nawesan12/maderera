import "server-only";

import { api, datos } from "@/lib/api/servidor";

export type AccionAuditoria =
  | "crear"
  | "editar"
  | "eliminar"
  | "cambiar_estado"
  | "cobrar"
  | "anular"
  | "importar"
  | "exportar";

export interface FiltroBitacora {
  entidad?: string;
  accion?: AccionAuditoria;
  usuarioId?: string;
  /** Días hacia atrás. Sin esto la pantalla arrancaría leyendo la tabla entera. */
  dias?: number;
  buscar?: string;
  limite?: number;
  desplazamiento?: number;
}

/*
 * La bitácora es de Go (backend/internal/bitacora): la anotan las acciones
 * de cada dominio y acá solo se lee.
 */

const conFecha = <T extends { createdAt: string }>(f: T) => ({ ...f, createdAt: new Date(f.createdAt) });

/** La bitácora, filtrada. Solo la ve el personal. */
export async function listarBitacora(filtro: FiltroBitacora = {}) {
  const query = {
    ...(filtro.entidad ? { entidad: filtro.entidad } : {}),
    ...(filtro.accion ? { accion: filtro.accion } : {}),
    ...(filtro.usuarioId ? { usuario: filtro.usuarioId } : {}),
    ...(filtro.dias && filtro.dias > 0 ? { dias: Math.min(Math.trunc(filtro.dias), 3650) } : {}),
    ...(filtro.buscar?.trim() ? { buscar: filtro.buscar.trim().slice(0, 200) } : {}),
    limite: Math.min(Math.max(Math.trunc(filtro.limite ?? 60), 1), 200),
    desplazamiento: Math.max(Math.trunc(filtro.desplazamiento ?? 0), 0),
  };
  const r = datos(await (await api()).GET("/api/v1/admin/bitacora", { params: { query } }));
  return { filas: r.filas.map(conFecha), total: r.total };
}

/** Las entidades y las personas que aparecen, para los filtros. */
export async function opcionesDeBitacora() {
  return datos(await (await api()).GET("/api/v1/admin/bitacora/opciones"));
}

/** Lo último que pasó en el panel (la campanita y el inicio). */
export async function actividadReciente(limite = 12) {
  const query = { limite: Math.min(Math.max(Math.trunc(limite), 1), 200) };
  return datos(await (await api()).GET("/api/v1/admin/bitacora", { params: { query } })).filas.map(conFecha);
}
