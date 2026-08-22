"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { cartItems, priceListItems, priceLists } from "@/lib/db/schema";
import { obtenerOCrearCarrito } from "@/lib/dal/carrito";

export interface EstadoCarrito {
  error?: string;
  ok?: string;
}

function refrescar() {
  revalidatePath("/", "layout");
}

const agregarSchema = z.object({
  variantId: z.string().uuid().optional(),
  descripcion: z.string().trim().min(1).max(240),
  unidad: z.string().trim().max(40).default("unidad"),
  cantidad: z.coerce.number().positive().max(100000),
  origen: z.string().trim().max(40).default("catalogo"),
  notas: z.string().trim().max(300).optional(),
});

/**
 * Agrega algo al presupuesto en curso.
 *
 * Si la misma medida ya estaba, suma la cantidad en vez de repetir la línea: ver
 * dos veces el mismo producto obliga a sumar de cabeza para saber cuánto se está
 * pidiendo.
 */
export async function agregarAlCarrito(
  datos: z.input<typeof agregarSchema>,
): Promise<EstadoCarrito> {
  const parsed = agregarSchema.safeParse(datos);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "No se pudo agregar." };
  }

  const item = parsed.data;
  const cartId = await obtenerOCrearCarrito();

  // Precio de lista del momento, para poder avisar después si cambió.
  let precio: string | null = null;

  if (item.variantId) {
    const [fila] = await db
      .select({ price: priceListItems.price })
      .from(priceListItems)
      .innerJoin(priceLists, eq(priceLists.id, priceListItems.priceListId))
      .where(
        and(
          eq(priceListItems.variantId, item.variantId),
          eq(priceLists.isDefault, true),
        ),
      )
      .limit(1);

    precio = fila?.price ?? null;
  }

  if (item.variantId) {
    const [existente] = await db
      .select({ id: cartItems.id, cantidad: cartItems.cantidad })
      .from(cartItems)
      .where(
        and(
          eq(cartItems.cartId, cartId),
          eq(cartItems.variantId, item.variantId),
        ),
      )
      .limit(1);

    if (existente) {
      await db
        .update(cartItems)
        .set({
          cantidad: (Number(existente.cantidad) + item.cantidad).toFixed(2),
        })
        .where(eq(cartItems.id, existente.id));

      refrescar();
      return { ok: `Sumaste ${item.cantidad} a ${item.descripcion}.` };
    }
  }

  await db.insert(cartItems).values({
    cartId,
    variantId: item.variantId,
    descripcion: item.descripcion,
    unidad: item.unidad,
    cantidad: item.cantidad.toFixed(2),
    precioUnitario: precio,
    origen: item.origen,
    notas: item.notas,
  });

  refrescar();
  return { ok: `${item.descripcion} va al presupuesto.` };
}

/** Agrega varias líneas de una sola vez: la calculadora manda todo junto. */
export async function agregarVarios(
  items: z.input<typeof agregarSchema>[],
): Promise<EstadoCarrito> {
  if (items.length === 0) return { error: "No hay nada para agregar." };

  for (const item of items) {
    const resultado = await agregarAlCarrito(item);
    if (resultado.error) return resultado;
  }

  return { ok: `Se agregaron ${items.length} ítems al presupuesto.` };
}

/**
 * Las dos acciones de abajo filtran por `cartId` además de por el id de la
 * línea. El id es un uuid y adivinarlo es poco probable, pero "poco probable"
 * no es una autorización: sin esa condición, quien consiguiera un id podría
 * editar el presupuesto de otra persona.
 */
export async function cambiarCantidad(
  itemId: string,
  cantidad: number,
): Promise<EstadoCarrito> {
  if (!Number.isFinite(cantidad) || cantidad <= 0) {
    return quitarDelCarrito(itemId);
  }

  const cartId = await obtenerOCrearCarrito();

  await db
    .update(cartItems)
    .set({ cantidad: cantidad.toFixed(2) })
    .where(and(eq(cartItems.id, itemId), eq(cartItems.cartId, cartId)));

  refrescar();
  return {};
}

export async function quitarDelCarrito(itemId: string): Promise<EstadoCarrito> {
  const cartId = await obtenerOCrearCarrito();

  await db
    .delete(cartItems)
    .where(and(eq(cartItems.id, itemId), eq(cartItems.cartId, cartId)));

  refrescar();
  return { ok: "Lo sacamos del presupuesto." };
}

export async function vaciarCarrito(): Promise<EstadoCarrito> {
  const cartId = await obtenerOCrearCarrito();
  await db.delete(cartItems).where(eq(cartItems.cartId, cartId));
  refrescar();
  return { ok: "Presupuesto vaciado." };
}

/** Pone las líneas al precio de lista de hoy. */
export async function actualizarPrecios(): Promise<EstadoCarrito> {
  const cartId = await obtenerOCrearCarrito();

  const [listaGeneral] = await db
    .select({ id: priceLists.id })
    .from(priceLists)
    .where(eq(priceLists.isDefault, true))
    .limit(1);

  if (!listaGeneral) return { error: "No hay lista de precios configurada." };

  const items = await db
    .select({
      id: cartItems.id,
      precio: priceListItems.price,
    })
    .from(cartItems)
    .leftJoin(
      priceListItems,
      and(
        eq(priceListItems.variantId, cartItems.variantId),
        eq(priceListItems.priceListId, listaGeneral.id),
      ),
    )
    .where(eq(cartItems.cartId, cartId));

  let actualizados = 0;

  for (const item of items) {
    if (!item.precio) continue;
    await db
      .update(cartItems)
      .set({ precioUnitario: item.precio })
      .where(eq(cartItems.id, item.id));
    actualizados++;
  }

  refrescar();
  return { ok: `Se actualizaron ${actualizados} precios.` };
}
