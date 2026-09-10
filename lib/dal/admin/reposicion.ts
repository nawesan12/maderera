import "server-only";

import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  branches,
  categories,
  inventory,
  orderItems,
  orders,
  productVariants,
  products,
  subcategories,
} from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";
import {
  diasDeCobertura,
  sugerenciaDeCompra,
  ventaDiaria,
} from "@/lib/reposicion";

/**
 * El reporte de reposición: stock, ventas y cuánto convendría comprar.
 *
 * Es el pedido 85 de la clienta: "un reporte de stock por rubros, stock actual
 * en cada sucursal, que indique las ventas, cuánto convendría reponer, cuándo,
 * cuál se vendió más… accionable para tomar buenas acciones de compra". Hasta
 * ahora el stock vivía en una pantalla y las ventas en otra, y el cruce lo
 * hacía alguien a ojo.
 *
 * La sugerencia es aritmética sobre el ritmo del período (`lib/reposicion.ts`)
 * y el período se elige en pantalla: un producto estacional medido en su mes
 * fuerte sugiere de más, y eso lo corrige quien mira, no una fórmula.
 */

export interface FilaDeReposicion {
  variantId: string;
  producto: string;
  medida: string;
  sku: string | null;
  unidad: string;
  categoria: string;
  categoriaSlug: string;
  rubro: string | null;
  disponibleCentral: number;
  disponibleAserradero: number;
  disponible: number;
  vendido: number;
  /** Días de venta que cubre el stock. Null: sin ventas en el período. */
  cobertura: number | null;
  /** Unidades a comprar para la cobertura objetivo. */
  sugerido: number;
}

export interface ReporteDeReposicion {
  filas: FilaDeReposicion[];
  /** Ventas del período agrupadas por categoría, para el gráfico. */
  porCategoria: { nombre: string; vendido: number }[];
  diasDelPeriodo: number;
  coberturaObjetivo: number;
}

export async function reporteDeReposicion(opciones: {
  diasDelPeriodo: number;
  coberturaObjetivo: number;
  categoria?: string;
  sucursal?: string;
}): Promise<ReporteDeReposicion> {
  await requireStaff();

  const desde = new Date();
  desde.setDate(desde.getDate() - opciones.diasDelPeriodo);

  const condiciones = [
    eq(products.active, true),
    eq(productVariants.active, true),
  ];
  if (opciones.categoria && opciones.categoria !== "todos") {
    condiciones.push(eq(categories.slug, opciones.categoria));
  }

  // El stock por sucursal en columnas, como la pantalla de stock: dos
  // sucursales fijas es la realidad del negocio, no una limitación.
  const stock = await db
    .select({
      variantId: productVariants.id,
      producto: products.name,
      medida: productVariants.label,
      sku: productVariants.sku,
      unidad: products.unit,
      categoria: categories.name,
      categoriaSlug: categories.slug,
      rubro: subcategories.name,
      disponibleCentral: sql<number>`coalesce(sum(case when ${branches.slug} = 'casa-central' then ${inventory.qty} - coalesce(${inventory.reservado}, 0) end), 0)::int`,
      disponibleAserradero: sql<number>`coalesce(sum(case when ${branches.slug} = 'aserradero' then ${inventory.qty} - coalesce(${inventory.reservado}, 0) end), 0)::int`,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .leftJoin(subcategories, eq(subcategories.id, products.subcategoryId))
    .leftJoin(inventory, eq(inventory.variantId, productVariants.id))
    .leftJoin(branches, eq(branches.id, inventory.branchId))
    .where(and(...condiciones))
    .groupBy(
      productVariants.id,
      products.name,
      productVariants.label,
      productVariants.sku,
      products.unit,
      categories.name,
      categories.slug,
      subcategories.name,
    );

  if (stock.length === 0) {
    return {
      filas: [],
      porCategoria: [],
      diasDelPeriodo: opciones.diasDelPeriodo,
      coberturaObjetivo: opciones.coberturaObjetivo,
    };
  }

  /*
   * Lo vendido en el período por variante. Los pedidos cancelados no cuentan
   * —esa mercadería volvió—; el filtro por sucursal usa la del pedido, así
   * que la venta web sin sucursal asignada solo aparece en "las dos".
   */
  const condicionesVenta = [
    gte(orders.createdAt, desde),
    sql`${orders.estado} <> 'cancelado'`,
    inArray(
      orderItems.variantId,
      stock.map((s) => s.variantId),
    ),
  ];
  if (opciones.sucursal && opciones.sucursal !== "todos") {
    condicionesVenta.push(
      sql`${orders.branchId} = (select id from branches where slug = ${opciones.sucursal})`,
    );
  }

  const ventas = await db
    .select({
      variantId: orderItems.variantId,
      vendido: sql<string>`coalesce(sum(${orderItems.cantidad}), 0)`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(...condicionesVenta))
    .groupBy(orderItems.variantId);

  const vendidoPorVariante = new Map(
    ventas.map((v) => [v.variantId, Number(v.vendido)]),
  );

  const filas: FilaDeReposicion[] = stock
    .map((s) => {
      const disponible =
        opciones.sucursal === "casa-central"
          ? s.disponibleCentral
          : opciones.sucursal === "aserradero"
            ? s.disponibleAserradero
            : s.disponibleCentral + s.disponibleAserradero;
      const vendido = vendidoPorVariante.get(s.variantId) ?? 0;
      const datos = {
        disponible,
        vendido,
        diasDelPeriodo: opciones.diasDelPeriodo,
      };

      return {
        variantId: s.variantId,
        producto: s.producto,
        medida: s.medida,
        sku: s.sku,
        unidad: s.unidad,
        categoria: s.categoria,
        categoriaSlug: s.categoriaSlug,
        rubro: s.rubro,
        disponibleCentral: s.disponibleCentral,
        disponibleAserradero: s.disponibleAserradero,
        disponible,
        vendido,
        cobertura: diasDeCobertura(datos),
        sugerido: sugerenciaDeCompra(datos, opciones.coberturaObjetivo),
      };
    })
    /*
     * Primero lo que hay que comprar, ordenado por urgencia —menos días de
     * cobertura—; después lo que se vendió sin necesitar compra; al final lo
     * que no se movió. Es el orden en el que se decide, no el alfabético.
     */
    .sort((a, b) => {
      if ((a.sugerido > 0) !== (b.sugerido > 0)) return a.sugerido > 0 ? -1 : 1;
      if (a.sugerido > 0 && b.sugerido > 0) {
        return (a.cobertura ?? 0) - (b.cobertura ?? 0);
      }
      return b.vendido - a.vendido;
    });

  const porCategoria = new Map<string, number>();
  for (const f of filas) {
    porCategoria.set(f.categoria, (porCategoria.get(f.categoria) ?? 0) + f.vendido);
  }

  return {
    filas,
    porCategoria: [...porCategoria.entries()]
      .map(([nombre, vendido]) => ({ nombre, vendido }))
      .filter((c) => c.vendido > 0)
      .sort((a, b) => b.vendido - a.vendido),
    diasDelPeriodo: opciones.diasDelPeriodo,
    coberturaObjetivo: opciones.coberturaObjetivo,
  };
}

export { ventaDiaria };
