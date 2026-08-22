import "server-only";

import { and, asc, count, eq, inArray } from "drizzle-orm";
import { coincideBusqueda } from "@/lib/busqueda";
import { db } from "@/lib/db";
import {
  branches,
  categories,
  inventory,
  priceListItems,
  priceLists,
  productImages,
  productVariants,
  products,
} from "@/lib/db/schema";
import { combinedStockLevel, stockLevel, type StockLevel } from "@/lib/stock-level";

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
}

/** Categorías con la cantidad real de productos activos. */
export async function listarCategorias() {
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
}

/**
 * Trae el catálogo ya filtrado desde la base.
 *
 * El prototipo mandaba el array completo al navegador y filtraba ahí. Con más de
 * doscientos productos y varias variantes cada uno eso es un bundle enorme y una
 * fuga de datos: el visitante recibía el catálogo entero aunque mirara una sola
 * categoría.
 */
export async function listarProductos(
  filtros: FiltrosCatalogo = {},
): Promise<ProductoListado[]> {
  const condiciones = [eq(products.active, true)];

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
    variantesConStockYPrecio(ids),
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
 * Id de la lista de precios pública.
 *
 * Se resuelve por separado y se usa para filtrar el join de precios. Hacerlo con
 * un LEFT JOIN contra `price_lists` no alcanza: las filas de la lista profesional
 * igual entran con su precio y terminan pisando al público. Es un error que no se
 * ve —la página muestra un número plausible— pero publica el precio mayorista.
 */
async function idListaGeneral(): Promise<string | null> {
  const [lista] = await db
    .select({ id: priceLists.id })
    .from(priceLists)
    .where(eq(priceLists.isDefault, true))
    .limit(1);
  return lista?.id ?? null;
}

/** Variantes con su precio de lista general y su stock por sucursal. */
async function variantesConStockYPrecio(productIds: string[]) {
  const listaGeneralId = await idListaGeneral();

  const filas = await db
    .select({
      productId: productVariants.productId,
      variantId: productVariants.id,
      label: productVariants.label,
      sortOrder: productVariants.sortOrder,
      precio: priceListItems.price,
      precioAnterior: priceListItems.precioAnterior,
      ofertaHasta: priceListItems.ofertaHasta,
      branchSlug: branches.slug,
      qty: inventory.qty,
      minQty: inventory.minQty,
    })
    .from(productVariants)
    .leftJoin(
      priceListItems,
      listaGeneralId
        ? and(
            eq(priceListItems.variantId, productVariants.id),
            eq(priceListItems.priceListId, listaGeneralId),
          )
        : eq(priceListItems.variantId, productVariants.id),
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
      fila.ofertaHasta === null || fila.ofertaHasta.getTime() > ahora;

    if (fila.precioAnterior !== null && vigente) {
      actual.precioAnterior = fila.precioAnterior;
    }

    if (fila.branchSlug && fila.qty !== null && fila.minQty !== null) {
      const nivel = stockLevel(fila.qty, fila.minQty);
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

  const listaGeneralId = await idListaGeneral();

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
        precio: priceListItems.price,
        branchSlug: branches.slug,
        qty: inventory.qty,
        minQty: inventory.minQty,
      })
      .from(productVariants)
      .leftJoin(
        priceListItems,
        listaGeneralId
          ? and(
              eq(priceListItems.variantId, productVariants.id),
              eq(priceListItems.priceListId, listaGeneralId),
            )
          : eq(priceListItems.variantId, productVariants.id),
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
      const nivel = stockLevel(v.qty, v.minQty);
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

/**
 * Todo lo que la portada necesita, en una sola pasada.
 *
 * Se resuelve acá y no en cada sección para no repetir la consulta de productos
 * tres veces: las ofertas, los destacados y los conteos salen del mismo listado.
 */
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
