"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  customers,
  priceLists,
  professionalApplications,
  profiles,
  volumeDiscounts,
} from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";
import { parsearImporte } from "@/lib/formato";
import { variantesDeCuit } from "@/lib/cuit";
import { notificarResolucionProfesional } from "@/lib/notificaciones/profesionales";

export interface EstadoProfesionales {
  error?: string;
  ok?: string;
}

function refrescar() {
  revalidatePath("/admin/profesionales");
  revalidatePath("/admin/clientes");
  revalidatePath("/profesionales");
}

/**
 * Aprueba una solicitud y habilita el acceso.
 *
 * Es la única acción del portal que cambia lo que alguien paga, así que hace
 * tres cosas juntas y en una transacción:
 *
 * 1. **Vincula o crea la ficha de cliente.** Si ya hay una con ese CUIT se
 *    marca esa, nunca se crea otra: dos fichas del mismo cliente parten su
 *    cuenta corriente en dos y nadie se entera hasta que los saldos no cierran.
 * 2. **Asigna la lista de precios y el límite de cuenta corriente**, que son las
 *    dos decisiones comerciales de la aprobación.
 * 3. **Marca el perfil de la cuenta web**, para que el catálogo le muestre los
 *    precios nuevos apenas recargue.
 */
export async function aprobarSolicitud(
  _previo: EstadoProfesionales,
  formData: FormData,
): Promise<EstadoProfesionales> {
  const usuario = await requireStaff();

  const parsed = z
    .object({
      id: z.string().uuid(),
      priceListId: z.string().uuid().optional(),
      limiteCredito: z.string().optional(),
    })
    .safeParse({
      id: formData.get("id"),
      priceListId: (formData.get("priceListId") as string) || undefined,
      limiteCredito: (formData.get("limiteCredito") as string) || undefined,
    });

  if (!parsed.success) return { error: "Datos inválidos." };

  const solicitud = await db
    .select()
    .from(professionalApplications)
    .where(eq(professionalApplications.id, parsed.data.id))
    .limit(1)
    .then((f) => f[0]);

  if (!solicitud) return { error: "La solicitud no existe." };
  if (solicitud.estado === "aprobada") {
    return { error: "Esta solicitud ya estaba aprobada." };
  }

  const limite = parsed.data.limiteCredito
    ? parsearImporte(parsed.data.limiteCredito)
    : 0;

  if (!Number.isFinite(limite) || limite < 0) {
    return { error: "Revisá el límite de cuenta corriente." };
  }

  let nombreLista: string | null = null;

  await db.transaction(async (tx) => {
    // Ficha existente por CUIT, comparando solo dígitos: en el mostrador se
    // carga con guiones y en el formulario sin ellos.
    const [existente] = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(
        and(
          eq(customers.active, true),
          inArray(customers.cuit, variantesDeCuit(solicitud.cuit)),
        ),
      )
      .limit(1);

    const datosComerciales = {
      tipo: "profesional" as const,
      rubro: solicitud.rubro,
      priceListId: parsed.data.priceListId ?? null,
      limiteCredito: limite.toFixed(2),
      updatedAt: new Date(),
    };

    let customerId: string;

    if (existente) {
      await tx
        .update(customers)
        .set({
          ...datosComerciales,
          // Los datos de contacto de la solicitud son más nuevos que los del
          // mostrador, pero no pisan el nombre: la ficha puede estar a nombre de
          // la empresa y la solicitud a nombre de quien la llenó.
          email: solicitud.email,
          telefono: solicitud.telefono,
          razonSocial: solicitud.razonSocial ?? undefined,
        })
        .where(eq(customers.id, existente.id));

      customerId = existente.id;
    } else {
      const [creado] = await tx
        .insert(customers)
        .values({
          ...datosComerciales,
          nombre: solicitud.razonSocial || solicitud.nombre,
          razonSocial: solicitud.razonSocial,
          cuit: solicitud.cuit,
          // Un profesional factura A salvo que diga lo contrario; se corrige
          // desde la ficha si no es el caso.
          condicionIva: "responsable_inscripto",
          email: solicitud.email,
          telefono: solicitud.telefono,
          userId: solicitud.userId,
          estado: "activo",
        })
        .returning({ id: customers.id });

      customerId = creado.id;
    }

    // La cuenta web, si la tiene: es lo que hace que el catálogo le muestre los
    // precios nuevos sin que nadie toque nada más.
    if (solicitud.userId) {
      await tx
        .update(profiles)
        .set({
          role: "profesional",
          priceListId: parsed.data.priceListId ?? null,
          updatedAt: new Date(),
        })
        .where(eq(profiles.userId, solicitud.userId));
    }

    await tx
      .update(professionalApplications)
      .set({
        estado: "aprobada",
        customerId,
        resueltoPor: usuario.userId,
        resueltoAt: new Date(),
        motivoRechazo: null,
        updatedAt: new Date(),
      })
      .where(eq(professionalApplications.id, solicitud.id));

    if (parsed.data.priceListId) {
      const [lista] = await tx
        .select({ nombre: priceLists.name })
        .from(priceLists)
        .where(eq(priceLists.id, parsed.data.priceListId))
        .limit(1);

      nombreLista = lista?.nombre ?? null;
    }
  });

  refrescar();

  after(async () => {
    await notificarResolucionProfesional(solicitud.id, {
      lista: nombreLista,
      limiteCredito: limite,
    });
  });

  return {
    ok: `${solicitud.nombre} quedó habilitado. Los precios le cambian apenas recargue.`,
  };
}

export async function rechazarSolicitud(
  _previo: EstadoProfesionales,
  formData: FormData,
): Promise<EstadoProfesionales> {
  const usuario = await requireStaff();

  const parsed = z
    .object({
      id: z.string().uuid(),
      // El motivo es obligatorio: un rechazo sin explicación genera un llamado
      // que alguien va a tener que atender igual.
      motivo: z
        .string()
        .trim()
        .min(5, "Escribí el motivo: se lo mandamos al solicitante.")
        .max(300),
    })
    .safeParse({ id: formData.get("id"), motivo: formData.get("motivo") });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  }

  await db
    .update(professionalApplications)
    .set({
      estado: "rechazada",
      motivoRechazo: parsed.data.motivo,
      resueltoPor: usuario.userId,
      resueltoAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(professionalApplications.id, parsed.data.id));

  refrescar();

  after(async () => {
    await notificarResolucionProfesional(parsed.data.id);
  });

  return { ok: "Solicitud rechazada. Le avisamos por correo." };
}

/** Alta de una escala de descuento por volumen. */
export async function guardarEscala(
  _previo: EstadoProfesionales,
  formData: FormData,
): Promise<EstadoProfesionales> {
  await requireStaff();

  const parsed = z
    .object({
      priceListId: z.string().uuid(),
      desdeCantidad: z.coerce.number().positive().max(1_000_000),
      porcentaje: z.coerce
        .number()
        .positive("El descuento tiene que ser mayor a cero.")
        .max(90, "Un descuento de más del 90% seguro es un error de tipeo."),
      categoryId: z.string().uuid().optional(),
    })
    .safeParse({
      priceListId: formData.get("priceListId"),
      desdeCantidad: formData.get("desdeCantidad"),
      porcentaje: formData.get("porcentaje"),
      categoryId: (formData.get("categoryId") as string) || undefined,
    });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  }

  await db.insert(volumeDiscounts).values({
    priceListId: parsed.data.priceListId,
    categoryId: parsed.data.categoryId ?? null,
    desdeCantidad: parsed.data.desdeCantidad.toFixed(2),
    porcentaje: parsed.data.porcentaje.toFixed(2),
  });

  refrescar();
  revalidatePath("/presupuesto");

  return { ok: "Escala agregada." };
}

export async function borrarEscala(
  _previo: EstadoProfesionales,
  formData: FormData,
): Promise<EstadoProfesionales> {
  await requireStaff();

  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: "Escala inválida." };

  await db.delete(volumeDiscounts).where(eq(volumeDiscounts.id, id.data));

  refrescar();
  revalidatePath("/presupuesto");

  return { ok: "Escala eliminada." };
}
