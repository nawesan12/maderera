import { asc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import {
  categories,
  priceListItems,
  productVariants,
  products,
} from "@/lib/db/schema";
import { getSession } from "@/lib/dal/session";
import { listaVigente } from "@/lib/dal/precios-sesion";
import { obtenerConfiguracionFiscal } from "@/lib/fiscal/emitir";
import { pdfDeListaDePrecios } from "@/lib/pdf/lista-precios";

/**
 * La lista de precios del cliente, en PDF.
 *
 * El brief la pide entre la documentación descargable para profesionales:
 * "Listas de precios PDF". Un mayorista que quiere cotizar una obra necesita
 * la lista entera en un papel, no ir producto por producto por el catálogo.
 *
 * **Cada uno baja la suya.** La lista sale de `listaVigente()`, que es la
 * misma función que resuelve el precio del catálogo: quien tiene lista
 * profesional baja los precios profesionales y quien no, los de público. Es la
 * regla que evita el peor error de este módulo —una lista mayorista servida a
 * cualquiera—, y por eso se resuelve en el servidor y nunca desde un parámetro
 * de la URL.
 */
export async function GET() {
  // Exige sesión: sin esto la lista profesional quedaría a un link de
  // distancia de cualquiera que lo adivine.
  const sesion = await getSession();
  if (!sesion) {
    return new Response("Necesitás iniciar sesión.", { status: 401 });
  }

  const lista = await listaVigente();

  const propia = alias(priceListItems, "precio_propio");
  const general = alias(priceListItems, "precio_general");

  const filas = await db
    .select({
      sku: productVariants.sku,
      producto: products.name,
      medida: productVariants.label,
      categoria: categories.name,
      // El mismo respaldo que el catálogo: la lista propia manda y la general
      // cubre lo que esa lista no tenga cargado.
      precio: sql<string | null>`coalesce(${propia.price}, ${general.price})`,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .leftJoin(
      propia,
      lista.id
        ? sql`${propia.variantId} = ${productVariants.id} and ${propia.priceListId} = ${lista.id}`
        : sql`false`,
    )
    .leftJoin(
      general,
      lista.generalId
        ? sql`${general.variantId} = ${productVariants.id} and ${general.priceListId} = ${lista.generalId}`
        : sql`false`,
    )
    .where(sql`${products.active} and ${productVariants.active}`)
    .orderBy(asc(categories.sortOrder), asc(products.name), asc(productVariants.sortOrder));

  const emisor = await obtenerConfiguracionFiscal();

  const pdf = await pdfDeListaDePrecios({
    titulo: lista.esDiferenciada ? `Lista ${lista.nombre}` : "Lista de precios",
    emisor,
    leyendaIva: "Precios finales con IVA incluido",
    filas,
  });

  return new Response(pdf as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="lista-precios-mjbj-${new Date().toISOString().slice(0, 10)}.pdf"`,
      // Nunca cacheado: el precio depende de quién pregunta.
      "Cache-Control": "no-store, private",
    },
  });
}
