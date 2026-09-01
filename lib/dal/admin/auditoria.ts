import "server-only";

import { and, desc, eq, gte, ilike, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";
import { requireStaff, type SessionUser } from "@/lib/dal/session";

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

/** La bitácora, filtrada. Solo la ve el personal. */
export async function listarBitacora(filtro: FiltroBitacora = {}) {
  await requireStaff();

  const limite = Math.min(filtro.limite ?? 60, 200);
  const condiciones: SQL[] = [];

  if (filtro.entidad) condiciones.push(eq(auditLog.entidad, filtro.entidad));
  if (filtro.accion) condiciones.push(eq(auditLog.accion, filtro.accion));
  if (filtro.usuarioId) condiciones.push(eq(auditLog.usuarioId, filtro.usuarioId));

  if (filtro.dias && filtro.dias > 0) {
    const desde = new Date();
    desde.setDate(desde.getDate() - filtro.dias);
    desde.setHours(0, 0, 0, 0);
    condiciones.push(gte(auditLog.createdAt, desde));
  }

  if (filtro.buscar?.trim()) {
    const patron = `%${filtro.buscar.trim()}%`;
    const busqueda = or(
      ilike(auditLog.descripcion, patron),
      ilike(auditLog.usuarioNombre, patron),
    );
    if (busqueda) condiciones.push(busqueda);
  }

  const where = condiciones.length > 0 ? and(...condiciones) : undefined;

  const [filas, total] = await Promise.all([
    db
      .select({
        id: auditLog.id,
        usuarioId: auditLog.usuarioId,
        usuarioNombre: auditLog.usuarioNombre,
        usuarioRol: auditLog.usuarioRol,
        accion: auditLog.accion,
        entidad: auditLog.entidad,
        entidadId: auditLog.entidadId,
        descripcion: auditLog.descripcion,
        detalle: auditLog.detalle,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .where(where)
      .orderBy(desc(auditLog.createdAt))
      .limit(limite)
      .offset(filtro.desplazamiento ?? 0),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(auditLog)
      .where(where),
  ]);

  return { filas, total: total[0]?.n ?? 0 };
}

/** Las entidades y las personas que aparecen en la bitácora, para armar los filtros. */
export async function opcionesDeBitacora() {
  await requireStaff();

  const [entidades, personas] = await Promise.all([
    db
      .selectDistinct({ entidad: auditLog.entidad })
      .from(auditLog)
      .orderBy(auditLog.entidad),
    db
      .selectDistinct({
        usuarioId: auditLog.usuarioId,
        usuarioNombre: auditLog.usuarioNombre,
      })
      .from(auditLog)
      .orderBy(auditLog.usuarioNombre),
  ]);

  return {
    entidades: entidades.map((e) => e.entidad),
    personas: personas.filter((p) => p.usuarioId),
  };
}

/** El historial de una cosa concreta, para mostrar dentro de su ficha. */
export async function historialDe(entidad: string, entidadId: string, limite = 20) {
  await requireStaff();

  return db
    .select({
      id: auditLog.id,
      usuarioNombre: auditLog.usuarioNombre,
      accion: auditLog.accion,
      descripcion: auditLog.descripcion,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .where(and(eq(auditLog.entidad, entidad), eq(auditLog.entidadId, entidadId)))
    .orderBy(desc(auditLog.createdAt))
    .limit(limite);
}

/**
 * Lo último que pasó en el panel, para la campana de actividad.
 *
 * La campana mostraba cinco avisos escritos a mano en `lib/dashboard-data.ts`,
 * siempre los mismos: "Nuevo presupuesto de Arq. Carolina Méndez, hace 5 min".
 * Ahora sale de acá.
 */
export async function actividadReciente(limite = 12) {
  await requireStaff();

  return db
    .select({
      id: auditLog.id,
      usuarioNombre: auditLog.usuarioNombre,
      accion: auditLog.accion,
      entidad: auditLog.entidad,
      entidadId: auditLog.entidadId,
      descripcion: auditLog.descripcion,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .orderBy(desc(auditLog.createdAt))
    .limit(limite);
}
