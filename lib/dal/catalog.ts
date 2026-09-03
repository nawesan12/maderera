import { cache } from "react";
import "server-only";

import { cachearPublico, ETIQUETAS } from "@/lib/cache-publico";

import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { coincideBusqueda } from "@/lib/busqueda";
import { db } from "@/lib/db";
import {
  branches,
  categories,
  inventory,
  priceListItems,
  productImages,
  productVariants,
  products,
  relatedProducts,
} from "@/lib/db/schema";
import { listaVigente, type ListaVigente } from "@/lib/dal/precios-sesion";
import {
  combinedStockLevel,
  disponible,
  stockLevel,
  type StockLevel,
} from "@/lib/stock-level";

/**
 * Consultas del catálogo público.
 *
 * Todo lo de acá es información abierta: lo mismo que ve cualquiera que entre al
 * sitio. Los precios que devuelve son siempre los de la lista general; los precios
 * de profesional NO salen por estas funciones, para que ningún cambio futuro los
 * filtre sin querer a una página pública.
 *
 * Por ahora se consulta en cada request. Son candidatas naturales a `use cache` con
 * `cacheTag("catalogo")`, pero eso exige activar `cacheComponents` en la config, lo
 * que cambia el modelo de renderizado de todo el sitio: se decide al cerrar la
 * tienda online, no antes.
 */

export interface ProductoListado {
  id: string;
  slug: string;
  name: string;
  description: string;
  subcategory: string | null;
  brand: string | null;
  unit: string;
  featured: boolean;
  categorySlug: string;
  categoryName: string;
  image: string | null;
  /** Precio más bajo entre las variantes, para el "desde $…". */
  precioDesde: string | null;
  /** Precio anterior, si el producto está en oferta. */
  precioAnterior: string | null;
  /** Descuento en porcentaje, ya redondeado. */
  descuento: number | null;
  labels: string[];
  stockCentral: StockLevel;
  stockAserradero: StockLevel;
  hayStock: boolean;
}

export type OrdenCatalogo =
  | "relevancia"
  | "precio-asc"
  | "precio-desc"
  | "nombre";

export interface FiltrosCatalogo {
  categoria?: string;
  busqueda?: string;
  stock?: "todos" | "en-stock" | "casa-central" | "aserradero";
  orden?: OrdenCatalogo;
  /** Solo los que están en oferta. */
  soloOfertas?: boolean;
  /**
   * Un conjunto puntual de productos, por id.
   *
   * Lo usan los sugeridos: el vendedor eligió cuáles van, así que no hay filtro
   * que los describa. Se resuelven por acá y no con una consulta propia para que
   * la tarjeta traiga el mismo precio, la misma oferta y el mismo stock que en
   * el resto del catálogo.
   */
  ids?: string[];
}

/**
 * Los productos en oferta, memoizados.
 *
 * El catálogo arma el panel de filtros dos veces —el cajón del teléfono y la
 * columna del escritorio— y las dos necesitan cuántas ofertas hay. Sin esto son
 * seis consultas por carga para el mismo número.
 *
 * Va como función sin argumentos y no como `listarProductos({ soloOfertas })`
 * memoizada, porque `cache()` compara los argumentos por referencia y un objeto
 * literal nuevo en cada llamada nunca acierta.
 *
 * **Es la lista y no un `count`** a propósito: "en oferta" no es que exista una
 * variante rebajada, es que la rebaja esté en la variante más barata, y encima
 * el precio depende de la lista de la sesión. Un conteo por SQL daría un número
 * distinto del que después muestra la grilla.
 */
export const productosEnOferta = cache(() =>
  listarProductos({ soloOfertas: true }),
);

/** Categorías con la cantidad real de productos activos. */
/*
 * Memoizada: el catálogo arma el panel de filtros dos veces —una para el cajón
 * del teléfono y otra para la columna del escritorio— y las dos piden las
 * categorías.
 */
export const listarCategorias = cache(
  cachearPublico(
    async () => {
      return db
        .select({
          id: categories.id,
          slug: categories.slug,
          name: categories.name,
          description: categories.description,
          icon: categories.icon,
          image: categories.image,
          // El prototipo tenía este número escrito a mano y desactualizado.
          productCount: count(products.id),
        })
        .from(categories)
        .leftJoin(
          products,
          and(eq(products.categoryId, categories.id), eq(products.active, true)),
        )
        .where(eq(categories.active, true))
        .groupBy(categories.id)
        .orderBy(asc(categories.sortOrder));
    },
    ["categorias"],
    ETIQUETAS.catalogo,
  ),
);

/**
 * Trae el catálogo ya filtrado desde la base.
 *
 * El prototipo mandaba el array completo al navegador y filtraba ahí. Con más de
 * doscientos productos y varias variantes cada uno eso es un bundle enorme y una
 * fuga de datos: el visitante recibía el catálogo entero aunque mirara una sola
 * categoría.
 */
async function consultarProductos(
  filtros: FiltrosCatalogo,
  lista: Pick<ListaVigente, "id" | "generalId">,
): Promise<ProductoListado[]> {
  const condiciones = [eq(products.active, true)];

  if (filtros.ids) {
    // Sin esto, un array vacío se traduce a `in ()` y devolvería el catálogo
    // entero en vez de nada.
    if (filtros.ids.length === 0) return [];
    condiciones.push(inArray(products.id, filtros.ids));
  }

  if (filtros.categoria && filtros.categoria !== "todos") {
    condiciones.push(eq(categories.slug, filtros.categoria));
  }

  if (filtros.busqueda) {
    const coincidencia = coincideBusqueda(filtros.busqueda, [
      products.name,
      products.description,
      products.subcategory,
      products.brand,
      categories.name,
    ]);
    if (coincidencia) condiciones.push(coincidencia);
  }

  const filas = await db
    .select({
      id: products.id,
      slug: products.slug,
      name: products.name,
      description: products.description,
      subcategory: products.subcategory,
      brand: products.brand,
      unit: products.unit,
      featured: products.featured,
      categorySlug: categories.slug,
      categoryName: categories.name,
    })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .where(and(...condiciones))
    .orderBy(asc(categories.sortOrder), asc(products.name));

  if (filas.length === 0) return [];

  const ids = filas.map((f) => f.id);
  const [imagenes, variantes] = await Promise.all([
    db
      .select({ productId: productImages.productId, url: productImages.url })
      .from(productImages)
      .where(inArray(productImages.productId, ids))
      .orderBy(asc(productImages.sortOrder)),
    variantesConStockYPrecio(ids, lista),
  ]);

  const primeraImagen = new Map<string, string>();
  for (const img of imagenes) {
    if (!primeraImagen.has(img.productId)) {
      primeraImagen.set(img.productId, img.url);
    }
  }

  const listado = filas.map((fila) => {
    const propias = variantes.filter((v) => v.productId === fila.id);
    const conPrecio = propias
      .map((v) => ({
        precio: Number(v.precio ?? 0),
        anterior: v.precioAnterior !== null ? Number(v.precioAnterior) : null,
      }))
      .filter((p) => p.precio > 0);

    // El "desde" es la variante más barata, y la oferta que se muestra es la de
    // esa misma variante: mezclar el precio de una con el descuento de otra
    // anunciaría una rebaja que no existe.
    const masBarata =
      conPrecio.length > 0
        ? conPrecio.reduce((a, b) => (b.precio < a.precio ? b : a))
        : null;

    const enOferta =
      masBarata?.anterior != null && masBarata.anterior > masBarata.precio;

    const stockCentral = combinedStockLevel(propias.map((v) => v.stockCentral));
    const stockAserradero = combinedStockLevel(
      propias.map((v) => v.stockAserradero),
    );

    return {
      ...fila,
      image: primeraImagen.get(fila.id) ?? null,
      precioDesde: masBarata ? String(masBarata.precio) : null,
      precioAnterior: enOferta ? String(masBarata.anterior) : null,
      descuento: enOferta
        ? Math.round((1 - masBarata.precio / masBarata.anterior!) * 100)
        : null,
      labels: propias.map((v) => v.label),
      stockCentral,
      stockAserradero,
      hayStock:
        stockCentral !== "sin-stock" || stockAserradero !== "sin-stock",
    };
  });

  const filtroStock = filtros.stock ?? "todos";

  let resultado = listado;

  if (filtroStock !== "todos") {
    resultado = resultado.filter((p) => {
      if (filtroStock === "casa-central") return p.stockCentral !== "sin-stock";
      if (filtroStock === "aserradero") return p.stockAserradero !== "sin-stock";
      return p.hayStock;
    });
  }

  if (filtros.soloOfertas) {
    resultado = resultado.filter((p) => p.descuento !== null);
  }

  return ordenar(resultado, filtros.orden ?? "relevancia");
}

/**
 * El catálogo, cacheado **por lista de precios**.
 *
 * La regla de `precios-sesion.ts` es que un precio profesional no puede salir
 * de un caché compartido, y sigue en pie: lo que se comparte acá es el
 * resultado *para una lista determinada*, y la lista viaja en los argumentos,
 * así que forma parte de la clave. Dos visitantes con la misma lista ven lo
 * mismo porque **es** lo mismo; a uno con lista propia no se le puede servir la
 * entrada de otro, porque su clave es otra.
 *
 * Lo que se resuelve fuera del caché, en cada pedido, es *qué lista le toca a
 * quien mira*: eso sí depende de la sesión y por eso `listaVigente()` queda del
 * lado de afuera.
 *
 * Lo que esto evita: el catálogo entero —productos, imágenes, variantes,
 * precios y stock, tres consultas— se rehacía en cada visita a la portada y a
 * cada página del catálogo, aunque nadie hubiera tocado un precio en semanas.
 */
const productosCacheados = cachearPublico(
  consultarProductos,
  ["catalogo", "productos"],
  ETIQUETAS.catalogo,
);

/**
 * Trae el catálogo ya filtrado.
 *
 * El prototipo mandaba el array completo al navegador y filtraba ahí. Con más
 * de doscientos productos y varias variantes cada uno eso es un bundle enorme y
 * una fuga de datos: el visitante recibía el catálogo entero aunque mirara una
 * sola categoría.
 */
export async function listarProductos(
  filtros: FiltrosCatalogo = {},
): Promise<ProductoListado[]> {
  const lista = await listaVigente();
  return productosCacheados(filtros, {
    id: lista.id,
    generalId: lista.generalId,
  });
}

/** Cuántos productos entran en una página del catálogo. */
export const POR_PAGINA = 24;

/**
 * Cuántas páginas de "ver más" se pueden acumular en una sola respuesta.
 *
 * Cinco son 120 productos, del orden de 745 KB de HTML medidos. Más que eso no
 * lo lee nadie de corrido: a esa altura se busca o se filtra.
 */
export const TOPE_PAGINAS = 5;

/**
 * Una página del catálogo, con el total para poder decir "viste N de M".
 *
 * **El recorte es acá y no en la consulta**, y eso es a propósito. Tres de los
 * filtros —disponibilidad, ofertas y el orden por precio— dependen de datos que
 * se arman después de traer las filas: el stock combinado de las dos
 * sucursales, y sobre todo el precio, que sale de la lista de la sesión y
 * decide si un producto está en oferta. Un `limit` en SQL cortaría antes de que
 * eso exista y devolvería páginas de tamaño equivocado, o peor, productos que
 * el filtro después descarta.
 *
 * Lo que esto resuelve es lo que se medió: con 312 productos la grilla completa
 * son del orden de 1,6 MB de HTML por carga. La base sigue leyendo el conjunto
 * filtrado entero, que con este catálogo es barato. Si algún día son varios
 * miles, el trabajo es mover el precio de lista y la regla de oferta a la
 * consulta, y recién ahí paginar en SQL.
 *
 * **El tope no es decorativo.** Como "ver más" acumula, el número de página
 * viene de la URL y nadie lo estaba acotando, cualquiera podía escribir
 * `?pagina=9999` y hacer que el servidor armara el catálogo entero en una sola
 * respuesta. Medido con 2025 productos: 250 KB en la primera página, 2,5 MB en
 * la veinte, **10,4 MB con `pagina=9999`**. En un celular eso no es lento, es
 * inusable. Con el tope, el techo de una respuesta queda en `TOPE_PAGINAS`
 * páginas y de ahí en más la pantalla invita a filtrar, que es como se busca en
 * un catálogo de ese tamaño.
 */
export async function paginaDeProductos(
  filtros: FiltrosCatalogo = {},
  pagina = 1,
): Promise<{
  productos: ProductoListado[];
  total: number;
  hayMas: boolean;
  topeAlcanzado: boolean;
}> {
  const todos = await listarProductos(filtros);
  const pedida = Math.max(1, Math.floor(pagina) || 1);
  const acotada = Math.min(pedida, TOPE_PAGINAS);
  const hasta = acotada * POR_PAGINA;
  const quedanAfuera = todos.length > hasta;

  return {
    productos: todos.slice(0, hasta),
    total: todos.length,
    // Hay más para ver *y* todavía se puede pedir otra página.
    hayMas: quedanAfuera && acotada < TOPE_PAGINAS,
    // Se llegó al techo y aun así quedó catálogo sin mostrar.
    topeAlcanzado: quedanAfuera && acotada >= TOPE_PAGINAS,
  };
}

/**
 * Ordena el listado.
 *
 * Por defecto manda la relevancia comercial: primero lo que está en oferta,
 * después lo destacado y al final lo que no tiene stock, porque mostrar arriba
 * algo que no se puede comprar es la forma más rápida de que alguien se vaya.
 */
function ordenar(
  productos: ProductoListado[],
  orden: OrdenCatalogo,
): ProductoListado[] {
  const lista = [...productos];

  if (orden === "precio-asc" || orden === "precio-desc") {
    const signo = orden === "precio-asc" ? 1 : -1;
    return lista.sort((a, b) => {
      // Lo que no tiene precio va al final en los dos sentidos.
      if (a.precioDesde === null) return 1;
      if (b.precioDesde === null) return -1;
      return (Number(a.precioDesde) - Number(b.precioDesde)) * signo;
    });
  }

  if (orden === "nombre") {
    return lista.sort((a, b) => a.name.localeCompare(b.name, "es"));
  }

  return lista.sort((a, b) => {
    if (a.hayStock !== b.hayStock) return a.hayStock ? -1 : 1;
    if ((a.descuento !== null) !== (b.descuento !== null)) {
      return a.descuento !== null ? -1 : 1;
    }
    if (a.featured !== b.featured) return a.featured ? -1 : 1;
    return a.name.localeCompare(b.name, "es");
  });
}

/**
 * Variantes con su precio y su stock por sucursal.
 *
 * La lista se filtra en el join y no con un LEFT JOIN abierto contra
 * `price_lists`: sin el filtro, las filas de la lista profesional entran con su
 * precio y terminan pisando al público. Es un error que no se ve —la página
 * muestra un número plausible— pero publica el precio mayorista.
 *
 * El precio sale de la lista que corresponde a quien está mirando —general para
 * el público, la propia para un profesional aprobado— y **cae a la general
 * cuando la lista alternativa no tiene ese producto cargado**. Sin ese respaldo,
 * un profesional vería medio catálogo sin precio, que es peor que verlo al
 * precio de público.
 */
async function variantesConStockYPrecio(
  productIds: string[],
  lista: Pick<ListaVigente, "id" | "generalId">,
) {

  // Dos joins con alias: uno a la lista vigente y otro a la general. Traer las
  // dos filas en la misma consulta es lo que permite el respaldo sin una
  // segunda vuelta a la base por cada producto sin precio propio.
  const propia = alias(priceListItems, "precio_propio");
  const general = alias(priceListItems, "precio_general");

  const filas = await db
    .select({
      productId: productVariants.productId,
      variantId: productVariants.id,
      label: productVariants.label,
      sortOrder: productVariants.sortOrder,
      precio: sql<string | null>`coalesce(${propia.price}, ${general.price})`,
      precioAnterior: sql<string | null>`coalesce(${propia.precioAnterior}, ${general.precioAnterior})`,
      // `sql<string>` y no `Date`: Drizzle solo convierte a Date las columnas
      // que se seleccionan directo, no las que salen de una expresión. Tiparlo
      // como Date compila y explota en tiempo de ejecución al llamar getTime().
      ofertaHasta: sql<string | null>`coalesce(${propia.ofertaHasta}, ${general.ofertaHasta})`,
      branchSlug: branches.slug,
      qty: inventory.qty,
      reservado: inventory.reservado,
      minQty: inventory.minQty,
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
    .leftJoin(inventory, eq(inventory.variantId, productVariants.id))
    .leftJoin(branches, eq(branches.id, inventory.branchId))
    .where(
      and(
        inArray(productVariants.productId, productIds),
        eq(productVariants.active, true),
      ),
    )
    .orderBy(asc(productVariants.sortOrder));

  // Una variante aparece una vez por sucursal; se colapsan en un registro.
  const ahora = Date.now();

  const porVariante = new Map<
    string,
    {
      productId: string;
      label: string;
      precio: string | null;
      precioAnterior: string | null;
      stockCentral: StockLevel;
      stockAserradero: StockLevel;
    }
  >();

  for (const fila of filas) {
    const actual = porVariante.get(fila.variantId) ?? {
      productId: fila.productId,
      label: fila.label,
      precio: fila.precio,
      precioAnterior: null as string | null,
      stockCentral: "sin-stock" as StockLevel,
      stockAserradero: "sin-stock" as StockLevel,
    };

    if (fila.precio !== null) actual.precio = fila.precio;

    // La oferta vale solo si no venció: una promoción que quedó cargada de un
    // mes atrás no puede seguir mostrando un tachado.
    const vigente =
      fila.ofertaHasta === null ||
      new Date(fila.ofertaHasta).getTime() > ahora;

    if (fila.precioAnterior !== null && vigente) {
      actual.precioAnterior = fila.precioAnterior;
    }

    if (fila.branchSlug && fila.qty !== null && fila.minQty !== null) {
      // Disponible, no físico: lo comprometido en pedidos sin retirar no se
      // puede volver a vender.
      const nivel = stockLevel(
        disponible(fila.qty, fila.reservado ?? 0),
        fila.minQty,
      );
      if (fila.branchSlug === "casa-central") actual.stockCentral = nivel;
      if (fila.branchSlug === "aserradero") actual.stockAserradero = nivel;
    }

    porVariante.set(fila.variantId, actual);
  }

  return [...porVariante.values()];
}

export interface VarianteDetalle {
  id: string;
  sku: string;
  label: string;
  material: string | null;
  color: string | null;
  largoMm: number | null;
  anchoMm: number | null;
  espesorMm: number | null;
  precio: string | null;
  stockCentral: StockLevel;
  stockAserradero: StockLevel;
}

export interface ProductoDetalle {
  id: string;
  slug: string;
  name: string;
  description: string;
  subcategory: string | null;
  brand: string | null;
  unit: string;
  featured: boolean;
  categorySlug: string;
  categoryName: string;
  imagenes: string[];
  variantes: VarianteDetalle[];
}

/** Ficha completa de un producto. Devuelve null si no existe o está dado de baja. */
export async function obtenerProducto(
  slug: string,
): Promise<ProductoDetalle | null> {
  const [fila] = await db
    .select({
      id: products.id,
      slug: products.slug,
      name: products.name,
      description: products.description,
      subcategory: products.subcategory,
      brand: products.brand,
      unit: products.unit,
      featured: products.featured,
      categorySlug: categories.slug,
      categoryName: categories.name,
    })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .where(and(eq(products.slug, slug), eq(products.active, true)))
    .limit(1);

  if (!fila) return null;

  const lista = await listaVigente();
  const propia = alias(priceListItems, "precio_propio");
  const general = alias(priceListItems, "precio_general");

  const [imagenes, variantesCrudas] = await Promise.all([
    db
      .select({ url: productImages.url })
      .from(productImages)
      .where(eq(productImages.productId, fila.id))
      .orderBy(asc(productImages.sortOrder)),
    db
      .select({
        id: productVariants.id,
        sku: productVariants.sku,
        label: productVariants.label,
        material: productVariants.material,
        color: productVariants.color,
        largoMm: productVariants.largoMm,
        anchoMm: productVariants.anchoMm,
        espesorMm: productVariants.espesorMm,
        sortOrder: productVariants.sortOrder,
        // Mismo respaldo que en el listado: la lista propia manda, la general
        // cubre lo que esa lista no tenga cargado.
        precio: sql<string | null>`coalesce(${propia.price}, ${general.price})`,
        branchSlug: branches.slug,
        qty: inventory.qty,
        reservado: inventory.reservado,
        minQty: inventory.minQty,
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
      .leftJoin(inventory, eq(inventory.variantId, productVariants.id))
      .leftJoin(branches, eq(branches.id, inventory.branchId))
      .where(
        and(
          eq(productVariants.productId, fila.id),
          eq(productVariants.active, true),
        ),
      )
      .orderBy(asc(productVariants.sortOrder)),
  ]);

  const porVariante = new Map<string, VarianteDetalle>();
  for (const v of variantesCrudas) {
    const actual = porVariante.get(v.id) ?? {
      id: v.id,
      sku: v.sku,
      label: v.label,
      material: v.material,
      color: v.color,
      largoMm: v.largoMm,
      anchoMm: v.anchoMm,
      espesorMm: v.espesorMm,
      precio: null,
      stockCentral: "sin-stock" as StockLevel,
      stockAserradero: "sin-stock" as StockLevel,
    };

    // El join ya restringe el precio a la lista general.
    if (v.precio !== null) actual.precio = v.precio;

    if (v.branchSlug && v.qty !== null && v.minQty !== null) {
      const nivel = stockLevel(disponible(v.qty, v.reservado ?? 0), v.minQty);
      if (v.branchSlug === "casa-central") actual.stockCentral = nivel;
      if (v.branchSlug === "aserradero") actual.stockAserradero = nivel;
    }

    porVariante.set(v.id, actual);
  }

  return {
    ...fila,
    imagenes: imagenes.map((i) => i.url),
    variantes: [...porVariante.values()],
  };
}

/** Otros productos de la misma categoría, para el bloque de relacionados. */
export async function productosRelacionados(
  categorySlug: string,
  excluirSlug: string,
  limite = 4,
): Promise<ProductoListado[]> {
  const todos = await listarProductos({ categoria: categorySlug });
  return todos.filter((p) => p.slug !== excluirSlug).slice(0, limite);
}

export interface Sugeridos {
  /** Lo que hace falta para usar el producto: los clavos del machimbre. */
  complementarios: ProductoListado[];
  /** La alternativa, cuando lo que se está mirando no convence o no hay stock. */
  similares: ProductoListado[];
  /** `true` cuando los similares salieron de la categoría y no de una carga. */
  similaresPorCategoria: boolean;
}

/**
 * Los productos sugeridos de una ficha (cláusula 1.3).
 *
 * Se cargan a mano desde el panel porque el criterio lo tiene el vendedor:
 * ninguna heurística sabe que a un deck de grandis le corresponde ese fijador y
 * no otro. Pero una ficha sin nada cargado no puede quedar vacía —son
 * doscientos productos y la carga va a ser gradual—, así que los **similares**
 * caen a otros de la misma categoría.
 *
 * Los complementarios no tienen respaldo automático: sugerir un complemento
 * equivocado es peor que no sugerir ninguno. "También podés necesitar" al lado
 * de algo que no sirve para este producto quema la confianza de todo el bloque.
 *
 * Los inactivos y los sin stock quedan afuera: `listarProductos` ya filtra por
 * `active`, y acá se manda al fondo lo que no se puede comprar.
 */
export async function productosSugeridos(
  productId: string,
  categorySlug: string,
  excluirSlug: string,
  limite = 4,
): Promise<Sugeridos> {
  const vinculos = await db
    .select({
      relatedProductId: relatedProducts.relatedProductId,
      tipo: relatedProducts.tipo,
      orden: relatedProducts.orden,
    })
    .from(relatedProducts)
    .where(eq(relatedProducts.productId, productId))
    .orderBy(asc(relatedProducts.orden));

  const idsComplementarios = vinculos
    .filter((v) => v.tipo === "complementario")
    .map((v) => v.relatedProductId);
  const idsSimilares = vinculos
    .filter((v) => v.tipo === "similar")
    .map((v) => v.relatedProductId);

  const [cargados, deCategoria] = await Promise.all([
    listarProductos({ ids: [...idsComplementarios, ...idsSimilares] }),
    idsSimilares.length === 0
      ? listarProductos({ categoria: categorySlug })
      : Promise.resolve([]),
  ]);

  /** Devuelve los productos en el orden en que los cargó el vendedor. */
  const enOrden = (ids: string[]) =>
    ids
      .map((id) => cargados.find((p) => p.id === id))
      .filter((p): p is ProductoListado => p !== undefined)
      .slice(0, limite);

  const similares = enOrden(idsSimilares);

  return {
    complementarios: enOrden(idsComplementarios),
    similares:
      similares.length > 0
        ? similares
        : deCategoria.filter((p) => p.slug !== excluirSlug).slice(0, limite),
    similaresPorCategoria: idsSimilares.length === 0,
  };
}

/**
 * Complementos de lo que ya está en el carrito.
 *
 * El momento de acordarse del sellador es cuando el deck ya está en la lista,
 * no cuando se estaba mirando la ficha. Por eso el bloque va también acá, y por
 * eso solo muestra **complementarios**: ofrecer alternativas a esta altura es
 * invitar a deshacer una decisión que la persona ya tomó.
 *
 * Se excluye lo que ya está en el carrito —sugerir algo que ya se agregó hace
 * ver el bloque como ruido— y no hay respaldo por categoría: si nadie cargó
 * complementos, no se muestra nada.
 */
export async function complementosDelCarrito(
  variantIds: string[],
  limite = 4,
): Promise<ProductoListado[]> {
  const ids = variantIds.filter(Boolean);
  if (ids.length === 0) return [];

  // De las variantes del carrito a sus productos, y de ahí a los complementos.
  const enElCarrito = await db
    .selectDistinct({ productId: productVariants.productId })
    .from(productVariants)
    .where(inArray(productVariants.id, ids));

  const propios = enElCarrito.map((p) => p.productId);
  if (propios.length === 0) return [];

  const vinculos = await db
    .select({ relatedProductId: relatedProducts.relatedProductId })
    .from(relatedProducts)
    .where(
      and(
        inArray(relatedProducts.productId, propios),
        eq(relatedProducts.tipo, "complementario"),
      ),
    )
    .orderBy(asc(relatedProducts.orden));

  const yaEsta = new Set(propios);
  const candidatos = [
    ...new Set(
      vinculos
        .map((v) => v.relatedProductId)
        .filter((id) => !yaEsta.has(id)),
    ),
  ];

  if (candidatos.length === 0) return [];

  const productos = await listarProductos({ ids: candidatos });

  // Lo que no se puede comprar no se sugiere: mandar a alguien a una ficha sin
  // stock desde su propio carrito es peor que no sugerir nada.
  return productos.filter((p) => p.hayStock).slice(0, limite);
}

/**
 * Todo lo que la portada necesita, en una sola pasada.
 *
 * Se resuelve acá y no en cada sección para no repetir la consulta de productos
 * tres veces: las ofertas, los destacados y los conteos salen del mismo listado.
 */
/** Año en que abrió la maderera. Es la única fecha fija del sitio. */
export const ANIO_FUNDACION = 1981;

/**
 * Los números que la página "Nosotros" muestra en grande.
 *
 * Salen de la base y del calendario, no de constantes: decían "43 años" en
 * 2026 —eran 45— y "200+ productos" con un catálogo que tenía otra cantidad.
 * Un número inventado en la página institucional es de las pocas cosas que un
 * visitante puede verificar solo, y desmiente todo lo demás.
 *
 * La hora se lee acá y no durante el render de la página, que es donde sería
 * una impureza.
 */
export const numerosDeLaEmpresa = cache(
  cachearPublico(async () => {
  /*
   * Los cuatro conteos en una sola consulta y no en cuatro en paralelo.
   *
   * Paralelas no tardan más, pero son cuatro viajes y cuatro conexiones del
   * pool por cada carga de la portada y de "Nosotros", que es de lo que más se
   * pide. Contar cuatro tablas chicas es trabajo que Postgres hace de una.
   */
  const [fila] = await db
    .select({
      productos: sql<number>`(select count(*) from ${products} where ${products.active})::int`,
      medidas: sql<number>`(select count(*) from ${productVariants} where ${productVariants.active})::int`,
      sucursales: sql<number>`(select count(*) from ${branches} where ${branches.active})::int`,
      rubros: sql<number>`(select count(*) from ${categories} where ${categories.active})::int`,
    })
    .from(sql`(select 1) as x`);

  return {
    anios: new Date().getFullYear() - ANIO_FUNDACION,
    productos: fila?.productos ?? 0,
    medidas: fila?.medidas ?? 0,
    sucursales: fila?.sucursales ?? 0,
    rubros: fila?.rubros ?? 0,
  };
  },
  ["numeros-de-la-empresa"],
  ETIQUETAS.catalogo,
  ),
);

export async function datosDePortada() {
  const [categorias, todos] = await Promise.all([
    listarCategorias(),
    listarProductos(),
  ]);

  const ofertas = todos.filter((p) => p.descuento !== null).slice(0, 4);

  // Si no hay ofertas cargadas, la sección se llena con los destacados en vez
  // de quedar vacía: una portada con un hueco se lee como que algo falló.
  const destacados = todos
    .filter((p) => p.featured && p.hayStock && !ofertas.includes(p))
    .slice(0, 4);

  const conStock = todos.filter((p) => p.hayStock).length;

  return {
    categorias,
    ofertas,
    destacados:
      destacados.length > 0
        ? destacados
        : todos.filter((p) => p.hayStock).slice(0, 4),
    totalProductos: todos.length,
    conStock,
  };
}
