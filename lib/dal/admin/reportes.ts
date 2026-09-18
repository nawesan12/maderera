import "server-only";

import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  branches,
  categories,
  customers,
  orderItems,
  orders,
  productVariants,
  products,
  sellers,
  user,
} from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";
import { plural } from "@/lib/formato";
import type { Periodo } from "@/lib/periodos";
import type { CorteDelReporte } from "@/lib/reportes-cortes";

/**
 * Los números de venta, cortados por donde se los mira.
 *
 * El resumen del panel contesta "cómo venimos". Esto contesta las cuatro
 * preguntas que vienen después y que hasta ahora no tenían pantalla: qué se
 * vende, quién compra, quién vende y en qué sucursal.
 *
 * **Las canceladas quedan afuera de todo.** Un pedido cancelado no es una
 * venta, y contarlo infla el ranking de un vendedor con lo que no cobró.
 */

export interface FilaDeReporte {
  clave: string;
  etiqueta: string;
  detalle: string | null;
  cantidad: number;
  total: number;

  /* ---- Margen ---- */

  /**
   * Lo vendido **sin IVA**.
   *
   * No es `total` menos un porcentaje fijo: se desagrega renglón por renglón
   * con la alícuota de cada uno, porque la maderera vende algunos ítems al
   * 10,5 % y la constante 21 desviaría el margen de esos casi diez puntos.
   */
  netoVenta: number;

  /**
   * Lo que costó, congelado en cada venta. `null` cuando ninguna línea del
   * grupo tiene costo, que es todo lo anterior al módulo de compras.
   */
  costo: number | null;

  /**
   * Renglones sin costo conocido.
   *
   * Se cuentan y se muestran **aparte**, no se tratan como costo cero. Un cero
   * daría 100 % de margen y mezclaría lo que no se sabe con lo que se sabe: el
   * promedio resultante es exactamente el número sobre el que no se puede
   * decidir nada.
   */
  lineasSinCosto: number;
}

/**
 * El neto y el costo de cada pedido, en una sola pasada.
 *
 * Va como subconsulta agregada y no como join directo contra `order_items`:
 * los reportes por cliente, vendedor, sucursal y canal agrupan **pedidos**, y
 * unirlos a los renglones sin agregar primero multiplicaría cada pedido por su
 * cantidad de líneas y el total saldría inflado.
 */
function margenesPorPedido() {
  return db
    .select({
      orderId: orderItems.orderId,
      neto: sql<string>`sum(${orderItems.subtotal} / (1 + coalesce(${orderItems.alicuotaIva}, 21) / 100))`.as(
        "neto",
      ),
      costo: sql<
        string | null
      >`sum(${orderItems.cantidad} * ${orderItems.costoUnitario}) filter (where ${orderItems.costoUnitario} is not null)`.as(
        "costo",
      ),
      sinCosto: sql<number>`count(*) filter (where ${orderItems.costoUnitario} is null)::int`.as(
        "sin_costo",
      ),
    })
    .from(orderItems)
    .groupBy(orderItems.orderId)
    .as("margenes");
}

/** Lo que devuelve la base para las columnas de margen, ya en números. */
function leerMargen(f: {
  netoVenta: string | null;
  costo: string | null;
  lineasSinCosto: number | null;
}) {
  return {
    netoVenta: Number(f.netoVenta ?? 0),
    costo: f.costo === null ? null : Number(f.costo),
    lineasSinCosto: Number(f.lineasSinCosto ?? 0),
  };
}

/**
 * Con qué se acota el reporte, además del período.
 *
 * Los cortes agrupan; esto **filtra**, que es otra cosa y es lo que faltaba:
 * «ventas por producto» cortado por rubro no contesta «qué le vendemos a las
 * constructoras», porque mezcla todos los clientes. Lo pidió la clienta al
 * pedir poder ver el crecimiento de cada gremio.
 */
export interface FiltrosDeReporte {
  /** Rubro del **cliente**, no del producto. Ver `lib/rubros-cliente.ts`. */
  rubro?: string;
  sucursal?: string;
}

/** El filtro común: pedidos reales del período, acotados si se pidió. */
function enElPeriodo(periodo: Periodo, filtros: FiltrosDeReporte = {}) {
  const condiciones = [sql`${orders.estado} <> 'cancelado'`];

  if (periodo.desde) condiciones.push(gte(orders.createdAt, periodo.desde));
  if (periodo.hasta) condiciones.push(lt(orders.createdAt, periodo.hasta));

  /*
   * Por rubro del cliente, con una subconsulta y no con un join.
   *
   * Un join a `customers` obligaría a tocar las siete consultas de este archivo
   * —cada una agrupa por otra cosa— y a cuidar que ninguna duplique filas. La
   * subconsulta se agrega en un solo lugar y las siete la heredan.
   */
  if (filtros.rubro && filtros.rubro !== "todos") {
    condiciones.push(
      inArray(
        orders.customerId,
        db
          .select({ id: customers.id })
          .from(customers)
          .where(eq(customers.rubro, filtros.rubro)),
      ),
    );
  }

  if (filtros.sucursal && filtros.sucursal !== "todas") {
    condiciones.push(eq(orders.branchId, filtros.sucursal));
  }

  return and(...condiciones);
}

/** Qué se vendió, por producto. Ordenado por lo que más facturó. */
export async function ventasPorProducto(
  periodo: Periodo,
  filtros: FiltrosDeReporte = {},
  tope = 50,
): Promise<FilaDeReporte[]> {
  await requireStaff();

  const filas = await db
    .select({
      clave: sql<string>`coalesce(${products.id}::text, ${orderItems.descripcion})`,
      etiqueta: sql<string>`coalesce(${products.name}, ${orderItems.descripcion})`,
      detalle: sql<string | null>`max(${productVariants.label})`,
      cantidad: sql<string>`sum(${orderItems.cantidad})`,
      total: sql<string>`sum(${orderItems.subtotal})`,
      netoVenta: sql<string>`sum(${orderItems.subtotal} / (1 + coalesce(${orderItems.alicuotaIva}, 21) / 100))`,
      costo: sql<
        string | null
      >`sum(${orderItems.cantidad} * ${orderItems.costoUnitario}) filter (where ${orderItems.costoUnitario} is not null)`,
      lineasSinCosto: sql<number>`count(*) filter (where ${orderItems.costoUnitario} is null)::int`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .leftJoin(productVariants, eq(productVariants.id, orderItems.variantId))
    .leftJoin(products, eq(products.id, productVariants.productId))
    .where(enElPeriodo(periodo, filtros))
    .groupBy(sql`1`, sql`2`)
    .orderBy(desc(sql`sum(${orderItems.subtotal})`))
    .limit(tope);

  return filas.map((f) => ({
    clave: f.clave,
    etiqueta: f.etiqueta,
    detalle: f.detalle,
    cantidad: Number(f.cantidad),
    total: Number(f.total),
    ...leerMargen(f),
  }));
}

/**
 * Qué se vendió, por rubro del catálogo.
 *
 * Es el reporte que la clienta lleva hoy en Excel: *"de cada rubro cuánta
 * utilidad hay, qué porcentaje dejan las materias que se maquinan"*. Estaban
 * los cortes por producto, por cliente, por vendedor, por sucursal y por
 * canal, y justo el que usan todos los meses no estaba.
 *
 * Corta por **categoría**, que es lo que ellos llaman rubro en la conversación
 * del negocio. Los renglones sin producto asociado —texto suelto de un
 * presupuesto— caen en "Sin categoría" en vez de desaparecer: son ventas
 * igual, y esconderlas haría que la suma del reporte no cierre con la del mes.
 */
export async function ventasPorCategoria(
  periodo: Periodo,
  filtros: FiltrosDeReporte = {},
  tope = 50,
): Promise<FilaDeReporte[]> {
  await requireStaff();

  const filas = await db
    .select({
      clave: sql<string>`coalesce(${categories.id}::text, 'sin-categoria')`,
      etiqueta: sql<string>`coalesce(${categories.name}, 'Sin categoría')`,
      detalle: sql<string | null>`count(distinct ${products.id})::text`,
      cantidad: sql<string>`sum(${orderItems.cantidad})`,
      total: sql<string>`sum(${orderItems.subtotal})`,
      netoVenta: sql<string>`sum(${orderItems.subtotal} / (1 + coalesce(${orderItems.alicuotaIva}, 21) / 100))`,
      costo: sql<
        string | null
      >`sum(${orderItems.cantidad} * ${orderItems.costoUnitario}) filter (where ${orderItems.costoUnitario} is not null)`,
      lineasSinCosto: sql<number>`count(*) filter (where ${orderItems.costoUnitario} is null)::int`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .leftJoin(productVariants, eq(productVariants.id, orderItems.variantId))
    .leftJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(enElPeriodo(periodo, filtros))
    .groupBy(sql`1`, sql`2`)
    .orderBy(desc(sql`sum(${orderItems.subtotal})`))
    .limit(tope);

  return filas.map((f) => ({
    clave: f.clave,
    etiqueta: f.etiqueta,
    // Cuántos productos distintos del rubro se vendieron: es lo que distingue
    // un rubro que factura por uno solo de otro que mueve variedad.
    detalle: f.detalle ? plural(Number(f.detalle), "producto") : null,
    cantidad: Number(f.cantidad),
    total: Number(f.total),
    ...leerMargen(f),
  }));
}

/** Quién compró. Sirve para saber a quién llamar cuando deja de comprar. */
export async function ventasPorCliente(
  periodo: Periodo,
  filtros: FiltrosDeReporte = {},
  tope = 50,
): Promise<FilaDeReporte[]> {
  await requireStaff();

  const margenes = margenesPorPedido();
  const filas = await db
    .select({
      clave: sql<string>`coalesce(${customers.id}::text, ${orders.contactoNombre})`,
      etiqueta: sql<string>`coalesce(${customers.razonSocial}, ${customers.nombre}, ${orders.contactoNombre})`,
      detalle: customers.cuit,
      cantidad: sql<string>`count(*)`,
      total: sql<string>`sum(${orders.total})`,
      netoVenta: sql<string>`sum(coalesce(margenes.neto, 0))`,
      costo: sql<string | null>`sum(margenes.costo)`,
      lineasSinCosto: sql<number>`coalesce(sum(margenes.sin_costo), 0)::int`,
    })
    .from(orders)
    .leftJoin(margenes, eq(margenes.orderId, orders.id))
    .leftJoin(customers, eq(customers.id, orders.customerId))
    .where(enElPeriodo(periodo, filtros))
    .groupBy(sql`1`, sql`2`, customers.cuit)
    .orderBy(desc(sql`sum(${orders.total})`))
    .limit(tope);

  return filas.map((f) => ({
    clave: f.clave,
    etiqueta: f.etiqueta,
    detalle: f.detalle,
    cantidad: Number(f.cantidad),
    total: Number(f.total),
    ...leerMargen(f),
  }));
}

/**
 * Quién vendió.
 *
 * Agrupa por el **vendedor asignado** a la venta (`orders.sellerId`) y, si no
 * hay, por quien la cargó en el sistema: el vendedor de calle vende y otro
 * tipea, y sumarle esa venta al que tipeó infla el ranking equivocado. Lo que
 * no tiene ni vendedor ni autor —el carrito del sitio— queda afuera: no lo
 * atendió nadie.
 */
export async function ventasPorVendedor(
  periodo: Periodo,
  filtros: FiltrosDeReporte = {},
): Promise<FilaDeReporte[]> {
  await requireStaff();

  const margenes = margenesPorPedido();
  const filas = await db
    .select({
      clave: sql<string>`coalesce(${sellers.id}::text, ${user.id})`,
      etiqueta: sql<string>`coalesce(${sellers.nombre}, ${user.name})`,
      detalle: sql<string | null>`case when ${sellers.id} is null then 'Cargó la venta' else null end`,
      cantidad: sql<string>`count(*)`,
      total: sql<string>`sum(${orders.total})`,
      netoVenta: sql<string>`sum(coalesce(margenes.neto, 0))`,
      costo: sql<string | null>`sum(margenes.costo)`,
      lineasSinCosto: sql<number>`coalesce(sum(margenes.sin_costo), 0)::int`,
    })
    .from(orders)
    .leftJoin(margenes, eq(margenes.orderId, orders.id))
    .leftJoin(sellers, eq(sellers.id, orders.sellerId))
    .leftJoin(user, eq(user.id, orders.createdByUserId))
    .where(
      and(
        enElPeriodo(periodo, filtros),
        sql`(${sellers.id} is not null or ${user.id} is not null)`,
      ),
    )
    .groupBy(sql`1`, sql`2`, sellers.id)
    .orderBy(desc(sql`sum(${orders.total})`));

  return filas.map((f) => ({
    clave: f.clave,
    etiqueta: f.etiqueta,
    detalle: f.detalle,
    cantidad: Number(f.cantidad),
    total: Number(f.total),
    ...leerMargen(f),
  }));
}

/** Dónde se vendió, por sucursal y por canal. */
export async function ventasPorSucursal(
  periodo: Periodo,
  filtros: FiltrosDeReporte = {},
): Promise<FilaDeReporte[]> {
  await requireStaff();

  const margenes = margenesPorPedido();
  const filas = await db
    .select({
      clave: sql<string>`coalesce(${branches.id}::text, 'sin-sucursal')`,
      etiqueta: sql<string>`coalesce(${branches.name}, 'Sin sucursal')`,
      detalle: sql<string | null>`null`,
      cantidad: sql<string>`count(*)`,
      total: sql<string>`sum(${orders.total})`,
      netoVenta: sql<string>`sum(coalesce(margenes.neto, 0))`,
      costo: sql<string | null>`sum(margenes.costo)`,
      lineasSinCosto: sql<number>`coalesce(sum(margenes.sin_costo), 0)::int`,
    })
    .from(orders)
    .leftJoin(margenes, eq(margenes.orderId, orders.id))
    .leftJoin(branches, eq(branches.id, orders.branchId))
    .where(enElPeriodo(periodo, filtros))
    .groupBy(sql`1`, sql`2`)
    .orderBy(desc(sql`sum(${orders.total})`));

  return filas.map((f) => ({
    clave: f.clave,
    etiqueta: f.etiqueta,
    detalle: null,
    cantidad: Number(f.cantidad),
    total: Number(f.total),
    ...leerMargen(f),
  }));
}

/** Por dónde entró la venta: mostrador, sitio, presupuesto, teléfono. */
export async function ventasPorCanal(
  periodo: Periodo,
  filtros: FiltrosDeReporte = {},
): Promise<FilaDeReporte[]> {
  await requireStaff();

  const margenes = margenesPorPedido();
  const filas = await db
    .select({
      clave: orders.origen,
      etiqueta: orders.origen,
      detalle: sql<string | null>`null`,
      cantidad: sql<string>`count(*)`,
      total: sql<string>`sum(${orders.total})`,
      netoVenta: sql<string>`sum(coalesce(margenes.neto, 0))`,
      costo: sql<string | null>`sum(margenes.costo)`,
      lineasSinCosto: sql<number>`coalesce(sum(margenes.sin_costo), 0)::int`,
    })
    .from(orders)
    .leftJoin(margenes, eq(margenes.orderId, orders.id))
    .where(enElPeriodo(periodo, filtros))
    .groupBy(orders.origen)
    .orderBy(desc(sql`sum(${orders.total})`));

  return filas.map((f) => ({
    clave: f.clave ?? "sin-origen",
    etiqueta: f.etiqueta ?? "sin origen",
    detalle: null,
    cantidad: Number(f.cantidad),
    total: Number(f.total),
    ...leerMargen(f),
  }));
}

/*
 * Los cortes y su lectura viven en `lib/reportes-cortes.ts`, que no es
 * `server-only`: los botones que eligen el corte corren en el navegador y no
 * pueden importar desde acá.
 */
export {
  CORTES,
  leerCorte,
  type CorteDelReporte,
} from "@/lib/reportes-cortes";

/** El reporte pedido, sin que la pantalla tenga que saber cuál es cuál. */
/**
 * Lo que se maquina contra lo que se vende en bruto.
 *
 * Es la segunda mitad del pedido de la clienta: *"de cada rubro cuánta
 * utilidad hay, **qué porcentaje dejan las materias que se maquinan**"*. El
 * corte por rubro contestaba la primera; esta contesta la que decide si
 * conviene seguir cepillando y cortando en planta o vender la madera como
 * viene.
 *
 * **Elaborado es el producto con `recargoElaboracionPct` cargado**, que es el
 * mismo dato con el que el ajuste masivo de precios calcula el "costo con
 * elaboración". Usar ese y no una marca aparte es lo que evita que las dos
 * pantallas digan cosas distintas del mismo producto.
 *
 * Solo dos filas, y está bien: la pregunta es una comparación, no un ranking.
 * El margen de cada lado sale de la misma cuenta que el resto del reporte, así
 * que los dos porcentajes se leen contra los de cualquier otro corte.
 */
export async function ventasPorElaboracion(
  periodo: Periodo,
  filtros: FiltrosDeReporte = {},
): Promise<FilaDeReporte[]> {
  await requireStaff();

  const elaborado = sql`coalesce(${products.recargoElaboracionPct}, 0) > 0`;

  const filas = await db
    .select({
      clave: sql<string>`case when ${elaborado} then 'elaborado' else 'bruto' end`,
      etiqueta: sql<string>`case when ${elaborado} then 'Se maquina en planta' else 'Se vende como viene' end`,
      detalle: sql<string | null>`count(distinct ${products.id})::text`,
      cantidad: sql<string>`sum(${orderItems.cantidad})`,
      total: sql<string>`sum(${orderItems.subtotal})`,
      netoVenta: sql<string>`sum(${orderItems.subtotal} / (1 + coalesce(${orderItems.alicuotaIva}, 21) / 100))`,
      costo: sql<
        string | null
      >`sum(${orderItems.cantidad} * ${orderItems.costoUnitario}) filter (where ${orderItems.costoUnitario} is not null)`,
      lineasSinCosto: sql<number>`count(*) filter (where ${orderItems.costoUnitario} is null)::int`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .innerJoin(productVariants, eq(productVariants.id, orderItems.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(enElPeriodo(periodo, filtros))
    .groupBy(sql`1`, sql`2`)
    .orderBy(desc(sql`sum(${orderItems.subtotal})`));

  return filas.map((f) => ({
    clave: f.clave,
    etiqueta: f.etiqueta,
    detalle: f.detalle ? plural(Number(f.detalle), "producto") : null,
    cantidad: Number(f.cantidad),
    total: Number(f.total),
    ...leerMargen(f),
  }));
}

export async function reporteDeVentas(
  corte: CorteDelReporte,
  periodo: Periodo,
  filtros: FiltrosDeReporte = {},
): Promise<FilaDeReporte[]> {
  if (corte === "rubro") return ventasPorCategoria(periodo, filtros);
  if (corte === "elaboracion") return ventasPorElaboracion(periodo, filtros);
  if (corte === "cliente") return ventasPorCliente(periodo, filtros);
  if (corte === "vendedor") return ventasPorVendedor(periodo, filtros);
  if (corte === "sucursal") return ventasPorSucursal(periodo, filtros);
  if (corte === "canal") return ventasPorCanal(periodo, filtros);
  return ventasPorProducto(periodo, filtros);
}

/**
 * Lo vendido mes a mes, con los mismos filtros del reporte.
 *
 * **Es lo único que la tabla no puede contestar.** La tabla dice qué se vendió y
 * cuánto dejó; esto dice si el mes viene mejor o peor que los anteriores, que es
 * la pregunta que se hace mirando un reporte. Por eso se agregó un gráfico y no
 * otra columna: una serie de tiempo en una tabla se lee sumando de cabeza.
 *
 * Agrupa por mes calendario y devuelve los meses **sin ventas también**, en
 * cero: una serie con huecos se lee como si esos meses no existieran.
 */
export interface MesDelReporte {
  /** `2026-03`, para la clave del gráfico. */
  clave: string;
  /** "mar", como se rotula el eje. */
  etiqueta: string;
  total: number;
}

export async function ventasPorMes(
  periodo: Periodo,
  filtros: FiltrosDeReporte = {},
  meses = 6,
): Promise<MesDelReporte[]> {
  await requireStaff();

  const filas = await db
    .select({
      mes: sql<string>`to_char(date_trunc('month', ${orders.createdAt}), 'YYYY-MM')`,
      total: sql<string>`sum(${orders.total})`,
    })
    .from(orders)
    .where(enElPeriodo(periodo, filtros))
    .groupBy(sql`1`)
    .orderBy(sql`1`);

  const porMes = new Map(filas.map((f) => [f.mes, Number(f.total)]));

  // La serie se arma desde el calendario y no desde lo que trajo la consulta:
  // un mes sin ventas es un dato, y saltearlo dibuja una línea que miente.
  const hasta = periodo.hasta ?? new Date();
  const desde =
    periodo.desde ??
    new Date(hasta.getFullYear(), hasta.getMonth() - (meses - 1), 1);

  const serie: MesDelReporte[] = [];
  const cursor = new Date(desde.getFullYear(), desde.getMonth(), 1);

  while (cursor <= hasta && serie.length < 24) {
    const clave = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;

    serie.push({
      clave,
      etiqueta: cursor.toLocaleDateString("es-AR", { month: "short" }),
      total: porMes.get(clave) ?? 0,
    });

    cursor.setMonth(cursor.getMonth() + 1);
  }

  return serie;
}
