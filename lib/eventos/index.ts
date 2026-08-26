import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { eventRegistrations, events } from "@/lib/db/schema";

/**
 * Inscripciones a eventos (cláusula 1.7).
 *
 * El cupo es el dato que manda: sobrevender una capacitación presencial
 * significa gente parada en la puerta. Por eso la inscripción se toma con un
 * lock por evento y contando adentro de la transacción, igual que la numeración
 * fiscal: dos personas anotándose a la vez al último lugar no pueden entrar las
 * dos.
 */

export class ErrorDeInscripcion extends Error {}

export interface InscripcionCreada {
  id: string;
  requierePago: boolean;
  monto: number;
}

/** Entero estable para el lock, derivado del id del evento. */
function claveDeLock(eventId: string) {
  return sql`hashtext(${eventId})`;
}

export async function inscribir(opciones: {
  eventId: string;
  nombre: string;
  email: string;
  telefono?: string | null;
  customerId?: string | null;
  userId?: string | null;
  /** Si quien se anota es profesional aprobado. */
  esProfesional: boolean;
}): Promise<InscripcionCreada> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(${claveDeLock(opciones.eventId)})`,
    );

    const [evento] = await tx
      .select()
      .from(events)
      .where(eq(events.id, opciones.eventId))
      .limit(1);

    if (!evento || evento.estado !== "publicado") {
      throw new ErrorDeInscripcion("Este evento ya no está abierto.");
    }

    if (evento.inicia.getTime() < Date.now()) {
      throw new ErrorDeInscripcion("Este evento ya pasó.");
    }

    if (evento.soloProfesionales && !opciones.esProfesional) {
      throw new ErrorDeInscripcion(
        "Este evento es para clientes profesionales. Pedí tu acceso y te anotamos.",
      );
    }

    // Una persona no se anota dos veces con el mismo correo. El índice único lo
    // impediría igual, pero fallando con un error de base en la cara de quien
    // se anota.
    const [yaEsta] = await tx
      .select({ id: eventRegistrations.id, estado: eventRegistrations.estado })
      .from(eventRegistrations)
      .where(
        and(
          eq(eventRegistrations.eventId, evento.id),
          eq(eventRegistrations.email, opciones.email),
        ),
      )
      .limit(1);

    if (yaEsta && yaEsta.estado !== "cancelada") {
      throw new ErrorDeInscripcion("Ya estás anotado a este evento.");
    }

    if (evento.cupo > 0) {
      const [ocupados] = await tx
        .select({ cantidad: sql<number>`count(*)::int` })
        .from(eventRegistrations)
        .where(
          and(
            eq(eventRegistrations.eventId, evento.id),
            sql`${eventRegistrations.estado} in ('reservada', 'confirmada', 'asistio')`,
          ),
        );

      if ((ocupados?.cantidad ?? 0) >= evento.cupo) {
        throw new ErrorDeInscripcion(
          "Se agotaron los lugares. Escribinos y te avisamos si se libera alguno.",
        );
      }
    }

    const monto = Number(evento.precio);
    const requierePago = monto > 0;

    const valores = {
      eventId: evento.id,
      customerId: opciones.customerId ?? null,
      userId: opciones.userId ?? null,
      nombre: opciones.nombre,
      email: opciones.email,
      telefono: opciones.telefono ?? null,
      // Gratuito queda confirmado de una: no hay nada que esperar. Con precio
      // queda reservado —ocupa lugar— hasta que el pago se acredite.
      estado: requierePago ? ("reservada" as const) : ("confirmada" as const),
      updatedAt: new Date(),
    };

    let id: string;

    if (yaEsta) {
      await tx
        .update(eventRegistrations)
        .set(valores)
        .where(eq(eventRegistrations.id, yaEsta.id));
      id = yaEsta.id;
    } else {
      const [creada] = await tx
        .insert(eventRegistrations)
        .values(valores)
        .returning({ id: eventRegistrations.id });
      id = creada.id;
    }

    return { id, requierePago, monto };
  });
}

/**
 * Confirma la inscripción cuando se acredita el pago.
 *
 * La llama el módulo de cobros con el id del pago. Es idempotente: confirmar
 * dos veces la misma inscripción no cambia nada.
 */
export async function confirmarInscripcionPorPago(
  paymentId: string,
): Promise<void> {
  await db
    .update(eventRegistrations)
    .set({ estado: "confirmada", updatedAt: new Date() })
    .where(
      and(
        eq(eventRegistrations.paymentId, paymentId),
        eq(eventRegistrations.estado, "reservada"),
      ),
    );
}

/** Suelta el lugar de una inscripción cancelada. */
export async function cancelarInscripcion(id: string): Promise<void> {
  await db
    .update(eventRegistrations)
    .set({ estado: "cancelada", updatedAt: new Date() })
    .where(eq(eventRegistrations.id, id));
}
