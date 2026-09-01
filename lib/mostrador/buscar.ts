import "server-only";

import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import {
  categories,
  customers,
  inventory,
  priceListItems,
  priceLists,
  productVariants,
  products,
} from "@/lib/db/schema";
import { coincideBusqueda } from "@/lib/busqueda";

/**
 * La búsqueda del mostrador.
 *
 * Es distinta de la del catálogo y por eso vive aparte. Ahí se navega: se mira,
 * se compara, se filtra. Acá hay alguien esperando del otro lado del mostrador
 * y lo que se busca es **una medida concreta para ponerla en la venta**. Así
 * que devuelve variantes y no productos —lo que se cobra es "Fenólico 18mm
 * 1.22x2.44", no "Fenólico"—, con su precio y lo que hay en esta sucursal.
 *
 * El tope es corto a propósito: una lista larga en el mostrador no se lee, se
 * vuelve a tipear.
 */

const TOPE = 12;

export interface ResultadoDeMostrador {
  variantId: string;
  sku: string;
  producto: string;
  medida: string;
  unidad: string;
  precio: number;
  /** Lo que hay en la sucursal donde se está vendiendo. */
  stock: number;
}

/**
 * La lista de precios que corresponde aplicarle a un cliente.
 *
 * Sin cliente —consumidor final— es la general. Con cliente, la suya si tiene
 * una asignada. Es la misma regla que el sitio, pero resuelta desde el cliente
 * elegido en pantalla y no desde la sesión: en el mostrador quien tiene la
 * sesión es quien atiende, no quien compra.
 */
export async function listaDelCliente(
  customerId: string | null,
): Promise<{ id: string | null; generalId: string | null }> {
  const [general] = await db
    .select({ id: priceLists.id })
    .from(priceLists)
    .where(and(eq(priceLists.isDefault, true), eq(priceLists.active, true)))
    .limit(1);

  const generalId = general?.id ?? null;

  if (!customerId) return { id: generalId, generalId };

  const [cliente] = await db
    .select({ priceListId: customers.priceListId })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);

  return { id: cliente?.priceListId ?? generalId, generalId };
}

export async function buscarParaMostrador(
  texto: string,
  branchId: string,
  customerId: string | null = null,
): Promise<ResultadoDeMostrador[]> {
  const consulta = texto.trim();
  if (consulta.length < 2) return [];

  const lista = await listaDelCliente(customerId);

  const propia = alias(priceListItems, "precio_propio");
  const general = alias(priceListItems, "precio_general");

  // El SKU se compara aparte y por igualdad o prefijo: quien tipea un código
  // completo quiere esa fila y ninguna otra, y la búsqueda difusa la mandaría
  // al fondo entre veinte parecidas.
  const porTexto = coincideBusqueda(consulta, [
    products.name,
    productVariants.label,
    products.brand,
    categories.name,
  ]);

  const condiciones = [
    eq(productVariants.active, true),
    eq(products.active, true),
  ];

  const porSku = or(
    eq(productVariants.sku, consulta),
    sql`${productVariants.sku} ilike ${consulta + "%"}`,
  );

  const coincidencia = porTexto ? or(porSku, porTexto) : porSku;
  if (coincidencia) condiciones.push(coincidencia);

  const filas = await db
    .select({
      variantId: productVariants.id,
      sku: productVariants.sku,
      producto: products.name,
      medida: productVariants.label,
      unidad: products.unit,
      precio: sql<string | null>`coalesce(${propia.price}, ${general.price})`,
      stock: sql<number>`coalesce(${inventory.qty}, 0)`,
      // Lo que coincide por código va primero: es lo más específico que alguien
      // puede tipear.
      exacto: sql<number>`case when ${productVariants.sku} ilike ${consulta + "%"} then 0 else 1 end`,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .leftJoin(
      propia,
      lista.id
        ? and(
            eq(propia.variantId, productVariants.id),
            eq(propia.priceListId, lista.id),
          )
        : sql`false`,
    )
    .leftJoin(
      general,
      lista.generalId
        ? and(
            eq(general.variantId, productVariants.id),
            eq(general.priceListId, lista.generalId),
          )
        : sql`false`,
    )
    .leftJoin(
      inventory,
      and(
        eq(inventory.variantId, productVariants.id),
        eq(inventory.branchId, branchId),
      ),
    )
    .where(and(...condiciones))
    .orderBy(
      asc(sql`case when ${productVariants.sku} ilike ${consulta + "%"} then 0 else 1 end`),
      asc(products.name),
      asc(productVariants.sortOrder),
    )
    .limit(TOPE);

  return filas.map((f) => ({
    variantId: f.variantId,
    sku: f.sku,
    producto: f.producto,
    medida: f.medida,
    unidad: f.unidad,
    precio: Number(f.precio ?? 0),
    stock: Number(f.stock),
  }));
}

/** Búsqueda de clientes para el mostrador: nombre, razón social o CUIT. */
export async function buscarClienteEnMostrador(texto: string) {
  const consulta = texto.trim();
  if (consulta.length < 2) return [];

  const coincidencia = coincideBusqueda(consulta, [
    customers.nombre,
    customers.razonSocial,
    customers.cuit,
  ]);

  return db
    .select({
      id: customers.id,
      nombre: customers.nombre,
      razonSocial: customers.razonSocial,
      cuit: customers.cuit,
      condicionIva: customers.condicionIva,
      estado: customers.estado,
      limiteCredito: customers.limiteCredito,
    })
    .from(customers)
    .where(
      coincidencia
        ? and(eq(customers.active, true), coincidencia)
        : eq(customers.active, true),
    )
    .orderBy(asc(customers.nombre))
    .limit(8);
}

/**
 * Los precios de un puñado de variantes para un cliente dado.
 *
 * Existe por un caso muy del mostrador: se cargan los ítems y **después** se
 * identifica al cliente, que resulta ser profesional y tiene otra lista. Sin
 * esto la venta se cobraba a precio de mostrador y la diferencia la descubría
 * el cliente, que es la peor manera de descubrirla.
 *
 * Devuelve un mapa de variante a precio. Lo que se hace con eso lo decide la
 * pantalla: los precios que quien atiende tocó a mano no se pisan solos.
 */
export async function preciosPara(
  variantIds: string[],
  customerId: string | null,
): Promise<Record<string, number>> {
  if (variantIds.length === 0) return {};

  const lista = await listaDelCliente(customerId);
  const propia = alias(priceListItems, "precio_propio_relista");
  const general = alias(priceListItems, "precio_general_relista");

  const filas = await db
    .select({
      variantId: productVariants.id,
      precio: sql<string | null>`coalesce(${propia.price}, ${general.price})`,
    })
    .from(productVariants)
    .leftJoin(
      propia,
      lista.id
        ? and(
            eq(propia.variantId, productVariants.id),
            eq(propia.priceListId, lista.id),
          )
        : sql`false`,
    )
    .leftJoin(
      general,
      lista.generalId
        ? and(
            eq(general.variantId, productVariants.id),
            eq(general.priceListId, lista.generalId),
          )
        : sql`false`,
    )
    .where(inArray(productVariants.id, variantIds));

  return Object.fromEntries(
    filas.map((f) => [f.variantId, Number(f.precio ?? 0)]),
  );
}
