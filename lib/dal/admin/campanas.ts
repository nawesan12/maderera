import "server-only";

import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { campanas, type Campana } from "@/lib/db/schema";
import { requireStaffRole } from "@/lib/dal/session";

/**
 * Lo que lee el panel de campañas. Solo el admin (ver `lib/roles.ts`).
 */
export interface ResumenDeCampana extends Campana {
  total: number;
  enviados: number;
  fallidos: number;
  omitidos: number;
  pendientes: number;
}

/*
 * `campanas.id` va escrito a mano y no como `${campanas.id}`: adentro de la
 * subconsulta Drizzle lo escribe sin la tabla, y `"id"` a secas es el del
 * envío, no el de la campaña. Así contaba cero siempre.
 */
const conteos = {
  total: sql<number>`(select count(*)::int from campana_envios e where e.campana_id = campanas.id)`,
  enviados: sql<number>`(select count(*)::int from campana_envios e where e.campana_id = campanas.id and e.estado = 'enviado')`,
  fallidos: sql<number>`(select count(*)::int from campana_envios e where e.campana_id = campanas.id and e.estado = 'fallido')`,
  omitidos: sql<number>`(select count(*)::int from campana_envios e where e.campana_id = campanas.id and e.estado = 'omitido')`,
  pendientes: sql<number>`(select count(*)::int from campana_envios e where e.campana_id = campanas.id and e.estado = 'pendiente')`,
};

export async function listarCampanas(): Promise<ResumenDeCampana[]> {
  await requireStaffRole("admin");
  return db
    .select({ ...campanasColumnas(), ...conteos })
    .from(campanas)
    .orderBy(desc(campanas.createdAt))
    .limit(200);
}

export async function obtenerCampana(id: string): Promise<ResumenDeCampana | null> {
  await requireStaffRole("admin");
  const [fila] = await db
    .select({ ...campanasColumnas(), ...conteos })
    .from(campanas)
    .where(eq(campanas.id, id))
    .limit(1);
  return fila ?? null;
}

/** Los que no salieron, con el motivo: es lo único que hay que mirar de un envío. */
export async function fallidosDeCampana(id: string) {
  await requireStaffRole("admin");
  const { rows } = await db.execute<{ email: string; nombre: string | null; error: string | null }>(sql`
    select email, nombre, error from campana_envios
     where campana_id = ${id} and estado = 'fallido'
     order by email limit 200
  `);
  return rows;
}

/** Cuántas bajas hay, para decirlo al lado del alcance de un segmento. */
export async function cantidadDeBajas(): Promise<number> {
  await requireStaffRole("admin");
  const { rows } = await db.execute<{ n: number }>(sql`select count(*)::int as n from bajas_de_correo`);
  return rows[0]?.n ?? 0;
}

function campanasColumnas() {
  return {
    id: campanas.id,
    asunto: campanas.asunto,
    adelanto: campanas.adelanto,
    cuerpo: campanas.cuerpo,
    imagenUrl: campanas.imagenUrl,
    botonTexto: campanas.botonTexto,
    botonUrl: campanas.botonUrl,
    segmento: campanas.segmento,
    estado: campanas.estado,
    programadaPara: campanas.programadaPara,
    creadaPorUserId: campanas.creadaPorUserId,
    creadaPorNombre: campanas.creadaPorNombre,
    iniciadaAt: campanas.iniciadaAt,
    terminadaAt: campanas.terminadaAt,
    createdAt: campanas.createdAt,
    updatedAt: campanas.updatedAt,
  };
}
