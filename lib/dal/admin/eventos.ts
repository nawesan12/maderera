import "server-only";

import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { branches, eventRegistrations, events } from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";

/** Eventos y sus inscriptos, para el panel. */

export interface EventoAdmin {
  id: string;
  slug: string;
  titulo: string;
  resumen: string | null;
  lugar: string | null;
  sucursal: string | null;
  inicia: Date;
  termina: Date | null;
  cupo: number;
  precio: number;
  soloProfesionales: boolean;
  estado: string;
  inscriptos: number;
  confirmados: number;
  reservados: number;
  /** Cuánto se cobró de verdad: solo las inscripciones confirmadas. */
  recaudado: number;
}

export async function listarEventos(): Promise<EventoAdmin[]> {
  await requireStaff();

  const filas = await db
    .select({
      id: events.id,
      slug: events.slug,
      titulo: events.titulo,
      resumen: events.resumen,
      lugar: events.lugar,
      sucursal: branches.name,
      inicia: events.inicia,
      termina: events.termina,
      cupo: events.cupo,
      precio: events.precio,
      soloProfesionales: events.soloProfesionales,
      estado: events.estado,
      inscriptos: sql<number>`(
        select count(*)::int from event_registrations er
        where er.event_id = events.id and er.estado <> 'cancelada'
      )`,
      confirmados: sql<number>`(
        select count(*)::int from event_registrations er
        where er.event_id = events.id and er.estado in ('confirmada', 'asistio')
      )`,
      reservados: sql<number>`(
        select count(*)::int from event_registrations er
        where er.event_id = events.id and er.estado = 'reservada'
      )`,
    })
    .from(events)
    .leftJoin(branches, eq(branches.id, events.branchId))
    .orderBy(desc(events.inicia));

  return filas.map((f) => ({
    ...f,
    precio: Number(f.precio),
    // Lo confirmado por el precio: las reservas sin pagar no son plata.
    recaudado: Number(f.precio) * f.confirmados,
  }));
}

export interface Asistente {
  id: string;
  nombre: string;
  email: string;
  telefono: string | null;
  estado: string;
  recordadoAt: Date | null;
  createdAt: Date;
}

export async function asistentesDe(eventId: string): Promise<Asistente[]> {
  await requireStaff();

  return db
    .select({
      id: eventRegistrations.id,
      nombre: eventRegistrations.nombre,
      email: eventRegistrations.email,
      telefono: eventRegistrations.telefono,
      estado: eventRegistrations.estado,
      recordadoAt: eventRegistrations.recordadoAt,
      createdAt: eventRegistrations.createdAt,
    })
    .from(eventRegistrations)
    .where(eq(eventRegistrations.eventId, eventId))
    .orderBy(asc(eventRegistrations.createdAt));
}
