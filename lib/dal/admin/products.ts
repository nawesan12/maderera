import "server-only";

import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
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
  orderItems,
  orders,
  products,
  relatedProducts,
  subcategories,
} from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";

/**
 * Consultas de gestión de productos.
 *
 * A diferencia de `lib/dal/catalog.ts`, acá se ven las dos listas de precios, las
 * cantidades exactas y los productos dados de baja. Cada función empieza pidiendo
 * sesión de staff: no alcanza con que la página esté detrás del panel, porque
 * estas funciones también se llaman desde Server Actions.
 */

export interface ProductoAdmin {
  id: string;
  slug: string;
  name: string;
  categoryName: string;
  brand: string | null;
  unit: string;
  featured: boolean;
  active: boolean;
  variantes: number;
  stockTotal: number;
  imagen: string | null;
  /** Precio más bajo entre las variantes, para el "desde". */
  precioDesde: string | null;
  sinFoto: boolean;
}

export async function listarProductosAdmin(filtros: {
  busqueda?: string;
  categoria?: string;
} = {}): Promise<ProductoAdmin[]> {
  await requireStaff();

  const condiciones = [];
  if (filtros.categoria && filtros.categoria !== "todos") {
    condiciones.push(eq(categories.slug, filtros.categoria));
  }
  if (filtros.busqueda) {
    const coincidencia = coincideBusqueda(filtros.busqueda, [
      products.name,
      products.brand,
      products.subcategory,
      categories.name,
    ]);
    if (coincidencia) condiciones.push(coincidencia);
  }

  const filas = await db
    .select({
      id: products.id,
      slug: products.slug,
      name: products.name,
      categoryName: categories.name,
      brand: products.brand,
      unit: products.unit,
      featured: products.featured,
      active: products.active,
    })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .where(condiciones.length > 0 ? and(...condiciones) : undefined)
    .orderBy(desc(products.updatedAt));

  if (filas.length === 0) return [];

  const conteos = await db
    .select({
      productId: productVariants.productId,
      variantes: count(productVariants.id),
    })
    .from(productVariants)
    .where(
      inArray(
        productVariants.productId,
        filas.map((f) => f.id),
      ),
    )
    .groupBy(productVariants.productId);

  const stock = await db
    .select({
      productId: productVariants.productId,
      qty: inventory.qty,
    })
    .from(productVariants)
    .leftJoin(inventory, eq(inventory.variantId, productVariants.id))
    .where(
      inArray(
        productVariants.productId,
        filas.map((f) => f.id),
      ),
    );

  const ids = filas.map((f) => f.id);

  const [portadas, precios] = await Promise.all([
    db
      .select({
        productId: productImages.productId,
        url: productImages.url,
        sortOrder: productImages.sortOrder,
      })
      .from(productImages)
      .where(inArray(productImages.productId, ids))
      .orderBy(asc(productImages.sortOrder)),
    db
      .select({
        productId: productVariants.productId,
        price: priceListItems.price,
      })
      .from(productVariants)
      .innerJoin(
        priceListItems,
        eq(priceListItems.variantId, productVariants.id),
      )
      .innerJoin(
        priceLists,
        and(
          eq(priceLists.id, priceListItems.priceListId),
          eq(priceLists.isDefault, true),
        ),
      )
      .where(inArray(productVariants.productId, ids)),
  ]);

  const portadaPorProducto = new Map<string, string>();
  for (const p of portadas) {
    if (!portadaPorProducto.has(p.productId)) {
      portadaPorProducto.set(p.productId, p.url);
    }
  }

  const precioPorProducto = new Map<string, number>();
  for (const p of precios) {
    const valor = Number(p.price);
    if (!Number.isFinite(valor) || valor <= 0) continue;
    const actual = precioPorProducto.get(p.productId);
    if (actual === undefined || valor < actual) {
      precioPorProducto.set(p.productId, valor);
    }
  }

  const variantesPorProducto = new Map(
    conteos.map((c) => [c.productId, c.variantes]),
  );
  const stockPorProducto = new Map<string, number>();
  for (const s of stock) {
    stockPorProducto.set(
      s.productId,
      (stockPorProducto.get(s.productId) ?? 0) + (s.qty ?? 0),
    );
  }

  return filas.map((f) => {
    const precio = precioPorProducto.get(f.id);
    const imagen = portadaPorProducto.get(f.id) ?? null;

    return {
      ...f,
      variantes: variantesPorProducto.get(f.id) ?? 0,
      stockTotal: stockPorProducto.get(f.id) ?? 0,
      imagen,
      precioDesde: precio !== undefined ? String(precio) : null,
      sinFoto: imagen === null,
    };
  });
}

/** Producto completo para el formulario de edición. */
export async function obtenerProductoAdmin(id: string) {
  await requireStaff();

  const [producto] = await db
    .select()
    .from(products)
    .where(eq(products.id, id))
    .limit(1);

  if (!producto) return null;

  const [imagenes, variantes, listas, sucursales] = await Promise.all([
    db
      .select()
      .from(productImages)
      .where(eq(productImages.productId, id))
      .orderBy(asc(productImages.sortOrder)),
    db
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, id))
      .orderBy(asc(productVariants.sortOrder)),
    db.select().from(priceLists),
    db.select().from(branches).orderBy(asc(branches.sortOrder)),
  ]);

  const ids = variantes.map((v) => v.id);

  const [precios, stock] = await Promise.all([
    ids.length > 0
      ? db
          .select()
          .from(priceListItems)
          .where(inArray(priceListItems.variantId, ids))
      : Promise.resolve([]),
    ids.length > 0
      ? db.select().from(inventory).where(inArray(inventory.variantId, ids))
      : Promise.resolve([]),
  ]);

  const listaGeneral = listas.find((l) => l.isDefault);
  const listaProfesional = listas.find((l) => l.slug === "profesional");
  const central = sucursales.find((s) => s.slug === "casa-central");
  const aserradero = sucursales.find((s) => s.slug === "aserradero");

  return {
    ...producto,
    imagen: imagenes[0]?.url ?? "",
    galeria: imagenes.map((i) => ({ id: i.id, url: i.url, alt: i.alt })),
    variantes: variantes.map((v) => ({
      id: v.id,
      sku: v.sku,
      label: v.label,
      largoMm: v.largoMm,
      anchoMm: v.anchoMm,
      espesorMm: v.espesorMm,
      material: v.material ?? "",
      color: v.color ?? "",
      terminacion: v.terminacion ?? "",
      calidad: v.calidad ?? "",
      precioGeneral:
        precios.find(
          (p) => p.variantId === v.id && p.priceListId === listaGeneral?.id,
        )?.price ?? "0",
      precioProfesional:
        precios.find(
          (p) => p.variantId === v.id && p.priceListId === listaProfesional?.id,
        )?.price ?? "0",
      stockCentral:
        stock.find((s) => s.variantId === v.id && s.branchId === central?.id)
          ?.qty ?? 0,
      stockAserradero:
        stock.find((s) => s.variantId === v.id && s.branchId === aserradero?.id)
          ?.qty ?? 0,
      minCentral:
        stock.find((s) => s.variantId === v.id && s.branchId === central?.id)
          ?.minQty ?? 0,
      minAserradero:
        stock.find((s) => s.variantId === v.id && s.branchId === aserradero?.id)
          ?.minQty ?? 0,
    })),
  };
}

export async function listarCategoriasAdmin() {
  await requireStaff();
  return db
    .select({ id: categories.id, slug: categories.slug, name: categories.name })
    .from(categories)
    .orderBy(asc(categories.sortOrder));
}

/**
 * Todos los rubros, con su categoría.
 *
 * Van todos juntos y el formulario filtra por la categoría elegida: la
 * categoría se cambia en la misma pantalla, y volver al servidor por los rubros
 * en cada cambio deja el select vacío justo cuando alguien está cargando algo.
 *
 * Incluye los inactivos: un producto puede estar en un rubro que se dio de baja
 * y la ficha tiene que poder mostrarlo en vez de vaciarlo en silencio.
 */
export async function listarRubrosAdmin() {
  await requireStaff();
  return db
    .select({
      id: subcategories.id,
      categoryId: subcategories.categoryId,
      name: subcategories.name,
      active: subcategories.active,
    })
    .from(subcategories)
    .orderBy(asc(subcategories.sortOrder), asc(subcategories.name));
}

/**
 * Los rubros agrupados por categoría, para la pantalla de rubros.
 *
 * Trae dos números por rubro y los dos importan: cuántos productos lo tienen
 * asignado —si es cero, el rubro no se ve en el catálogo— y cuántos lo nombran
 * como texto sin tenerlo asignado, que es lo que queda por enganchar de cuando
 * la subcategoría era texto libre.
 */
export async function rubrosPorCategoria() {
  await requireStaff();

  /*
   * Cuatro consultas planas y el cruce en memoria, en vez de subconsultas
   * correlacionadas escritas a mano dentro del `select`.
   *
   * Son tres agregaciones sobre tablas chicas —las categorías, los rubros y un
   * `group by` de productos—, así que el cruce sale gratis. A cambio, cada
   * consulta se puede leer y probar sola, que es lo que no se podía hacer con
   * un `count(*)` incrustado por plantilla.
   */
  const [cats, rubros, conteos, sueltos] = await Promise.all([
    db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .orderBy(asc(categories.sortOrder)),
    db
      .select({
        id: subcategories.id,
        categoryId: subcategories.categoryId,
        name: subcategories.name,
        slug: subcategories.slug,
        active: subcategories.active,
      })
      .from(subcategories)
      .orderBy(asc(subcategories.sortOrder), asc(subcategories.name)),
    db
      .select({
        subcategoryId: products.subcategoryId,
        cuantos: count(),
      })
      .from(products)
      .where(eq(products.active, true))
      .groupBy(products.subcategoryId),
    // Los que nombran un rubro como texto y no lo tienen asignado: es lo que
    // queda por enganchar de cuando la subcategoría era un campo libre.
    db
      .select({
        categoryId: products.categoryId,
        texto: sql<string>`lower(unaccent(${products.subcategory}))`,
        cuantos: count(),
      })
      .from(products)
      .where(
        and(
          eq(products.active, true),
          isNull(products.subcategoryId),
          isNotNull(products.subcategory),
        ),
      )
      .groupBy(products.categoryId, sql`2`),
  ]);

  const porRubro = new Map(
    conteos
      .filter((c) => c.subcategoryId !== null)
      .map((c) => [c.subcategoryId as string, Number(c.cuantos)]),
  );

  const porTexto = new Map(
    sueltos.map((s) => [`${s.categoryId}:${s.texto}`, Number(s.cuantos)]),
  );

  return cats.map((c) => ({
    ...c,
    rubros: rubros
      .filter((r) => r.categoryId === c.id)
      .map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        active: r.active,
        productos: porRubro.get(r.id) ?? 0,
        sueltos: porTexto.get(`${c.id}:${sinTildes(r.name)}`) ?? 0,
      })),
  }));
}

/** Minúsculas y sin tildes, igual que `unaccent` en la base. */
function sinTildes(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/* -------------------------------------------------------------------------- */
/* Candidatos a dar de baja                                                    */
/* -------------------------------------------------------------------------- */

export interface CandidatoDeBaja {
  id: string;
  nombre: string;
  slug: string;
  categoria: string;
  /** Días desde la última venta. Null si nunca se vendió. */
  diasSinVender: number | null;
  /** Unidades disponibles hoy, sumando las dos sucursales. */
  stock: number;
  /** Cuántas de sus medidas no tienen precio en ninguna lista. */
  variantesSinPrecio: number;
  variantes: number;
  /** Por qué aparece en la lista. */
  motivos: string[];
}

export interface UmbralesDeBaja {
  /** Meses sin una sola venta. */
  mesesSinVender: number;
}

export const UMBRALES_DE_BAJA: UmbralesDeBaja = { mesesSinVender: 12 };

/**
 * Productos que quizá haya que dar de baja.
 *
 * La clienta pidió "dado de baja de productos de manera automática según
 * parámetros". **Esto no da de baja nada**: arma la lista y alguien decide.
 *
 * La diferencia importa. Un producto desactivado solo desaparece del catálogo
 * y del buscador sin que nadie se entere, y el caso que lo rompe es fácil de
 * imaginar: un artículo de temporada que no se vende en trece meses y vuelve a
 * venderse en el catorce. Con una lista, alguien mira y decide en dos minutos;
 * con un automatismo, el error se descubre cuando un cliente pregunta por algo
 * que ya no está.
 *
 * Tres motivos, y un producto puede tener varios:
 * ninguna venta en `mesesSinVender`, sin stock en ninguna sucursal, o sin
 * precio cargado en ninguna medida —que en la práctica es un producto que no
 * se puede comprar—.
 */
export async function candidatosDeBaja(
  umbrales: UmbralesDeBaja = UMBRALES_DE_BAJA,
): Promise<CandidatoDeBaja[]> {
  await requireStaff();

  const corte = new Date();
  corte.setMonth(corte.getMonth() - umbrales.mesesSinVender);

  const filas = await db
    .select({
      id: products.id,
      nombre: products.name,
      slug: products.slug,
      categoria: categories.name,
      variantes: sql<number>`(
        select count(*) from ${productVariants}
        where ${productVariants.productId} = ${products.id}
          and ${productVariants.active}
      )::int`,
      stock: sql<number>`coalesce((
        select sum(greatest(${inventory.qty} - ${inventory.reservado}, 0))
        from ${inventory}
        join ${productVariants} pv on pv.id = ${inventory.variantId}
        where pv.product_id = ${products.id} and pv.active
      ), 0)::int`,
      variantesSinPrecio: sql<number>`(
        select count(*) from ${productVariants} pv
        where pv.product_id = ${products.id} and pv.active
          and not exists (
            select 1 from ${priceListItems} pli
            where pli.variant_id = pv.id and pli.price > 0
          )
      )::int`,
      creado: products.createdAt,
      ultimaVenta: sql<Date | null>`(
        select max(o.created_at)
        from ${orderItems} oi
        join ${orders} o on o.id = oi.order_id
        join ${productVariants} pv on pv.id = oi.variant_id
        where pv.product_id = ${products.id}
      )`,
    })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .where(eq(products.active, true))
    .orderBy(asc(products.name));

  const ahora = Date.now();

  return filas
    .map((f) => {
      const ultima = f.ultimaVenta ? new Date(f.ultimaVenta) : null;
      const diasSinVender = ultima
        ? Math.floor((ahora - ultima.getTime()) / 86_400_000)
        : null;

      const motivos: string[] = [];

      /*
       * "Nunca se vendió" solo cuenta si el producto lleva cargado más tiempo
       * que el umbral.
       *
       * Un producto que se cargó la semana pasada obviamente no se vendió
       * nunca, y marcarlo llena la lista de casos que nadie va a dar de baja.
       * Lo que interesa es lo que está hace un año y no se movió.
       */
      const antiguo = new Date(f.creado) < corte;

      if (!ultima) {
        if (antiguo) motivos.push("Nunca se vendió");
      } else if (ultima < corte) {
        motivos.push(
          `Sin ventas hace ${Math.floor((diasSinVender ?? 0) / 30)} meses`,
        );
      }

      if (Number(f.stock) <= 0) motivos.push("Sin stock en ninguna sucursal");

      if (Number(f.variantes) > 0 && Number(f.variantesSinPrecio) === Number(f.variantes)) {
        motivos.push("Ninguna medida tiene precio");
      }

      return {
        id: f.id,
        nombre: f.nombre,
        slug: f.slug,
        categoria: f.categoria,
        diasSinVender,
        stock: Number(f.stock),
        variantes: Number(f.variantes),
        variantesSinPrecio: Number(f.variantesSinPrecio),
        motivos,
      };
    })
    // Los que no cumplen ningún criterio no son candidatos a nada.
    .filter((c) => c.motivos.length > 0)
    // Primero los que acumulan más razones: son los más fáciles de decidir.
    .sort((a, b) => b.motivos.length - a.motivos.length);
}

/* -------------------------------------------------------------------------- */
/* Productos sugeridos                                                         */
/* -------------------------------------------------------------------------- */

export interface SugeridoCargado {
  id: string;
  relatedProductId: string;
  nombre: string;
  categoria: string;
  imagen: string | null;
  activo: boolean;
  tipo: "complementario" | "similar";
  orden: number;
}

/** Los sugeridos ya cargados de un producto, con lo justo para listarlos. */
export async function sugeridosDelProducto(
  productId: string,
): Promise<SugeridoCargado[]> {
  await requireStaff();

  const sugerido = alias(products, "sugerido");

  const filas = await db
    .select({
      id: relatedProducts.id,
      relatedProductId: relatedProducts.relatedProductId,
      nombre: sugerido.name,
      categoria: categories.name,
      activo: sugerido.active,
      tipo: relatedProducts.tipo,
      orden: relatedProducts.orden,
    })
    .from(relatedProducts)
    .innerJoin(sugerido, eq(sugerido.id, relatedProducts.relatedProductId))
    .leftJoin(categories, eq(categories.id, sugerido.categoryId))
    .where(eq(relatedProducts.productId, productId))
    .orderBy(asc(relatedProducts.tipo), asc(relatedProducts.orden));

  if (filas.length === 0) return [];

  const imagenes = await db
    .select({ productId: productImages.productId, url: productImages.url })
    .from(productImages)
    .where(
      inArray(
        productImages.productId,
        filas.map((f) => f.relatedProductId),
      ),
    )
    .orderBy(asc(productImages.sortOrder));

  const primera = new Map<string, string>();
  for (const img of imagenes) {
    if (!primera.has(img.productId)) primera.set(img.productId, img.url);
  }

  return filas.map((f) => ({
    ...f,
    categoria: f.categoria ?? "Sin categoría",
    imagen: primera.get(f.relatedProductId) ?? null,
  }));
}

/**
 * Candidatos para el buscador de sugeridos.
 *
 * Devuelve nombre y categoría de todos los productos activos menos el propio.
 * Son un par de cientos de filas de texto corto: se mandan enteras y el filtrado
 * pasa en el navegador, que responde a cada tecla sin ida y vuelta al servidor.
 * Con miles de productos esto habría que darlo vuelta.
 */
export async function candidatosParaSugerir(productId: string) {
  await requireStaff();

  return db
    .select({
      id: products.id,
      nombre: products.name,
      categoria: categories.name,
    })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(and(eq(products.active, true), ne(products.id, productId)))
    .orderBy(asc(products.name));
}
