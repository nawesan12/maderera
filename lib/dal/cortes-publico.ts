import "server-only";

import { cache } from "react";
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import {
  categories,
  priceListItems,
  productVariants,
  products,
} from "@/lib/db/schema";
import { cachearPublico, ETIQUETAS } from "@/lib/cache-publico";
import {
  listaGeneral,
  listaVigente,
  type ListaVigente,
} from "@/lib/dal/precios-sesion";
import { tarifasDeCorte } from "@/lib/dal/cortes-tarifas";
import { tarifaDeCorte } from "@/lib/cortes/tarifa";

/**
 * Las placas que se pueden mandar a cortar desde el sitio.
 *
 * **Qué entra.** Solo las variantes que tienen las dos medidas cargadas: sin
 * largo y ancho no hay plano, y un plano sobre una medida supuesta no sirve
 * para cobrar. Eso deja afuera la ferretería y la madera bruta, que es
 * exactamente lo que corresponde.
 *
 * **El precio es el de quien mira**, con una vuelta. La pantalla se sirve a
 * precio de público —así se puede cachear, ver `placasCortablesPublicas`— y el
 * navegador reemplaza el de quien tiene lista propia con lo que le devuelve
 * `/api/mis-placas`. Lo que se cobra no sale de ninguno de los dos: al agregar
 * el corte al carrito el servidor vuelve a buscar la placa con la lista real.
 *
 * Cada placa viaja con su tarifa de corte ya resuelta —la pasada y el metro de
 * tapacanto—, porque la tarifa depende de la familia del producto y de la lista,
 * y eso no lo puede resolver el navegador.
 */
export interface PlacaCortable {
  variantId: string;
  descripcion: string;
  largoMm: number;
  anchoMm: number;
  color: string | null;
  /** Precio final de la placa entera, con IVA, en la lista de quien mira. */
  precio: number;
  precioPorPasada: number;
  precioPorMetroCanto: number;
}

const consultarPlacas = async (
  lista: Pick<ListaVigente, "id" | "generalId" | "factorDerivado">,
): Promise<PlacaCortable[]> => {
  const tarifas = await tarifasDeCorte();

  const propia = alias(priceListItems, "precio_propio");
  const general = alias(priceListItems, "precio_general");

  const filas = await db
    .select({
      variantId: productVariants.id,
      producto: products.name,
      medida: productVariants.label,
      largoMm: productVariants.largoMm,
      anchoMm: productVariants.anchoMm,
      color: productVariants.color,
      categoria: categories.name,
      precio: sql<string | null>`coalesce(${propia.price}, round((${general.price} * ${lista.factorDerivado})::numeric, 2))`,
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
    .where(
      and(
        eq(products.active, true),
        eq(productVariants.active, true),
        isNotNull(productVariants.largoMm),
        isNotNull(productVariants.anchoMm),
      ),
    )
    .orderBy(asc(products.name), asc(productVariants.sortOrder));

  return filas
    .filter((f) => Number(f.precio ?? 0) > 0)
    .map((f) => {
      const tarifa = tarifaDeCorte(
        tarifas,
        [f.categoria ?? "", f.producto],
        lista.id,
      );

      return {
        variantId: f.variantId,
        descripcion: `${f.producto} — ${f.medida}`,
        largoMm: f.largoMm!,
        anchoMm: f.anchoMm!,
        color: f.color,
        precio: Number(f.precio ?? 0),
        precioPorPasada: tarifa?.precioPorPasada ?? 0,
        precioPorMetroCanto: tarifa?.precioPorMetroCanto ?? 0,
      };
    })
    // Sin tarifa de pasada no se puede cobrar el corte, y ofrecerlo sería
    // prometer un precio que el mostrador después no puede sostener.
    .filter((p) => p.precioPorPasada > 0);
};

/**
 * La lista de placas, cacheada **por lista de precios**.
 *
 * Es la misma regla del catálogo: lo que se comparte es el resultado *para una
 * lista determinada*, y la lista viaja en la clave, así que la entrada de un
 * profesional no se le puede servir a otro ni al público.
 *
 * Antes se resolvía de cero en cada visita: la consulta recorre todas las
 * variantes con medida cargada del catálogo y les busca el precio en dos
 * listas. Eso se pagaba cada vez que alguien abría el armador de cortes, y la
 * respuesta solo cambia cuando cambia un precio.
 */
const placasCacheadas = cachearPublico(
  consultarPlacas,
  ["cortes", "placas"],
  ETIQUETAS.catalogo,
);

/** Las placas con el precio de la lista de quien pide. */
export const placasCortables = cache(async (): Promise<PlacaCortable[]> => {
  const lista = await listaVigente();
  return placasCacheadas({
    id: lista.id,
    generalId: lista.generalId,
    factorDerivado: lista.factorDerivado,
  });
});

/**
 * Las placas **a precio de público**, las mismas para todo el que entre.
 *
 * Es lo que permite que el armador de cortes se sirva de la caché en lugar de
 * armarse en cada visita. Al profesional no se le esconde su precio: la
 * pantalla se lo corrige en el navegador con `/api/mis-placas`.
 */
export const placasCortablesPublicas = cache(
  async (): Promise<PlacaCortable[]> => {
    const general = await listaGeneral();
    const id = general?.id ?? null;
    return placasCacheadas({ id, generalId: id, factorDerivado: 1 });
  },
);

/**
 * Una placa concreta, para revalidar en el servidor lo que mandó el navegador.
 *
 * El precio que se cobra **nunca** es el que viajó en el formulario: se vuelve a
 * buscar acá con la lista de quien está comprando.
 */
export async function placaCortable(
  variantId: string,
): Promise<PlacaCortable | null> {
  const placas = await placasCortables();
  return placas.find((p) => p.variantId === variantId) ?? null;
}
