import "server-only";

import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";
import { type SessionUser } from "@/lib/dal/session";
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

export interface RegistroDeAccion {
  /** La sesión que ya validó quien llama. Se pasa para no repetir la consulta. */
  sesion: Pick<SessionUser, "userId" | "name" | "email" | "staffRole">;
  accion: AccionAuditoria;
  entidad: string;
  entidadId?: string | null;
  descripcion: string;
  detalle?: unknown;
}

/**
 * Deja constancia de una acción del panel.
 *
 * **Nunca tira**: un fallo al registrar no puede voltear la operación que se
 * estaba haciendo. Si la bitácora se cae, se pierde el registro de un cambio de
 * precio; si además voltea la transacción, se pierde el cambio de precio. Lo
 * primero es un problema, lo segundo es un desastre.
 *
 * Se llama después de que la escritura principal terminó, y a propósito fuera
 * de su transacción: registrar adentro haría que un rollback se lleve también
 * el rastro de lo que se intentó.
 */
export async function registrarEnBitacora(datos: RegistroDeAccion): Promise<void> {
  try {
    await db.insert(auditLog).values({
      usuarioId: datos.sesion.userId,
      usuarioNombre: datos.sesion.name,
      usuarioEmail: datos.sesion.email,
      usuarioRol: datos.sesion.staffRole,
      accion: datos.accion,
      entidad: datos.entidad,
      entidadId: datos.entidadId ?? null,
      descripcion: datos.descripcion.slice(0, 500),
      detalle:
        datos.detalle === undefined ? null : JSON.stringify(datos.detalle).slice(0, 4000),
    });
  } catch (error) {
    console.error("[auditoría] no se pudo registrar la acción", error);
  }
}

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
 * Las lecturas las sirve la API de Go (backend/internal/bitacora). La
 * escritura de arriba queda mientras haya acciones en TS que anotan.
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
