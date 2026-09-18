import "server-only";

import { and, asc, desc, eq, isNotNull, lte, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { customerFollowUps, customers } from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";

export interface GestionListada {
  id: string;
  customerId: string;
  cliente: string;
  etapa: "pendiente" | "hablando" | "promesa" | "cerrado";
  asunto: string;
  notas: string | null;
  proximaAccionAt: Date | null;
  /** Si la fecha de volver ya pasó. Es lo que la pone arriba. */
  vencida: boolean;
  createdAt: Date;
}

/**
 * Las gestiones abiertas con los clientes.
 *
 * Lo cerrado no viene por omisión: un tablero que acumula todo lo hecho deja de
 * servir para ver qué falta, que es para lo que se mira.
 */
export async function listarGestiones(
  filtros: { incluirCerradas?: boolean } = {},
  hoy: Date = new Date(),
): Promise<GestionListada[]> {
  await requireStaff();

  const condiciones = filtros.incluirCerradas
    ? []
    : [ne(customerFollowUps.etapa, "cerrado")];

  const filas = await db
    .select({
      id: customerFollowUps.id,
      customerId: customerFollowUps.customerId,
      cliente: sql<string>`coalesce(${customers.razonSocial}, ${customers.nombre})`,
      etapa: customerFollowUps.etapa,
      asunto: customerFollowUps.asunto,
      notas: customerFollowUps.notas,
      proximaAccionAt: customerFollowUps.proximaAccionAt,
      createdAt: customerFollowUps.createdAt,
    })
    .from(customerFollowUps)
    .innerJoin(customers, eq(customers.id, customerFollowUps.customerId))
    .where(condiciones.length > 0 ? and(...condiciones) : undefined)
    // Lo que tiene fecha primero y lo más vencido arriba: es el orden en que
    // se trabaja una cartera.
    .orderBy(
      asc(customerFollowUps.proximaAccionAt),
      desc(customerFollowUps.createdAt),
    );

  return filas.map((f) => ({
    ...f,
    vencida: Boolean(f.proximaAccionAt && f.proximaAccionAt <= hoy),
  }));
}

/** Las gestiones de un cliente, para su ficha. */
export async function gestionesDelCliente(
  customerId: string,
  hoy: Date = new Date(),
): Promise<GestionListada[]> {
  const todas = await listarGestiones({ incluirCerradas: true }, hoy);
  return todas.filter((g) => g.customerId === customerId);
}

/**
 * Cuántas gestiones vencieron.
 *
 * Es lo que hace que un recordatorio sirva: aparece solo el día que hay que
 * hacer algo, en el «Para hoy» del panel, en vez de esperar a que alguien se
 * acuerde de entrar a mirar el tablero.
 */
export async function gestionesVencidas(hoy: Date = new Date()): Promise<number> {
  const [fila] = await db
    .select({ cuantas: sql<number>`count(*)::int` })
    .from(customerFollowUps)
    .where(
      and(
        ne(customerFollowUps.etapa, "cerrado"),
        isNotNull(customerFollowUps.proximaAccionAt),
        lte(customerFollowUps.proximaAccionAt, hoy),
      ),
    );

  return Number(fila?.cuantas ?? 0);
}
