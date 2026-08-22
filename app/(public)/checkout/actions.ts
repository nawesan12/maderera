"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  accountMovements,
  cartItems,
  carts,
  customers,
  orderItems,
  orderStatusHistory,
  orders,
} from "@/lib/db/schema";
import { getSession } from "@/lib/dal/session";
import { obtenerCarrito } from "@/lib/dal/carrito";
import { calcularEnvio, listarZonasDeEnvio } from "@/lib/dal/envios";
import { creditoDisponible } from "@/lib/dal/cuenta";
import { siguienteNumero } from "@/lib/dal/admin/ventas";

export interface EstadoCheckout {
  error?: string;
  /** Número del pedido creado, para la pantalla de confirmación. */
  numero?: string;
}

const checkoutSchema = z
  .object({
    nombre: z.string().trim().min(2, "Necesitamos tu nombre.").max(120),
    email: z.string().trim().email("Revisá el correo."),
    telefono: z
      .string()
      .trim()
      .min(6, "Dejanos un teléfono para coordinar.")
      .max(40),
    entrega: z.enum(["retiro", "envio"]),
    sucursalId: z.string().uuid().optional(),
    zonaId: z.string().uuid().optional(),
    direccion: z.string().trim().max(240).optional(),
    medioPago: z.enum([
      "mercado_pago",
      "transferencia",
      "efectivo",
      "cuenta_corriente",
    ]),
    notas: z.string().trim().max(600).optional(),
  })
  .refine(
    (d) => d.entrega === "retiro" || (d.zonaId && d.direccion),
    "Para el envío necesitamos la zona y la dirección.",
  )
  .refine(
    (d) => d.entrega === "envio" || Boolean(d.sucursalId),
    "Elegí en qué sucursal lo vas a retirar.",
  );

/**
 * Cierra la compra y crea el pedido.
 *
 * Todo pasa en una transacción: se crea el pedido, se copian las líneas, se
 * registra el estado inicial y se vacía el carrito. Si algo falla en el medio,
 * no queda ni un pedido a medias ni un carrito vaciado sin pedido.
 *
 * Los precios se toman de la base en el momento de confirmar, nunca del
 * formulario: si vinieran del navegador, cualquiera podría comprarse una placa
 * a un peso.
 */
export async function confirmarCompra(
  _previo: EstadoCheckout,
  formData: FormData,
): Promise<EstadoCheckout> {
  const parsed = checkoutSchema.safeParse({
    nombre: formData.get("nombre"),
    email: formData.get("email"),
    telefono: formData.get("telefono"),
    entrega: formData.get("entrega"),
    sucursalId: (formData.get("sucursalId") as string) || undefined,
    zonaId: (formData.get("zonaId") as string) || undefined,
    direccion: (formData.get("direccion") as string) || undefined,
    medioPago: formData.get("medioPago"),
    notas: (formData.get("notas") as string) || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  }

  const datos = parsed.data;
  const carrito = await obtenerCarrito();

  if (!carrito.id || carrito.items.length === 0) {
    return { error: "El presupuesto está vacío." };
  }

  const sinPrecio = carrito.items.filter(
    (i) => (i.precioActual ?? i.precioUnitario ?? 0) <= 0,
  );

  if (sinPrecio.length > 0) {
    return {
      error:
        "Hay productos sin precio cargado. Pedilos por WhatsApp y te pasamos la cotización.",
    };
  }

  let costoEnvio = 0;
  let nombreZona: string | null = null;

  if (datos.entrega === "envio" && datos.zonaId) {
    const zonas = await listarZonasDeEnvio();
    const zona = zonas.find((z) => z.id === datos.zonaId);
    if (!zona) return { error: "Esa zona de envío ya no está disponible." };

    costoEnvio = calcularEnvio(zona, carrito.subtotal);
    nombreZona = zona.nombre;
  }

  const sesion = await getSession();
  const numero = await siguienteNumero("PED");

  // Si quien compra ya es cliente, el pedido queda atado a su ficha.
  let customerId: string | null = null;

  if (sesion) {
    const [propio] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.userId, sesion.userId))
      .limit(1);
    customerId = propio?.id ?? null;
  }

  if (!customerId) {
    const [porMail] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.email, datos.email))
      .limit(1);
    customerId = porMail?.id ?? null;
  }

  const total = carrito.subtotal + costoEnvio;

  // La cuenta corriente se verifica acá y no solo en la pantalla: el formulario
  // puede mandar cualquier medio de pago, y "comprar sin pagar" era literalmente
  // cuestión de cambiar un radio button desde las herramientas del navegador.
  if (datos.medioPago === "cuenta_corriente") {
    const credito = await creditoDisponible(total);

    if (!credito.habilitado || !customerId) {
      return {
        error:
          credito.motivo ??
          "No podemos cargar esta compra a cuenta corriente. Elegí otro medio de pago.",
      };
    }
  }

  await db.transaction(async (tx) => {
    const [pedido] = await tx
      .insert(orders)
      .values({
        numero,
        customerId,
        contactoNombre: datos.nombre,
        contactoEmail: datos.email,
        contactoTelefono: datos.telefono,
        branchId: datos.sucursalId ?? null,
        estado: "pendiente",
        origen: "tienda",
        tipoEntrega: datos.entrega,
        direccionEntrega: datos.direccion ?? null,
        zonaEnvio: nombreZona,
        costoEnvio: costoEnvio.toFixed(2),
        subtotal: carrito.subtotal.toFixed(2),
        total: total.toFixed(2),
        medioPago: datos.medioPago,
        estadoPago: "pendiente",
        notas: datos.notas ?? null,
        createdByUserId: sesion?.userId,
      })
      .returning();

    await tx.insert(orderItems).values(
      carrito.items.map((item, i) => {
        const precio = item.precioActual ?? item.precioUnitario ?? 0;
        return {
          orderId: pedido.id,
          variantId: item.variantId,
          descripcion: item.descripcion,
          unidad: item.unidad,
          cantidad: item.cantidad.toFixed(2),
          precioUnitario: precio.toFixed(2),
          subtotal: (precio * item.cantidad).toFixed(2),
          orden: i,
        };
      }),
    );

    await tx.insert(orderStatusHistory).values({
      orderId: pedido.id,
      estado: "pendiente",
      nota: "Pedido hecho desde la tienda",
      createdByUserId: sesion?.userId,
    });

    // A cuenta corriente, la deuda se registra al confirmar: es cuando se
    // entrega la mercadería, no cuando se cobra.
    if (datos.medioPago === "cuenta_corriente" && customerId) {
      await tx.insert(accountMovements).values({
        customerId,
        tipo: "compra",
        monto: total.toFixed(2),
        detalle: `Pedido ${numero}`,
        referencia: numero,
      });
    }

    await tx.delete(cartItems).where(eq(cartItems.cartId, carrito.id!));
    await tx
      .update(carts)
      .set({ activo: false, updatedAt: new Date() })
      .where(eq(carts.id, carrito.id!));
  });

  revalidatePath("/", "layout");
  revalidatePath("/admin/pedidos");

  // La redirección va acá y no en el cliente: apenas se vacía el carrito, la
  // página de checkout manda a /presupuesto por no tener ítems, y quien acaba de
  // comprar terminaba viendo un presupuesto vacío en lugar de su confirmación.
  redirect(`/pedido/${numero}`);
}
