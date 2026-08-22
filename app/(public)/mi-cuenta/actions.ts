"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { addresses, customers, profiles, quotes } from "@/lib/db/schema";
import { verifySession } from "@/lib/dal/session";
import { clienteDeLaSesion, miPedido } from "@/lib/dal/cuenta";
import { plural } from "@/lib/formato";
import { agregarVarios } from "@/app/(public)/carrito-actions";

export interface EstadoAccion {
  error?: string;
  ok?: string;
}

/* -------------------------------------------------------------------------- */
/* Presupuestos                                                                */
/* -------------------------------------------------------------------------- */

const respuestaSchema = z.object({
  numero: z.string().trim().min(1),
  respuesta: z.enum(["aceptado", "rechazado"]),
});

/**
 * El cliente contesta un presupuesto.
 *
 * El `update` lleva tres condiciones juntas y ninguna es decorativa: el número,
 * el dueño —para que nadie conteste el presupuesto de otro— y que siga en
 * "enviado". Esa última evita que un botón viejo, en una pestaña abierta desde
 * ayer, reabra algo que en el mostrador ya se cerró.
 *
 * Aceptar no genera el pedido solo: el vendedor lo convierte desde el panel,
 * porque antes hay que confirmar stock y fecha de entrega.
 */
export async function responderPresupuesto(
  _previo: EstadoAccion,
  formData: FormData,
): Promise<EstadoAccion> {
  const parsed = respuestaSchema.safeParse({
    numero: formData.get("numero"),
    respuesta: formData.get("respuesta"),
  });

  if (!parsed.success) return { error: "No entendimos la respuesta." };

  const cliente = await clienteDeLaSesion();
  if (!cliente) return { error: "No encontramos tu ficha de cliente." };

  const actualizados = await db
    .update(quotes)
    .set({ estado: parsed.data.respuesta, updatedAt: new Date() })
    .where(
      and(
        eq(quotes.numero, parsed.data.numero),
        eq(quotes.customerId, cliente.id),
        eq(quotes.estado, "enviado"),
      ),
    )
    .returning({ id: quotes.id });

  if (actualizados.length === 0) {
    return {
      error:
        "Ese presupuesto ya no está esperando respuesta. Escribinos y lo vemos.",
    };
  }

  revalidatePath("/mi-cuenta", "layout");
  revalidatePath("/admin/presupuestos");

  return {
    ok:
      parsed.data.respuesta === "aceptado"
        ? "Listo, avisamos al vendedor. Te contactamos para coordinar la entrega."
        : "Anotado. Si querés cambiar algo, escribinos y armamos otro.",
  };
}

/* -------------------------------------------------------------------------- */
/* Volver a pedir                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Carga en el presupuesto en curso lo mismo que tenía un pedido anterior.
 *
 * En una maderera la compra se repite: la misma obra vuelve a pedir tres
 * chapas y dos tirantes cada quince días. Retipearlo desde el catálogo es
 * donde aparecen los errores de medida.
 *
 * Los precios NO se copian del pedido viejo: `agregarAlCarrito` toma el de
 * lista de hoy. Un pedido de hace tres meses no fija el precio de hoy.
 */
export async function repetirPedido(
  _previo: EstadoAccion,
  formData: FormData,
): Promise<EstadoAccion> {
  const numero = z.string().trim().min(1).safeParse(formData.get("numero"));
  if (!numero.success) return { error: "No encontramos ese pedido." };

  const pedido = await miPedido(numero.data);
  if (!pedido) return { error: "No encontramos ese pedido." };

  const resultado = await agregarVarios(
    pedido.items.map((item) => ({
      variantId: item.variantId ?? undefined,
      descripcion: item.descripcion,
      unidad: item.unidad,
      cantidad: Number(item.cantidad),
      origen: "repetido",
    })),
  );

  if (resultado.error) return { error: resultado.error };

  return {
    ok: `Cargamos ${plural(pedido.items.length, "producto")} en tu presupuesto.`,
  };
}

/* -------------------------------------------------------------------------- */
/* Mis datos                                                                   */
/* -------------------------------------------------------------------------- */

const datosSchema = z.object({
  nombre: z.string().trim().min(2, "Escribí tu nombre.").max(120),
  telefono: z.string().trim().max(40).optional(),
  razonSocial: z.string().trim().max(160).optional(),
  cuit: z
    .string()
    .trim()
    .max(20)
    .optional()
    .refine(
      (v) => !v || /^\d{2}-?\d{8}-?\d$/.test(v),
      "El CUIT tiene que tener 11 dígitos, con o sin guiones.",
    ),
  condicionIva: z.enum([
    "responsable_inscripto",
    "monotributista",
    "exento",
    "consumidor_final",
    "no_categorizado",
  ]),
});

/**
 * El cliente edita sus propios datos.
 *
 * El CUIT y la condición frente al IVA no son un trámite administrativo: ARCA
 * exige `CondicionIVAReceptorId` en toda factura desde abril de 2026, así que
 * son los datos que después deciden si se puede emitir el comprobante.
 *
 * Lo que NO se toca desde acá: el correo (es la identidad de la cuenta), el
 * límite de crédito, el tipo de cliente y la lista de precios. Todo eso lo
 * define el negocio, no quien compra.
 */
export async function guardarMisDatos(
  _previo: EstadoAccion,
  formData: FormData,
): Promise<EstadoAccion> {
  const sesion = await verifySession();

  const parsed = datosSchema.safeParse({
    nombre: formData.get("nombre"),
    telefono: (formData.get("telefono") as string) || undefined,
    razonSocial: (formData.get("razonSocial") as string) || undefined,
    cuit: (formData.get("cuit") as string) || undefined,
    condicionIva: formData.get("condicionIva"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  }

  const datos = parsed.data;
  const cuit = datos.cuit?.replace(/\D/g, "") || null;

  const cliente = await clienteDeLaSesion();
  if (!cliente) return { error: "No encontramos tu ficha de cliente." };

  await db.transaction(async (tx) => {
    await tx
      .update(customers)
      .set({
        nombre: datos.nombre,
        telefono: datos.telefono ?? null,
        razonSocial: datos.razonSocial ?? null,
        cuit,
        condicionIva: datos.condicionIva,
        updatedAt: new Date(),
      })
      .where(eq(customers.id, cliente.id));

    // El perfil guarda los mismos datos fiscales para la facturación, así que
    // se actualizan juntos o quedan diciendo cosas distintas.
    await tx
      .update(profiles)
      .set({
        telefono: datos.telefono ?? null,
        razonSocial: datos.razonSocial ?? null,
        cuit,
        condicionIva: datos.condicionIva,
        updatedAt: new Date(),
      })
      .where(eq(profiles.userId, sesion.userId));
  });

  revalidatePath("/mi-cuenta", "layout");
  return { ok: "Guardamos tus datos." };
}

/* -------------------------------------------------------------------------- */
/* Direcciones                                                                 */
/* -------------------------------------------------------------------------- */

/** Se aborta la transacción cuando el id editado no es de esta persona. */
class DireccionAjena extends Error {}

const direccionSchema = z.object({
  id: z.string().uuid().optional(),
  etiqueta: z
    .string()
    .trim()
    .min(2, "Poné un nombre para reconocerla: Casa, Obra Alem…")
    .max(60),
  calle: z.string().trim().min(4, "Escribí la calle y la altura.").max(200),
  localidad: z.string().trim().min(2, "Falta la localidad.").max(80),
  codigoPostal: z.string().trim().max(12).optional(),
  notas: z.string().trim().max(300).optional(),
  predeterminada: z.coerce.boolean().optional(),
});

export async function guardarDireccion(
  _previo: EstadoAccion,
  formData: FormData,
): Promise<EstadoAccion> {
  const parsed = direccionSchema.safeParse({
    id: (formData.get("id") as string) || undefined,
    etiqueta: formData.get("etiqueta"),
    calle: formData.get("calle"),
    localidad: formData.get("localidad"),
    codigoPostal: (formData.get("codigoPostal") as string) || undefined,
    notas: (formData.get("notas") as string) || undefined,
    predeterminada: formData.get("predeterminada") === "on",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisá la dirección." };
  }

  const cliente = await clienteDeLaSesion();
  if (!cliente) return { error: "No encontramos tu ficha de cliente." };

  const datos = parsed.data;

  const [{ cuantas }] = await db
    .select({ cuantas: sql<number>`count(*)` })
    .from(addresses)
    .where(eq(addresses.customerId, cliente.id));

  // La primera dirección queda como predeterminada sin que nadie lo marque:
  // tener una sola y que igual haya que elegirla en el checkout es trabajo de
  // más para nada.
  const predeterminada = datos.predeterminada || Number(cuantas) === 0;

  try {
    await db.transaction(async (tx) => {
      let id = datos.id;

      if (id) {
        // El `where` incluye el dueño: editar por id solo permitiría cambiar la
        // dirección de cualquiera con solo cambiar el uuid del formulario.
        const editadas = await tx
          .update(addresses)
          .set({
            etiqueta: datos.etiqueta,
            calle: datos.calle,
            localidad: datos.localidad,
            codigoPostal: datos.codigoPostal ?? null,
            notas: datos.notas ?? null,
            predeterminada,
          })
          .where(and(eq(addresses.id, id), eq(addresses.customerId, cliente.id)))
          .returning({ id: addresses.id });

        if (editadas.length === 0) throw new DireccionAjena();
      } else {
        const [creada] = await tx
          .insert(addresses)
          .values({
            customerId: cliente.id,
            etiqueta: datos.etiqueta,
            calle: datos.calle,
            localidad: datos.localidad,
            codigoPostal: datos.codigoPostal ?? null,
            notas: datos.notas ?? null,
            predeterminada,
          })
          .returning({ id: addresses.id });
        id = creada.id;
      }

      // Predeterminada hay una sola: al marcar una, las demás se apagan dentro
      // de la misma transacción para que nunca haya dos ni ninguna.
      if (predeterminada) {
        await tx
          .update(addresses)
          .set({ predeterminada: false })
          .where(and(eq(addresses.customerId, cliente.id), ne(addresses.id, id)));
      }
    });
  } catch (error) {
    if (error instanceof DireccionAjena) {
      return { error: "No encontramos esa dirección." };
    }
    throw error;
  }

  revalidatePath("/mi-cuenta/direcciones");
  return { ok: "Dirección guardada." };
}

export async function borrarDireccion(
  _previo: EstadoAccion,
  formData: FormData,
): Promise<EstadoAccion> {
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: "No encontramos esa dirección." };

  const cliente = await clienteDeLaSesion();
  if (!cliente) return { error: "No encontramos tu ficha de cliente." };

  await db
    .delete(addresses)
    .where(and(eq(addresses.id, id.data), eq(addresses.customerId, cliente.id)));

  revalidatePath("/mi-cuenta/direcciones");
  return { ok: "Dirección eliminada." };
}
