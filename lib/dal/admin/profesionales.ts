import "server-only";

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  customers,
  priceLists,
  professionalApplications,
  volumeDiscounts,
} from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";
import { variantesDeCuit } from "@/lib/cuit";

/** Solicitudes de acceso profesional. Solo personal de la empresa. */

export interface SolicitudListada {
  id: string;
  nombre: string;
  razonSocial: string | null;
  cuit: string;
  email: string;
  telefono: string;
  rubro: string;
  matricula: string | null;
  volumenEstimado: string | null;
  localidad: string | null;
  mensaje: string | null;
  estado: "pendiente" | "aprobada" | "rechazada";
  motivoRechazo: string | null;
  customerId: string | null;
  /** Ficha existente con ese CUIT, si ya compra en el mostrador. */
  clienteExistente: { id: string; nombre: string } | null;
  createdAt: Date;
  resueltoAt: Date | null;
}

export async function listarSolicitudes(): Promise<SolicitudListada[]> {
  await requireStaff();

  const filas = await db
    .select({
      id: professionalApplications.id,
      nombre: professionalApplications.nombre,
      razonSocial: professionalApplications.razonSocial,
      cuit: professionalApplications.cuit,
      email: professionalApplications.email,
      telefono: professionalApplications.telefono,
      rubro: professionalApplications.rubro,
      matricula: professionalApplications.matricula,
      volumenEstimado: professionalApplications.volumenEstimado,
      localidad: professionalApplications.localidad,
      mensaje: professionalApplications.mensaje,
      estado: professionalApplications.estado,
      motivoRechazo: professionalApplications.motivoRechazo,
      customerId: professionalApplications.customerId,
      createdAt: professionalApplications.createdAt,
      resueltoAt: professionalApplications.resueltoAt,
    })
    .from(professionalApplications)
    .orderBy(desc(professionalApplications.createdAt))
    .limit(200);

  if (filas.length === 0) return [];

  // Fichas que ya existen con ese CUIT. Es el dato que decide si aprobar crea
  // una ficha nueva o marca la que ya compra en el mostrador: duplicar un
  // cliente parte su cuenta corriente en dos.
  const cuits = [...new Set(filas.map((f) => f.cuit))];

  // Se busca por las dos formas en que puede estar guardado —con guiones y sin
  // ellos— en vez de normalizar con `regexp_replace` dentro de la consulta: así
  // la comparación usa el índice de `customers.cuit`.
  const buscados = cuits.flatMap(variantesDeCuit);

  const existentes = await db
    .select({ id: customers.id, nombre: customers.nombre, cuit: customers.cuit })
    .from(customers)
    .where(and(eq(customers.active, true), inArray(customers.cuit, buscados)));

  const porCuit = new Map(
    existentes.map((c) => [
      (c.cuit ?? "").replace(/\D/g, ""),
      { id: c.id, nombre: c.nombre },
    ]),
  );

  return filas.map((f) => ({
    ...f,
    clienteExistente: porCuit.get(f.cuit) ?? null,
  }));
}

export async function obtenerSolicitud(id: string) {
  await requireStaff();

  const [fila] = await db
    .select()
    .from(professionalApplications)
    .where(eq(professionalApplications.id, id))
    .limit(1);

  return fila ?? null;
}

export interface ListaAsignable {
  id: string;
  nombre: string;
  esGeneral: boolean;
  /** Cuántas escalas de volumen tiene cargadas. */
  escalas: number;
}

export async function listasAsignables(): Promise<ListaAsignable[]> {
  await requireStaff();

  const filas = await db
    .select({
      id: priceLists.id,
      nombre: priceLists.name,
      esGeneral: priceLists.isDefault,
      escalas: sql<number>`(
        select count(*)::int from volume_discounts vd
        where vd.price_list_id = price_lists.id and vd.activo
      )`,
    })
    .from(priceLists)
    .where(eq(priceLists.active, true))
    .orderBy(asc(priceLists.name));

  return filas;
}

export interface EscalaListada {
  id: string;
  priceListId: string;
  lista: string;
  variantId: string | null;
  categoryId: string | null;
  desdeCantidad: number;
  porcentaje: number;
  activo: boolean;
}

export async function listarEscalas(): Promise<EscalaListada[]> {
  await requireStaff();

  const filas = await db
    .select({
      id: volumeDiscounts.id,
      priceListId: volumeDiscounts.priceListId,
      lista: priceLists.name,
      variantId: volumeDiscounts.variantId,
      categoryId: volumeDiscounts.categoryId,
      desdeCantidad: volumeDiscounts.desdeCantidad,
      porcentaje: volumeDiscounts.porcentaje,
      activo: volumeDiscounts.activo,
    })
    .from(volumeDiscounts)
    .innerJoin(priceLists, eq(priceLists.id, volumeDiscounts.priceListId))
    .orderBy(asc(priceLists.name), asc(volumeDiscounts.desdeCantidad));

  return filas.map((f) => ({
    ...f,
    desdeCantidad: Number(f.desdeCantidad),
    porcentaje: Number(f.porcentaje),
  }));
}

export interface ResumenProfesionales {
  pendientes: number;
  aprobadosMes: number;
  clientesProfesionales: number;
}

export async function resumenProfesionales(): Promise<ResumenProfesionales> {
  await requireStaff();

  const inicioDeMes = new Date();
  inicioDeMes.setDate(1);
  inicioDeMes.setHours(0, 0, 0, 0);

  const [pendientes] = await db
    .select({ cantidad: sql<number>`count(*)::int` })
    .from(professionalApplications)
    .where(eq(professionalApplications.estado, "pendiente"));

  const [aprobados] = await db
    .select({ cantidad: sql<number>`count(*)::int` })
    .from(professionalApplications)
    .where(
      and(
        eq(professionalApplications.estado, "aprobada"),
        sql`${professionalApplications.resueltoAt} >= ${inicioDeMes}`,
      ),
    );

  const [profesionales] = await db
    .select({ cantidad: sql<number>`count(*)::int` })
    .from(customers)
    .where(and(eq(customers.tipo, "profesional"), eq(customers.active, true)));

  return {
    pendientes: pendientes?.cantidad ?? 0,
    aprobadosMes: aprobados?.cantidad ?? 0,
    clientesProfesionales: profesionales?.cantidad ?? 0,
  };
}
