import "server-only";

import { cache } from "react";
import { and, asc, desc, eq, gte, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  customers,
  events,
  eventRegistrations,
  priceLists,
  professionalApplications,
  technicalDocuments,
} from "@/lib/db/schema";
import { getSession } from "@/lib/dal/session";
import { clienteDeLaSesion } from "@/lib/dal/cuenta";

/**
 * Lecturas del portal de profesionales, del lado público.
 *
 * La pregunta central —"¿esta persona es profesional aprobado?"— se responde
 * acá y en un solo lugar, porque de ella dependen los precios que ve, la
 * documentación que puede bajar y a qué eventos se puede anotar. Repetir el
 * criterio en cada pantalla es cómo se filtran precios mayoristas al público.
 */

export interface EstadoProfesional {
  /** Aprobado: ficha de cliente marcada como profesional y activa. */
  aprobado: boolean;
  customerId: string | null;
  nombre: string | null;
  /** Lista de precios asignada, si tiene una propia. */
  priceListId: string | null;
  nombreLista: string | null;
  limiteCredito: number;
  /** Solicitud en curso, si mandó una y todavía no se resolvió. */
  solicitud: {
    id: string;
    estado: "pendiente" | "aprobada" | "rechazada";
    motivoRechazo: string | null;
    createdAt: Date;
  } | null;
}

/**
 * En qué situación está quien mira la página.
 *
 * Memoizado con `cache()` para toda la request: lo consultan la página, el
 * catálogo y el carrito, y sería la misma consulta tres veces.
 */
export const estadoProfesional = cache(async (): Promise<EstadoProfesional> => {
  const vacio: EstadoProfesional = {
    aprobado: false,
    customerId: null,
    nombre: null,
    priceListId: null,
    nombreLista: null,
    limiteCredito: 0,
    solicitud: null,
  };

  const sesion = await getSession();
  if (!sesion) return vacio;

  const cliente = await clienteDeLaSesion();

  const [solicitud] = await db
    .select({
      id: professionalApplications.id,
      estado: professionalApplications.estado,
      motivoRechazo: professionalApplications.motivoRechazo,
      createdAt: professionalApplications.createdAt,
    })
    .from(professionalApplications)
    .where(
      or(
        eq(professionalApplications.userId, sesion.userId),
        cliente ? eq(professionalApplications.customerId, cliente.id) : undefined,
      ),
    )
    .orderBy(desc(professionalApplications.createdAt))
    .limit(1);

  if (!cliente) return { ...vacio, solicitud: solicitud ?? null };

  // La verdad sobre si es profesional está en la ficha, no en la solicitud: un
  // vendedor puede marcar a alguien como profesional desde el mostrador sin que
  // haya pasado nunca por el formulario.
  const aprobado = cliente.tipo === "profesional" && cliente.estado !== "inactivo";

  const [lista] = cliente
    ? await db
        .select({
          id: priceLists.id,
          nombre: priceLists.name,
          priceListId: customers.priceListId,
        })
        .from(customers)
        .leftJoin(priceLists, eq(priceLists.id, customers.priceListId))
        .where(eq(customers.id, cliente.id))
        .limit(1)
    : [];

  return {
    aprobado,
    customerId: cliente.id,
    nombre: cliente.nombre,
    priceListId: lista?.priceListId ?? null,
    nombreLista: lista?.nombre ?? null,
    limiteCredito: cliente.limiteCredito,
    solicitud: solicitud ?? null,
  };
});

export interface DocumentoTecnico {
  id: string;
  titulo: string;
  descripcion: string | null;
  categoria: string;
  url: string;
  formato: string;
  tamanoBytes: number | null;
  soloProfesionales: boolean;
}

/**
 * Documentación técnica que esta persona puede ver.
 *
 * El filtro por permiso va **dentro de la consulta**, no después: listar todo y
 * filtrar en la pantalla ya sería haber leído lo que no corresponde, y basta un
 * descuido en el JSX para que se muestre.
 */
export async function documentosVisibles(): Promise<DocumentoTecnico[]> {
  const estado = await estadoProfesional();

  const condiciones = [eq(technicalDocuments.activo, true)];

  if (!estado.aprobado) {
    condiciones.push(eq(technicalDocuments.soloProfesionales, false));
  }

  return db
    .select({
      id: technicalDocuments.id,
      titulo: technicalDocuments.titulo,
      descripcion: technicalDocuments.descripcion,
      categoria: technicalDocuments.categoria,
      url: technicalDocuments.url,
      formato: technicalDocuments.formato,
      tamanoBytes: technicalDocuments.tamanoBytes,
      soloProfesionales: technicalDocuments.soloProfesionales,
    })
    .from(technicalDocuments)
    .where(and(...condiciones))
    .orderBy(asc(technicalDocuments.orden), asc(technicalDocuments.titulo));
}

/** Cuántos documentos hay reservados para profesionales, sin mostrar cuáles. */
export async function documentosReservados(): Promise<number> {
  const [fila] = await db
    .select({ cantidad: sql<number>`count(*)::int` })
    .from(technicalDocuments)
    .where(
      and(
        eq(technicalDocuments.activo, true),
        eq(technicalDocuments.soloProfesionales, true),
      ),
    );

  return fila?.cantidad ?? 0;
}

export interface EventoPublico {
  id: string;
  slug: string;
  titulo: string;
  resumen: string | null;
  imagenUrl: string | null;
  lugar: string | null;
  inicia: Date;
  termina: Date | null;
  cupo: number;
  precio: number;
  soloProfesionales: boolean;
  /** Inscripciones que ocupan lugar: reservadas y confirmadas. */
  inscriptos: number;
}

/** Eventos publicados que todavía no pasaron. */
export async function eventosProximos(): Promise<EventoPublico[]> {
  const filas = await db
    .select({
      id: events.id,
      slug: events.slug,
      titulo: events.titulo,
      resumen: events.resumen,
      imagenUrl: events.imagenUrl,
      lugar: events.lugar,
      inicia: events.inicia,
      termina: events.termina,
      cupo: events.cupo,
      precio: events.precio,
      soloProfesionales: events.soloProfesionales,
      inscriptos: sql<number>`(
        select count(*)::int from event_registrations er
        where er.event_id = events.id
          and er.estado in ('reservada', 'confirmada', 'asistio')
      )`,
    })
    .from(events)
    .where(and(eq(events.estado, "publicado"), gte(events.inicia, new Date())))
    .orderBy(asc(events.inicia));

  return filas.map((f) => ({ ...f, precio: Number(f.precio) }));
}

export interface EventoConDetalle extends EventoPublico {
  descripcion: string | null;
  /** Si quien mira ya está anotado. */
  miInscripcion: { id: string; estado: string } | null;
}

export async function eventoPorSlug(
  slug: string,
): Promise<EventoConDetalle | null> {
  const [evento] = await db
    .select({
      id: events.id,
      slug: events.slug,
      titulo: events.titulo,
      resumen: events.resumen,
      descripcion: events.descripcion,
      imagenUrl: events.imagenUrl,
      lugar: events.lugar,
      inicia: events.inicia,
      termina: events.termina,
      cupo: events.cupo,
      precio: events.precio,
      soloProfesionales: events.soloProfesionales,
      estado: events.estado,
      inscriptos: sql<number>`(
        select count(*)::int from event_registrations er
        where er.event_id = events.id
          and er.estado in ('reservada', 'confirmada', 'asistio')
      )`,
    })
    .from(events)
    .where(eq(events.slug, slug))
    .limit(1);

  if (!evento || evento.estado === "borrador") return null;

  const sesion = await getSession();

  const [mia] = sesion
    ? await db
        .select({
          id: eventRegistrations.id,
          estado: eventRegistrations.estado,
        })
        .from(eventRegistrations)
        .where(
          and(
            eq(eventRegistrations.eventId, evento.id),
            eq(eventRegistrations.userId, sesion.userId),
          ),
        )
        .limit(1)
    : [];

  return {
    ...evento,
    precio: Number(evento.precio),
    miInscripcion: mia ?? null,
  };
}
