import "server-only";

import { and, desc, eq, gte, isNull, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { eventRegistrations, events } from "@/lib/db/schema";
import { envolver, type CorreoArmado } from "@/lib/email/plantillas";
import { fechaLarga, formatearMonto, hora } from "@/lib/formato";
import { urlBase } from "@/lib/pagos/config";
import { despacharEmail } from "./avisos";

/**
 * Avisos de eventos y capacitaciones.
 *
 * Dos: la confirmación al anotarse y el recordatorio del día anterior. El
 * segundo es el que decide cuánta gente aparece: en una capacitación gratuita,
 * la diferencia entre recordar y no recordar es la mitad de la sala.
 */

function confirmacion(datos: {
  nombre: string;
  evento: string;
  cuando: string;
  lugar: string | null;
  precio: number;
  slug: string;
}): CorreoArmado {
  const cuerpo = envolver({
    titulo: `Te esperamos en ${datos.evento}`,
    adelanto: `Quedaste anotado para el ${datos.cuando}.`,
    saludo: datos.nombre,
    parrafos: ["Quedaste anotado. Guardate la fecha."],
    datos: [
      { etiqueta: "Cuándo", valor: datos.cuando },
      ...(datos.lugar ? [{ etiqueta: "Dónde", valor: datos.lugar }] : []),
      {
        etiqueta: "Costo",
        valor: datos.precio > 0 ? formatearMonto(datos.precio) : "Sin cargo",
      },
    ],
    cta: {
      texto: "Ver los detalles",
      url: `${urlBase()}/eventos/${datos.slug}`,
    },
    cierre: "Si no vas a poder venir, avisanos así le damos el lugar a otra persona.",
  });

  return { asunto: `Anotado: ${datos.evento}`, ...cuerpo };
}

function recordatorio(datos: {
  nombre: string;
  evento: string;
  cuando: string;
  lugar: string | null;
  slug: string;
}): CorreoArmado {
  const cuerpo = envolver({
    titulo: `Mañana: ${datos.evento}`,
    adelanto: `Te esperamos ${datos.cuando}.`,
    saludo: datos.nombre,
    parrafos: ["Es mañana. Te dejamos los datos para que no los busques."],
    datos: [
      { etiqueta: "Cuándo", valor: datos.cuando },
      ...(datos.lugar ? [{ etiqueta: "Dónde", valor: datos.lugar }] : []),
    ],
    cta: {
      texto: "Cómo llegar",
      url: `${urlBase()}/eventos/${datos.slug}`,
    },
  });

  return { asunto: `Mañana te esperamos: ${datos.evento}`, ...cuerpo };
}

function cuandoSeLee(inicia: Date): string {
  return `${fechaLarga.format(inicia)}, ${hora.format(inicia)}`;
}

export async function notificarInscripcion(
  registrationId: string,
): Promise<void> {
  try {
    const [fila] = await db
      .select({
        nombre: eventRegistrations.nombre,
        email: eventRegistrations.email,
        evento: events.titulo,
        slug: events.slug,
        inicia: events.inicia,
        lugar: events.lugar,
        precio: events.precio,
      })
      .from(eventRegistrations)
      .innerJoin(events, eq(events.id, eventRegistrations.eventId))
      .where(eq(eventRegistrations.id, registrationId))
      .limit(1);

    if (!fila) return;

    await despacharEmail({
      evento: "inscripcion_evento",
      para: fila.email,
      entidadTipo: "event_registration",
      entidadId: registrationId,
      correo: confirmacion({
        nombre: fila.nombre.split(" ")[0],
        evento: fila.evento,
        cuando: cuandoSeLee(fila.inicia),
        lugar: fila.lugar,
        precio: Number(fila.precio),
        slug: fila.slug,
      }),
    });
  } catch {
    // La inscripción ya está tomada.
  }
}

/**
 * Recordatorios de los eventos de mañana.
 *
 * Pensado para correrse una vez por día. `recordadoAt` es lo que evita mandar
 * el mismo recordatorio dos veces si el proceso corre de más: sin esa marca,
 * dos ejecuciones el mismo día son dos correos al mismo asistente.
 *
 * Devuelve cuántos salieron, para que quien la dispare pueda decirlo.
 */
export async function enviarRecordatorios(): Promise<number> {
  const desde = new Date();
  desde.setDate(desde.getDate() + 1);
  desde.setHours(0, 0, 0, 0);

  const hasta = new Date(desde);
  hasta.setHours(23, 59, 59, 999);

  const pendientes = await db
    .select({
      id: eventRegistrations.id,
      nombre: eventRegistrations.nombre,
      email: eventRegistrations.email,
      evento: events.titulo,
      slug: events.slug,
      inicia: events.inicia,
      lugar: events.lugar,
    })
    .from(eventRegistrations)
    .innerJoin(events, eq(events.id, eventRegistrations.eventId))
    .where(
      and(
        gte(events.inicia, desde),
        lte(events.inicia, hasta),
        eq(events.estado, "publicado"),
        eq(eventRegistrations.estado, "confirmada"),
        // Sin esto, dos ejecuciones el mismo día son dos correos al mismo
        // asistente.
        isNull(eventRegistrations.recordadoAt),
      ),
    );

  let enviados = 0;

  for (const fila of pendientes) {
    await despacharEmail({
      evento: "recordatorio_evento",
      para: fila.email,
      entidadTipo: "event_registration",
      entidadId: fila.id,
      correo: recordatorio({
        nombre: fila.nombre.split(" ")[0],
        evento: fila.evento,
        cuando: cuandoSeLee(fila.inicia),
        lugar: fila.lugar,
        slug: fila.slug,
      }),
    });

    await db
      .update(eventRegistrations)
      .set({ recordadoAt: new Date() })
      .where(eq(eventRegistrations.id, fila.id));

    enviados++;
  }

  return enviados;
}

/**
 * Aviso de inscripción confirmada, buscando por el pago.
 *
 * La llama `notificarResultadoDePago` cuando el cobro acreditado era de una
 * inscripción: en ese punto lo único que se tiene es el resultado del pago, no
 * el id de la inscripción.
 */
export async function notificarInscripcionPorPago(resultado: {
  customerId?: string | null;
}): Promise<void> {
  try {
    if (!resultado.customerId) return;

    const [fila] = await db
      .select({ id: eventRegistrations.id })
      .from(eventRegistrations)
      .where(
        and(
          eq(eventRegistrations.customerId, resultado.customerId),
          eq(eventRegistrations.estado, "confirmada"),
        ),
      )
      .orderBy(desc(eventRegistrations.updatedAt))
      .limit(1);

    if (fila) await notificarInscripcion(fila.id);
  } catch {
    // El pago ya está acreditado y el lugar confirmado.
  }
}
