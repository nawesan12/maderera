import "server-only";

import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  branches,
  customers,
  cuttingOrders,
  inventory,
  orders,
  productVariants,
  products,
  quotes,
} from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";
import { resolverPeriodo, type Periodo } from "@/lib/periodos";

/** Primer día del mes, hace `atras` meses. */
function inicioDeMes(atras = 0) {
  const fecha = new Date();
  fecha.setMonth(fecha.getMonth() - atras, 1);
  fecha.setHours(0, 0, 0, 0);
  return fecha;
}

const MESES = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
];

/**
 * Números del resumen, calculados de la base.
 *
 * Las ventas cuentan pedidos no cancelados: un pedido cancelado nunca fue una
 * venta, y dejarlo sumando infla el mes sin que se note.
 */
export async function metricasDelResumen(periodo?: Periodo) {
  await requireStaff();

  /*
   * El período llega de la pantalla. Antes estaba clavado en "este mes" y la
   * cabecera lo decía, pero no había forma de mirar otro: para saber cómo
   * cerró el mes pasado había que esperar al primero del siguiente.
   *
   * La comparación es contra el mismo lapso anterior —mes contra mes, año
   * contra año—, no contra treinta días fijos. Ver `lib/periodos.ts`.
   */
  const rango = periodo ?? resolverPeriodo("mes");
  const desdeEsteMes = rango.desde;
  const hastaEsteMes = rango.hasta;
  const noCancelado = sql`${orders.estado} <> 'cancelado'`;

  const enElPeriodo = and(
    desdeEsteMes ? gte(orders.createdAt, desdeEsteMes) : undefined,
    hastaEsteMes ? sql`${orders.createdAt} < ${hastaEsteMes}` : undefined,
    noCancelado,
  );

  const enElAnterior = rango.anterior
    ? and(
        gte(orders.createdAt, rango.anterior.desde),
        sql`${orders.createdAt} < ${rango.anterior.hasta}`,
        noCancelado,
      )
    : sql`false`;

  /*
   * Cuatro consultas y no ocho.
   *
   * Las que tocaban la misma tabla se juntaron con `filter`: Postgres la
   * recorre una vez y devuelve todas las columnas. Antes eran dos sumas sobre
   * `orders` —el período y el anterior—, dos conteos sobre `quotes` y dos más
   * sobre `orders`, cada una con su viaje y su conexión del pool. El resumen es
   * la pantalla que más se abre del panel: es la primera que ve cada persona
   * cada mañana.
   */
  const [pedidosAgregado, presupuestosAgregado, clientesActivos, reposicion] =
    await Promise.all([
      db
        .select({
          ventasPeriodo: sql<string>`coalesce(sum(${orders.total}) filter (where ${enElPeriodo}), 0)`,
          ventasAnterior: sql<string>`coalesce(sum(${orders.total}) filter (where ${enElAnterior}), 0)`,
          sinEntregar: sql<number>`(count(*) filter (where ${orders.estado} not in ('entregado', 'cancelado')))::int`,
          // Clientes **distintos** con al menos un pedido en curso. No es lo
          // mismo que la cantidad de pedidos sin entregar: uno solo puede tener
          // tres, y partir la tarjeta de clientes con ese número diría algo
          // falso.
          clientesConPedido: sql<number>`(count(distinct ${orders.customerId}) filter (where ${orders.estado} not in ('entregado', 'cancelado') and ${orders.customerId} is not null))::int`,
        })
        .from(orders),
      db
        .select({
          abiertos: sql<number>`(count(*) filter (where ${quotes.estado} in ('pendiente', 'revision', 'enviado')))::int`,
          enRevision: sql<number>`(count(*) filter (where ${quotes.estado} = 'revision'))::int`,
        })
        .from(quotes),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(customers)
        .where(eq(customers.active, true)),
      db
        .select({
          branchSlug: branches.slug,
          n: sql<number>`count(*)::int`,
        })
        .from(inventory)
        .innerJoin(productVariants, eq(productVariants.id, inventory.variantId))
        .innerJoin(products, eq(products.id, productVariants.productId))
        .innerJoin(branches, eq(branches.id, inventory.branchId))
        .where(
          and(
            eq(products.active, true),
            eq(productVariants.active, true),
            sql`${inventory.minQty} > 0`,
            sql`${inventory.qty} <= ${inventory.minQty}`,
          ),
        )
        .groupBy(branches.slug),
    ]);

  const actual = Number(pedidosAgregado[0]?.ventasPeriodo ?? 0);
  const previo = Number(pedidosAgregado[0]?.ventasAnterior ?? 0);
  const variacion =
    previo > 0 ? Math.round(((actual - previo) / previo) * 1000) / 10 : null;

  const reponerCentral =
    reposicion.find((r) => r.branchSlug === "casa-central")?.n ?? 0;
  const reponerAserradero =
    reposicion.find((r) => r.branchSlug === "aserradero")?.n ?? 0;

  return {
    ventasMes: actual,
    variacionVentas: variacion,
    presupuestosPendientes: presupuestosAgregado[0]?.abiertos ?? 0,
    presupuestosRevision: presupuestosAgregado[0]?.enRevision ?? 0,
    clientesActivos: clientesActivos[0]?.n ?? 0,
    reponer: reponerCentral + reponerAserradero,
    reponerCentral,
    reponerAserradero,
    pedidosSinEntregar: pedidosAgregado[0]?.sinEntregar ?? 0,
    clientesConPedido: pedidosAgregado[0]?.clientesConPedido ?? 0,
  };
}

/** Ventas por sucursal de los últimos seis meses, para el gráfico. */
export async function ventasPorSucursal() {
  await requireStaff();

  const desde = inicioDeMes(5);

  const filas = await db
    .select({
      mes: sql<string>`to_char(${orders.createdAt}, 'YYYY-MM')`,
      branchSlug: branches.slug,
      total: sql<string>`sum(${orders.total})`,
    })
    .from(orders)
    .leftJoin(branches, eq(branches.id, orders.branchId))
    .where(
      and(gte(orders.createdAt, desde), sql`${orders.estado} <> 'cancelado'`),
    )
    .groupBy(sql`to_char(${orders.createdAt}, 'YYYY-MM')`, branches.slug)
    .orderBy(sql`to_char(${orders.createdAt}, 'YYYY-MM')`);

  // Se arman los seis meses aunque alguno no tenga ventas: un hueco en el eje
  // haría parecer que ese mes no existió.
  const meses: { mes: string; central: number; aserradero: number }[] = [];

  for (let i = 5; i >= 0; i--) {
    const fecha = inicioDeMes(i);
    const clave = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}`;

    meses.push({
      mes: MESES[fecha.getMonth()],
      central: Number(
        filas.find((f) => f.mes === clave && f.branchSlug === "casa-central")
          ?.total ?? 0,
      ),
      aserradero: Number(
        filas.find((f) => f.mes === clave && f.branchSlug === "aserradero")
          ?.total ?? 0,
      ),
    });
  }

  return meses;
}

/** Lo que hay que reponer, con su sucursal. */
export async function stockParaReponer(limite = 5) {
  await requireStaff();

  return db
    .select({
      variantId: productVariants.id,
      producto: products.name,
      medida: productVariants.label,
      sucursal: branches.name,
      qty: inventory.qty,
      minQty: inventory.minQty,
    })
    .from(inventory)
    .innerJoin(productVariants, eq(productVariants.id, inventory.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(branches, eq(branches.id, inventory.branchId))
    .where(
      and(
        eq(products.active, true),
        eq(productVariants.active, true),
        sql`${inventory.minQty} > 0`,
        sql`${inventory.qty} <= ${inventory.minQty}`,
      ),
    )
    .orderBy(sql`${inventory.qty}::float / nullif(${inventory.minQty}, 0)`)
    .limit(limite);
}

/** Últimos presupuestos y pedidos, para las listas del resumen. */
export async function actividadReciente() {
  await requireStaff();

  const [ultimosPresupuestos, ultimosPedidos, cortesEnCola] = await Promise.all([
    db
      .select({
        id: quotes.id,
        numero: quotes.numero,
        cliente: quotes.contactoNombre,
        estado: quotes.estado,
        total: quotes.total,
        createdAt: quotes.createdAt,
      })
      .from(quotes)
      .orderBy(desc(quotes.createdAt))
      .limit(5),
    db
      .select({
        id: orders.id,
        numero: orders.numero,
        cliente: orders.contactoNombre,
        estado: orders.estado,
        tipoEntrega: orders.tipoEntrega,
        total: orders.total,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .where(sql`${orders.estado} not in ('entregado', 'cancelado')`)
      .orderBy(desc(orders.createdAt))
      .limit(5),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(cuttingOrders)
      .where(sql`${cuttingOrders.estado} in ('en-cola', 'en-proceso')`),
  ]);

  return {
    presupuestos: ultimosPresupuestos,
    pedidos: ultimosPedidos,
    cortesEnCola: cortesEnCola[0]?.n ?? 0,
  };
}
