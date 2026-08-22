import "server-only";

import { randomUUID } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  cartItems,
  carts,
  priceListItems,
  priceLists,
  productVariants,
  products,
} from "@/lib/db/schema";
import { getSession } from "@/lib/dal/session";

export const COOKIE_CARRITO = "mjbj_carrito";

export interface ItemCarrito {
  id: string;
  variantId: string | null;
  descripcion: string;
  unidad: string;
  cantidad: number;
  precioUnitario: number | null;
  /** Precio actual de lista, para avisar si cambió desde que se agregó. */
  precioActual: number | null;
  subtotal: number;
  origen: string;
  notas: string | null;
  slug: string | null;
  imagen: string | null;
}

export interface Carrito {
  id: string | null;
  items: ItemCarrito[];
  cantidadItems: number;
  subtotal: number;
  /** Ítems cuyo precio cambió desde que se agregaron al carrito. */
  conPrecioDesactualizado: number;
}

const VACIO: Carrito = {
  id: null,
  items: [],
  cantidadItems: 0,
  subtotal: 0,
  conPrecioDesactualizado: 0,
};

/**
 * Carrito de quien está navegando.
 *
 * Con sesión iniciada manda el `userId`, así el carrito sigue a la persona entre
 * dispositivos. Sin sesión se usa un token guardado en una cookie.
 *
 * Esta función NO crea el carrito: solo lee. Crearlo desde una lectura haría que
 * cada visita a una página deje una fila en la base, aunque nadie agregue nada.
 */
export const obtenerCarrito = cache(async (): Promise<Carrito> => {
  const sesion = await getSession();
  const token = (await cookies()).get(COOKIE_CARRITO)?.value;

  if (!sesion && !token) return VACIO;

  const [carrito] = await db
    .select({ id: carts.id })
    .from(carts)
    .where(
      and(
        eq(carts.activo, true),
        sesion ? eq(carts.userId, sesion.userId) : eq(carts.token, token!),
      ),
    )
    .limit(1);

  if (!carrito) return VACIO;

  const [listaGeneral] = await db
    .select({ id: priceLists.id })
    .from(priceLists)
    .where(eq(priceLists.isDefault, true))
    .limit(1);

  const filas = await db
    .select({
      id: cartItems.id,
      variantId: cartItems.variantId,
      descripcion: cartItems.descripcion,
      unidad: cartItems.unidad,
      cantidad: cartItems.cantidad,
      precioUnitario: cartItems.precioUnitario,
      origen: cartItems.origen,
      notas: cartItems.notas,
      slug: products.slug,
      precioActual: priceListItems.price,
    })
    .from(cartItems)
    .leftJoin(productVariants, eq(productVariants.id, cartItems.variantId))
    .leftJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(
      priceListItems,
      listaGeneral
        ? and(
            eq(priceListItems.variantId, cartItems.variantId),
            eq(priceListItems.priceListId, listaGeneral.id),
          )
        : eq(priceListItems.variantId, cartItems.variantId),
    )
    .where(eq(cartItems.cartId, carrito.id))
    .orderBy(asc(cartItems.createdAt));

  const items: ItemCarrito[] = filas.map((f) => {
    const cantidad = Number(f.cantidad);
    const precio = f.precioUnitario !== null ? Number(f.precioUnitario) : null;
    const actual = f.precioActual !== null ? Number(f.precioActual) : null;

    return {
      id: f.id,
      variantId: f.variantId,
      descripcion: f.descripcion,
      unidad: f.unidad,
      cantidad,
      precioUnitario: precio,
      precioActual: actual,
      subtotal: (actual ?? precio ?? 0) * cantidad,
      origen: f.origen,
      notas: f.notas,
      slug: f.slug,
      imagen: null,
    };
  });

  return {
    id: carrito.id,
    items,
    cantidadItems: items.length,
    subtotal: items.reduce((s, i) => s + i.subtotal, 0),
    conPrecioDesactualizado: items.filter(
      (i) =>
        i.precioUnitario !== null &&
        i.precioActual !== null &&
        i.precioUnitario !== i.precioActual,
    ).length,
  };
});

/**
 * Pasa el carrito armado sin sesión a la cuenta de quien acaba de entrar.
 *
 * Se llama desde las acciones de ingreso y de registro, y no desde
 * `obtenerCarrito()`, porque adoptar es una escritura: hacerlo durante una
 * lectura significaría tocar la base y la cookie en cada render.
 *
 * Sin esto, quien arma un presupuesto de treinta ítems sin sesión y después
 * inicia sesión ve el carrito vacío —`obtenerCarrito()` pasa a buscar por
 * `userId` y el carrito anónimo queda colgado del token—, y no lo recupera
 * hasta que agrega algo más.
 */
export async function adoptarCarritoAnonimo(userId: string): Promise<void> {
  const almacen = await cookies();
  const token = almacen.get(COOKIE_CARRITO)?.value;
  if (!token) return;

  const [anonimo] = await db
    .select({ id: carts.id })
    .from(carts)
    .where(and(eq(carts.token, token), eq(carts.activo, true)))
    .limit(1);

  if (!anonimo) return;

  const [propio] = await db
    .select({ id: carts.id })
    .from(carts)
    .where(and(eq(carts.userId, userId), eq(carts.activo, true)))
    .limit(1);

  if (!propio) {
    await db
      .update(carts)
      .set({ userId, updatedAt: new Date() })
      .where(eq(carts.id, anonimo.id));
  } else if (propio.id !== anonimo.id) {
    // Ya tenía un carrito de antes: se juntan los dos en lugar de que uno pise
    // al otro. Los ítems repetidos suman cantidad; los sueltos se mudan.
    await db.transaction(async (tx) => {
      const [entrantes, existentes] = await Promise.all([
        tx.select().from(cartItems).where(eq(cartItems.cartId, anonimo.id)),
        tx.select().from(cartItems).where(eq(cartItems.cartId, propio.id)),
      ]);

      for (const item of entrantes) {
        const repetido = item.variantId
          ? existentes.find((e) => e.variantId === item.variantId)
          : undefined;

        if (repetido) {
          await tx
            .update(cartItems)
            .set({
              cantidad: (
                Number(repetido.cantidad) + Number(item.cantidad)
              ).toFixed(2),
            })
            .where(eq(cartItems.id, repetido.id));
        } else {
          await tx
            .update(cartItems)
            .set({ cartId: propio.id })
            .where(eq(cartItems.id, item.id));
        }
      }

      await tx.delete(carts).where(eq(carts.id, anonimo.id));
    });
  }

  almacen.delete(COOKIE_CARRITO);
}

/**
 * Devuelve el carrito para escribir, creándolo si hace falta.
 *
 * Solo la llaman las acciones que agregan algo, para que navegar no genere
 * carritos vacíos.
 */
export async function obtenerOCrearCarrito(): Promise<string> {
  const sesion = await getSession();
  const almacen = await cookies();
  let token = almacen.get(COOKIE_CARRITO)?.value;

  if (sesion) {
    const [propio] = await db
      .select({ id: carts.id })
      .from(carts)
      .where(and(eq(carts.userId, sesion.userId), eq(carts.activo, true)))
      .limit(1);

    if (propio) return propio.id;

    // Si venía armando un carrito sin sesión, se le adopta al entrar en lugar
    // de perderlo.
    if (token) {
      const [anonimo] = await db
        .select({ id: carts.id })
        .from(carts)
        .where(and(eq(carts.token, token), eq(carts.activo, true)))
        .limit(1);

      if (anonimo) {
        await db
          .update(carts)
          .set({ userId: sesion.userId, updatedAt: new Date() })
          .where(eq(carts.id, anonimo.id));
        return anonimo.id;
      }
    }

    const [creado] = await db
      .insert(carts)
      .values({ token: randomUUID(), userId: sesion.userId })
      .returning({ id: carts.id });
    return creado.id;
  }

  if (token) {
    const [existente] = await db
      .select({ id: carts.id })
      .from(carts)
      .where(and(eq(carts.token, token), eq(carts.activo, true)))
      .limit(1);

    if (existente) return existente.id;
  }

  token = randomUUID();
  almacen.set(COOKIE_CARRITO, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 60, // dos meses: un presupuesto de obra se piensa
    secure: process.env.NODE_ENV === "production",
  });

  const [creado] = await db
    .insert(carts)
    .values({ token })
    .returning({ id: carts.id });

  return creado.id;
}
