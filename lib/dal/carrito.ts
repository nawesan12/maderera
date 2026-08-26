import "server-only";

import { randomUUID } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { and, asc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import {
  cartItems,
  carts,
  priceListItems,
  productVariants,
  products,
  volumeDiscounts,
} from "@/lib/db/schema";
import { getSession } from "@/lib/dal/session";
import { listaVigente } from "@/lib/dal/precios-sesion";
import {
  descuentoPorVolumen,
  precioConDescuento,
  type EscalaDeVolumen,
} from "@/lib/precios/volumen";

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
  /** Descuento por volumen aplicado, en porcentaje. Cero si no corresponde. */
  descuento: number;
  /** Precio de lista antes del descuento por volumen, si hubo alguno. */
  precioSinDescuento: number | null;
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
  /** Cuánto se ahorró por los descuentos por volumen. */
  ahorroPorVolumen: number;
  /** Nombre de la lista aplicada, si no es la general. */
  listaDiferenciada: string | null;
}

const VACIO: Carrito = {
  id: null,
  items: [],
  cantidadItems: 0,
  subtotal: 0,
  conPrecioDesactualizado: 0,
  ahorroPorVolumen: 0,
  listaDiferenciada: null,
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

  const lista = await listaVigente();

  // Las escalas de volumen se traen una vez para todo el carrito: son pocas
  // filas y se evalúan en memoria, renglón por renglón.
  const escalas: EscalaDeVolumen[] = lista.id
    ? (
        await db
          .select({
            id: volumeDiscounts.id,
            variantId: volumeDiscounts.variantId,
            categoryId: volumeDiscounts.categoryId,
            desdeCantidad: volumeDiscounts.desdeCantidad,
            porcentaje: volumeDiscounts.porcentaje,
          })
          .from(volumeDiscounts)
          .where(
            and(
              eq(volumeDiscounts.priceListId, lista.id),
              eq(volumeDiscounts.activo, true),
            ),
          )
      ).map((e) => ({
        ...e,
        desdeCantidad: Number(e.desdeCantidad),
        porcentaje: Number(e.porcentaje),
      }))
    : [];

  const propia = alias(priceListItems, "precio_propio");
  const general = alias(priceListItems, "precio_general");

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
      categoryId: products.categoryId,
      // Mismo respaldo que el catálogo: la lista propia manda y la general
      // cubre lo que no tenga cargado. Si el carrito usara otra fuente que la
      // ficha de producto, el precio cambiaría al agregar al carrito.
      precioActual: sql<string | null>`coalesce(${propia.price}, ${general.price})`,
    })
    .from(cartItems)
    .leftJoin(productVariants, eq(productVariants.id, cartItems.variantId))
    .leftJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(
      propia,
      lista.id
        ? and(
            eq(propia.variantId, cartItems.variantId),
            eq(propia.priceListId, lista.id),
          )
        : sql`false`,
    )
    .leftJoin(
      general,
      lista.generalId
        ? and(
            eq(general.variantId, cartItems.variantId),
            eq(general.priceListId, lista.generalId),
          )
        : sql`false`,
    )
    .where(eq(cartItems.cartId, carrito.id))
    .orderBy(asc(cartItems.createdAt));

  let ahorroPorVolumen = 0;

  const items: ItemCarrito[] = filas.map((f) => {
    const cantidad = Number(f.cantidad);
    const precio = f.precioUnitario !== null ? Number(f.precioUnitario) : null;
    const deLista = f.precioActual !== null ? Number(f.precioActual) : null;

    // El descuento por volumen se calcula sobre el precio de lista vigente y no
    // sobre el que se guardó al agregar: la escala depende de la cantidad, que
    // cambia con los botones de más y menos.
    const descuento =
      deLista !== null
        ? descuentoPorVolumen(escalas, {
            variantId: f.variantId,
            categoryId: f.categoryId,
            cantidad,
          })
        : 0;

    const actual =
      deLista !== null ? precioConDescuento(deLista, descuento) : null;

    if (deLista !== null && descuento > 0) {
      ahorroPorVolumen += (deLista - (actual ?? deLista)) * cantidad;
    }

    return {
      id: f.id,
      variantId: f.variantId,
      descripcion: f.descripcion,
      unidad: f.unidad,
      cantidad,
      precioUnitario: precio,
      precioActual: actual,
      descuento,
      precioSinDescuento: descuento > 0 ? deLista : null,
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
    // Se compara contra el precio de lista, no contra el efectivo: un descuento
    // por volumen recién aplicado no es un cambio de precio, y avisarlo como
    // tal hacía que el aviso apareciera siempre para un profesional.
    conPrecioDesactualizado: items.filter((i) => {
      const deLista = i.precioSinDescuento ?? i.precioActual;
      return (
        i.precioUnitario !== null && deLista !== null && i.precioUnitario !== deLista
      );
    }).length,
    ahorroPorVolumen: Math.round(ahorroPorVolumen * 100) / 100,
    listaDiferenciada: lista.esDiferenciada ? lista.nombre : null,
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
