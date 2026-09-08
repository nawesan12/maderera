import "server-only";

import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  orderItems,
  orders,
  productReviews,
  productVariants,
  products,
} from "@/lib/db/schema";
import { clienteDeLaSesion } from "@/lib/dal/cuenta";

/**
 * Reseñas de producto, de compra verificada.
 *
 * La regla que define todo lo de acá: **solo reseña quien compró y recibió**.
 * Sin eso, la primera reseña falsa la escribe cualquiera con un navegador y la
 * segunda la escribe la competencia. Es la misma razón por la que los cuatro
 * testimonios inventados del prototipo están ocultos.
 */

export interface ResenaPublicada {
  id: string;
  nombre: string;
  estrellas: number;
  texto: string;
  fecha: Date;
}

export interface ResumenDeResenas {
  promedio: number;
  cantidad: number;
  /** Cuántas de cada cantidad de estrellas, de 1 a 5. */
  reparto: Record<number, number>;
}

/** Las reseñas publicadas de un producto, de la más nueva a la más vieja. */
export async function resenasDelProducto(
  productId: string,
): Promise<ResenaPublicada[]> {
  const filas = await db
    .select({
      id: productReviews.id,
      nombre: productReviews.nombre,
      estrellas: productReviews.estrellas,
      texto: productReviews.texto,
      fecha: productReviews.createdAt,
    })
    .from(productReviews)
    .where(
      and(
        eq(productReviews.productId, productId),
        eq(productReviews.estado, "publicada"),
      ),
    )
    .orderBy(desc(productReviews.createdAt))
    .limit(50);

  return filas;
}

/**
 * Promedio y reparto de estrellas de un producto.
 *
 * Se calcula sobre las publicadas nada más: una reseña pendiente todavía no
 * existe para el público, y contarla en el promedio la publicaría a medias.
 */
export async function resumenDeResenas(
  productId: string,
): Promise<ResumenDeResenas | null> {
  const filas = await db
    .select({
      estrellas: productReviews.estrellas,
      cuantas: count(),
    })
    .from(productReviews)
    .where(
      and(
        eq(productReviews.productId, productId),
        eq(productReviews.estado, "publicada"),
      ),
    )
    .groupBy(productReviews.estrellas);

  if (filas.length === 0) return null;

  const reparto: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let total = 0;
  let suma = 0;

  for (const f of filas) {
    reparto[f.estrellas] = Number(f.cuantas);
    total += Number(f.cuantas);
    suma += f.estrellas * Number(f.cuantas);
  }

  return {
    promedio: Math.round((suma / total) * 10) / 10,
    cantidad: total,
    reparto,
  };
}

export interface ProductoResenable {
  productId: string;
  slug: string;
  nombre: string;
  orderId: string;
  numeroPedido: string;
  /** Ya la escribió: se muestra para poder verla, no para volver a escribirla. */
  yaResenado: boolean;
}

/**
 * Qué puede reseñar quien está mirando.
 *
 * Un producto es reseñable si aparece en un pedido **entregado** del cliente de
 * la sesión. Se devuelven también los ya reseñados, marcados: la pantalla los
 * muestra en gris en vez de esconderlos, que es lo que evita el "yo había
 * escrito una reseña y desapareció".
 */
export async function productosQuePuedoResenar(): Promise<ProductoResenable[]> {
  const cliente = await clienteDeLaSesion();
  if (!cliente) return [];

  /*
   * `group by` y no `select distinct`.
   *
   * Un pedido puede traer varias medidas del mismo producto y hay que
   * ofrecerlo una sola vez para reseñar. Con `distinct` había que meter la
   * fecha en la lista de selección para poder ordenar por ella —Postgres lo
   * exige— y entonces dos filas con fechas distintas dejaban de ser la misma.
   * Agrupando, la fecha entra como `max()` y el orden sale bien.
   */
  const filas = await db
    .select({
      productId: products.id,
      slug: products.slug,
      nombre: products.name,
      orderId: orders.id,
      numeroPedido: orders.numero,
      cuando: sql<Date>`max(${orders.createdAt})`,
    })
    .from(orders)
    .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
    .innerJoin(productVariants, eq(productVariants.id, orderItems.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(
      and(
        eq(orders.customerId, cliente.id),
        eq(orders.estado, "entregado"),
        eq(products.active, true),
      ),
    )
    .groupBy(products.id, products.slug, products.name, orders.id, orders.numero)
    .orderBy(desc(sql`max(${orders.createdAt})`))
    .limit(100);

  if (filas.length === 0) return [];

  const yaEscritas = await db
    .select({
      orderId: productReviews.orderId,
      productId: productReviews.productId,
    })
    .from(productReviews)
    .where(
      and(
        eq(productReviews.customerId, cliente.id),
        inArray(
          productReviews.orderId,
          filas.map((f) => f.orderId),
        ),
      ),
    );

  const claves = new Set(
    yaEscritas.map((r) => `${r.orderId}:${r.productId}`),
  );

  return filas.map(({ cuando: _cuando, ...f }) => ({
    ...f,
    yaResenado: claves.has(`${f.orderId}:${f.productId}`),
  }));
}

/**
 * Si este cliente compró y recibió ese producto en ese pedido.
 *
 * Es la verificación que corre **en el servidor antes de guardar**. La pantalla
 * ya filtra qué se puede reseñar, pero el formulario manda ids y confiar en que
 * llegaron de la lista correcta es confiar en el navegador de otro.
 */
export async function puedeResenar(
  customerId: string,
  orderId: string,
  productId: string,
): Promise<boolean> {
  const [fila] = await db
    .select({ existe: sql<number>`1` })
    .from(orders)
    .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
    .innerJoin(productVariants, eq(productVariants.id, orderItems.variantId))
    .where(
      and(
        eq(orders.id, orderId),
        eq(orders.customerId, customerId),
        eq(orders.estado, "entregado"),
        eq(productVariants.productId, productId),
      ),
    )
    .limit(1);

  return Boolean(fila);
}
