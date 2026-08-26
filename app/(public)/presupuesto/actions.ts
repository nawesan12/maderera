"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { customers, quoteItems, quotes } from "@/lib/db/schema";
import { getSession } from "@/lib/dal/session";
import { obtenerCarrito } from "@/lib/dal/carrito";
import { estadoProfesional } from "@/lib/dal/profesionales";
import { siguienteNumero } from "@/lib/dal/admin/ventas";
import { vencimientoExpress } from "@/lib/plazos";
import { notificarPresupuestoRecibido } from "@/lib/notificaciones/presupuestos";

export interface EstadoPresupuesto {
  error?: string;
  ok?: string;
  numero?: string;
  /** Verdadero cuando entró por la cola express, para decirlo en pantalla. */
  express?: boolean;
}

const esquema = z.object({
  nombre: z.string().trim().min(2, "Necesitamos tu nombre.").max(120),
  email: z.string().trim().email("Revisá el correo."),
  telefono: z.string().trim().min(6, "Dejanos un teléfono.").max(40),
  sucursalId: z.string().uuid().optional(),
  notas: z.string().trim().max(800).optional(),
});

/** Cuánto vale un presupuesto antes de que los precios se muevan. */
const DIAS_DE_VALIDEZ = 15;

/**
 * Convierte el presupuesto en curso en una cotización real.
 *
 * Hasta ahora el presupuestador solo armaba un mensaje de WhatsApp: nada
 * quedaba registrado, y el pedido dependía de que alguien no perdiera el
 * chat. Ahora cae en el panel como un `quote` con número, con los precios
 * congelados del momento.
 *
 * **El carrito no se vacía.** Pedir un presupuesto no es comprar: mucha gente
 * pide la cotización y compra igual, y borrarle el carrito la obliga a armarlo
 * de nuevo.
 *
 * Para un profesional aprobado entra por la cola express, con vencimiento de
 * respuesta a 24 horas hábiles (cláusula 1.7). Es la misma entidad con otra
 * promesa encima, no un tipo distinto de presupuesto.
 */
export async function pedirPresupuesto(
  _previo: EstadoPresupuesto,
  formData: FormData,
): Promise<EstadoPresupuesto> {
  const parsed = esquema.safeParse({
    nombre: formData.get("nombre"),
    email: formData.get("email"),
    telefono: formData.get("telefono"),
    sucursalId: (formData.get("sucursalId") as string) || undefined,
    notas: (formData.get("notas") as string) || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  }

  const datos = parsed.data;
  const carrito = await obtenerCarrito();

  if (!carrito.id || carrito.items.length === 0) {
    return { error: "Agregá al menos un producto antes de pedir el presupuesto." };
  }

  const [sesion, profesional] = await Promise.all([
    getSession(),
    estadoProfesional(),
  ]);

  // Igual que en el checkout: si quien pide ya es cliente, el presupuesto queda
  // atado a su ficha.
  let customerId = profesional.customerId;

  if (!customerId) {
    const [porMail] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.email, datos.email))
      .limit(1);

    customerId = porMail?.id ?? null;
  }

  const numero = await siguienteNumero("P");
  const esExpress = profesional.aprobado;

  const validoHasta = new Date();
  validoHasta.setDate(validoHasta.getDate() + DIAS_DE_VALIDEZ);

  await db.transaction(async (tx) => {
    const [presupuesto] = await tx
      .insert(quotes)
      .values({
        numero,
        customerId,
        contactoNombre: datos.nombre,
        contactoEmail: datos.email,
        contactoTelefono: datos.telefono,
        branchId: datos.sucursalId ?? null,
        estado: "pendiente",
        origen: esExpress ? "express" : "sitio",
        subtotal: carrito.subtotal.toFixed(2),
        total: carrito.subtotal.toFixed(2),
        notas: datos.notas ?? null,
        validoHasta,
        respondeHasta: esExpress ? vencimientoExpress() : null,
        createdByUserId: sesion?.userId,
      })
      .returning({ id: quotes.id });

    // Los precios se copian, no se referencian: un presupuesto es una oferta
    // con fecha, y el papel que recibió el cliente tiene que seguir diciendo lo
    // mismo aunque después cambie la lista.
    await tx.insert(quoteItems).values(
      carrito.items.map((item, i) => {
        const precio = item.precioActual ?? item.precioUnitario ?? 0;
        return {
          quoteId: presupuesto.id,
          variantId: item.variantId,
          descripcion: item.descripcion,
          unidad: item.unidad,
          cantidad: item.cantidad.toFixed(2),
          precioUnitario: precio.toFixed(2),
          subtotal: (precio * item.cantidad).toFixed(2),
          notas: item.notas,
          orden: i,
        };
      }),
    );

    after(async () => {
      await notificarPresupuestoRecibido(presupuesto.id);
    });
  });

  revalidatePath("/admin/presupuestos");
  revalidatePath("/admin");

  return {
    ok: esExpress
      ? `Recibimos tu pedido ${numero}. Como sos cliente profesional, te contestamos dentro de las 24 horas hábiles.`
      : `Recibimos tu pedido ${numero}. Te contestamos a la brevedad con el presupuesto armado.`,
    numero,
    express: esExpress,
  };
}
