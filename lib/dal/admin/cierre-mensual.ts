import "server-only";

import { and, asc, eq, gte, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import {
  cashSessions,
  expenses,
  goodsReceipts,
  invoices,
  purchaseInvoices,
  retencionesPracticadas,
  retencionesSufridas,
  supplierPayments,
  suppliers,
} from "@/lib/db/schema";
import { requireStaffRole } from "@/lib/dal/session";
import {
  asientoDeCompra,
  asientoDeGasto,
  asientoDePagoAProveedor,
  asientoDeVenta,
  balancea,
  type Asiento,
} from "@/lib/contable/asientos";
import {
  daCreditoFiscal,
  nombreComprobanteCompra,
  numeroDeCompra,
} from "@/lib/fiscal/comprobantes-compra";
import {
  nombreComprobante,
  numeroFormateado,
  type TipoComprobante,
} from "@/lib/fiscal/comprobantes";

/**
 * El cierre del mes.
 *
 * Reúne en una sola pantalla lo que hasta acá estaba repartido en cinco, y
 * agrega lo único que el sistema no podía dar: **los asientos para que el
 * estudio los importe**.
 *
 * Lo que este módulo **no** hace, y conviene decirlo de frente: libro diario,
 * mayor, balance y plan de cuentas. Eso es contabilidad registrada y la lleva
 * el estudio con su sistema. Acá se construye la exportación.
 */

/** Los asientos del período, en orden de fecha. */
export async function asientosDelPeriodo(
  desde: Date,
  hasta: Date,
): Promise<Asiento[]> {
  await requireStaffRole("admin");

  /*
   * El mismo filtro de fechas para cuatro tablas distintas. El tipo es amplio
   * a propósito: cada columna es de una tabla y `gte` las tipa por tabla, lo
   * que obligaría a escribir el mismo `and` cuatro veces.
   */
  const enRango = (columna: PgColumn) =>
    and(gte(columna, desde), sql`${columna} <= ${hasta}`);

  const [ventas, compras, pagos, gastos] = await Promise.all([
    db
      .select({
        fecha: invoices.fechaEmision,
        tipo: invoices.tipo,
        puntoVenta: invoices.puntoVenta,
        numero: invoices.numero,
        cliente: invoices.receptorNombre,
        neto: invoices.neto,
        iva21: invoices.iva21,
        iva105: invoices.iva105,
        iva27: invoices.iva27,
        tributos: invoices.tributos,
        total: invoices.total,
      })
      .from(invoices)
      .where(
        and(
          enRango(invoices.fechaEmision),
          sql`${invoices.estado} <> 'borrador'`,
        ),
      )
      .orderBy(asc(invoices.fechaEmision)),

    db
      .select({
        fecha: purchaseInvoices.fechaEmision,
        tipo: purchaseInvoices.tipo,
        puntoVenta: purchaseInvoices.puntoVenta,
        numero: purchaseInvoices.numero,
        proveedor: suppliers.nombre,
        neto: purchaseInvoices.neto,
        iva21: purchaseInvoices.iva21,
        iva105: purchaseInvoices.iva105,
        iva27: purchaseInvoices.iva27,
        percepciones: purchaseInvoices.percepciones,
        total: purchaseInvoices.total,
      })
      .from(purchaseInvoices)
      .innerJoin(suppliers, eq(suppliers.id, purchaseInvoices.supplierId))
      .where(enRango(purchaseInvoices.fechaEmision))
      .orderBy(asc(purchaseInvoices.fechaEmision)),

    db
      .select({
        fecha: supplierPayments.fecha,
        proveedor: suppliers.nombre,
        referencia: supplierPayments.referencia,
        total: supplierPayments.total,
        neto: supplierPayments.neto,
        medio: supplierPayments.medio,
      })
      .from(supplierPayments)
      .innerJoin(suppliers, eq(suppliers.id, supplierPayments.supplierId))
      .where(enRango(supplierPayments.fecha))
      .orderBy(asc(supplierPayments.fecha)),

    db
      .select({
        fecha: expenses.fecha,
        descripcion: expenses.descripcion,
        categoria: expenses.categoria,
        importe: expenses.importe,
        medio: expenses.medio,
      })
      .from(expenses)
      .where(enRango(expenses.fecha))
      .orderBy(asc(expenses.fecha)),
  ]);

  const asientos: Asiento[] = [];

  for (const v of ventas) {
    asientos.push(
      asientoDeVenta({
        fecha: v.fecha,
        comprobante: `${nombreComprobante(v.tipo as TipoComprobante)} ${numeroFormateado(v.puntoVenta, v.numero)}`,
        cliente: v.cliente,
        neto: Number(v.neto),
        // Las tres alícuotas van a la misma cuenta: el estudio las separa por
        // el libro IVA, no por el asiento.
        iva: Number(v.iva21) + Number(v.iva105) + Number(v.iva27),
        tributos: Number(v.tributos),
        total: Number(v.total),
        esNotaDeCredito: v.tipo.startsWith("nota_credito"),
      }),
    );
  }

  for (const c of compras) {
    asientos.push(
      asientoDeCompra({
        fecha: c.fecha,
        comprobante: `${nombreComprobanteCompra(c.tipo)} ${numeroDeCompra(c.puntoVenta, c.numero)}`,
        proveedor: c.proveedor,
        neto: Number(c.neto),
        iva: Number(c.iva21) + Number(c.iva105) + Number(c.iva27),
        percepciones: Number(c.percepciones),
        total: Number(c.total),
        daCreditoFiscal: daCreditoFiscal(c.tipo),
        esNotaDeCredito: c.tipo.startsWith("nota_credito"),
      }),
    );
  }

  for (const p of pagos) {
    asientos.push(
      asientoDePagoAProveedor({
        fecha: p.fecha,
        proveedor: p.proveedor,
        referencia: p.referencia,
        total: Number(p.total),
        retenido: Number(p.total) - Number(p.neto),
        medio: p.medio,
      }),
    );
  }

  for (const g of gastos) {
    asientos.push(
      asientoDeGasto({
        fecha: g.fecha,
        descripcion: g.descripcion,
        categoria: g.categoria,
        importe: Number(g.importe),
        medio: g.medio,
      }),
    );
  }

  asientos.sort((a, b) => a.fecha.getTime() - b.fecha.getTime());

  return asientos;
}

/**
 * Lo que conviene resolver antes de cerrar.
 *
 * No bloquea nada: es una lista de cosas que, si quedan así, el estudio va a
 * preguntar. Una recepción en borrador es mercadería que entró y no está
 * valorizada; una caja sin cerrar es efectivo sin arquear.
 */
export interface PendienteDelCierre {
  clave: string;
  titulo: string;
  detalle: string;
  cantidad: number;
  donde: string;
}

export async function pendientesDelCierre(
  desde: Date,
  hasta: Date,
): Promise<PendienteDelCierre[]> {
  await requireStaffRole("admin");

  const [borradores, cajas, sinFactura] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(goodsReceipts)
      .where(
        and(
          eq(goodsReceipts.estado, "borrador"),
          gte(goodsReceipts.fecha, desde),
          sql`${goodsReceipts.fecha} <= ${hasta}`,
        ),
      ),

    db
      .select({ n: sql<number>`count(*)::int` })
      .from(cashSessions)
      .where(
        and(
          eq(cashSessions.estado, "abierta"),
          sql`${cashSessions.abiertaAt} <= ${hasta}`,
        ),
      ),

    /*
     * Recepciones confirmadas sin factura de compra cargada. Es mercadería que
     * entró al depósito y cuyo IVA todavía no se computó: el crédito fiscal del
     * mes está incompleto hasta que llegue el papel.
     */
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(goodsReceipts)
      .where(
        and(
          eq(goodsReceipts.estado, "confirmada"),
          gte(goodsReceipts.fecha, desde),
          sql`${goodsReceipts.fecha} <= ${hasta}`,
          sql`not exists (
            select 1 from ${purchaseInvoices}
            where ${purchaseInvoices.receiptId} = ${goodsReceipts.id}
          )`,
        ),
      ),
  ]);

  const pendientes: PendienteDelCierre[] = [];

  if (Number(borradores[0]?.n ?? 0) > 0) {
    pendientes.push({
      clave: "recepciones",
      titulo: "Recepciones en borrador",
      detalle:
        "Mercadería que entró y todavía no movió stock ni costo. El margen del mes sale incompleto.",
      cantidad: Number(borradores[0].n),
      donde: "/admin/recepciones",
    });
  }

  if (Number(cajas[0]?.n ?? 0) > 0) {
    pendientes.push({
      clave: "caja",
      titulo: "Turnos de caja sin cerrar",
      detalle: "Efectivo sin arquear: la diferencia del mes no se puede calcular.",
      cantidad: Number(cajas[0].n),
      donde: "/admin/caja",
    });
  }

  if (Number(sinFactura[0]?.n ?? 0) > 0) {
    pendientes.push({
      clave: "facturas",
      titulo: "Recepciones sin factura de compra",
      detalle:
        "Entró la mercadería pero falta el papel: ese IVA todavía no se computa como crédito.",
      cantidad: Number(sinFactura[0].n),
      donde: "/admin/compras/facturas",
    });
  }

  return pendientes;
}

/** Los números del mes, todos juntos. */
export async function resumenDelMes(desde: Date, hasta: Date) {
  await requireStaffRole("admin");

  const [ventas, compras, gastos, practicadas, sufridas] = await Promise.all([
    db
      .select({
        neto: sql<string>`coalesce(sum(case when ${invoices.tipo}::text like 'nota_credito%' then -1 else 1 end * ${invoices.neto}), 0)`,
        iva: sql<string>`coalesce(sum(case when ${invoices.tipo}::text like 'nota_credito%' then -1 else 1 end * (${invoices.iva21} + ${invoices.iva105} + ${invoices.iva27})), 0)`,
        total: sql<string>`coalesce(sum(case when ${invoices.tipo}::text like 'nota_credito%' then -1 else 1 end * ${invoices.total}), 0)`,
        cantidad: sql<number>`count(*)::int`,
      })
      .from(invoices)
      .where(
        and(
          gte(invoices.fechaEmision, desde),
          sql`${invoices.fechaEmision} <= ${hasta}`,
          sql`${invoices.estado} <> 'borrador'`,
        ),
      ),

    db
      .select({
        neto: sql<string>`coalesce(sum(case when ${purchaseInvoices.tipo}::text like 'nota_credito%' then -1 else 1 end * ${purchaseInvoices.neto}), 0)`,
        /* Solo el de los comprobantes que discriminan IVA: la B y la C no dan
           crédito aunque tengan un importe cargado. */
        ivaComputable: sql<string>`coalesce(sum(case when ${purchaseInvoices.tipo}::text like 'nota_credito%' then -1 else 1 end * (${purchaseInvoices.iva21} + ${purchaseInvoices.iva105} + ${purchaseInvoices.iva27})) filter (where ${purchaseInvoices.tipo}::text in ('factura_a','factura_m','nota_credito_a','nota_debito_a')), 0)`,
        total: sql<string>`coalesce(sum(case when ${purchaseInvoices.tipo}::text like 'nota_credito%' then -1 else 1 end * ${purchaseInvoices.total}), 0)`,
        cantidad: sql<number>`count(*)::int`,
      })
      .from(purchaseInvoices)
      .where(
        and(
          gte(purchaseInvoices.fechaEmision, desde),
          sql`${purchaseInvoices.fechaEmision} <= ${hasta}`,
        ),
      ),

    db
      .select({
        total: sql<string>`coalesce(sum(${expenses.importe}), 0)`,
        cantidad: sql<number>`count(*)::int`,
      })
      .from(expenses)
      .where(
        and(gte(expenses.fecha, desde), sql`${expenses.fecha} <= ${hasta}`),
      ),

    db
      .select({
        total: sql<string>`coalesce(sum(${retencionesPracticadas.importe}), 0)`,
        cantidad: sql<number>`count(*)::int`,
      })
      .from(retencionesPracticadas)
      .where(
        and(
          gte(retencionesPracticadas.fecha, desde),
          sql`${retencionesPracticadas.fecha} <= ${hasta}`,
        ),
      ),

    db
      .select({
        total: sql<string>`coalesce(sum(${retencionesSufridas.importe}), 0)`,
        cantidad: sql<number>`count(*)::int`,
      })
      .from(retencionesSufridas)
      .where(
        and(
          gte(retencionesSufridas.fecha, desde),
          sql`${retencionesSufridas.fecha} <= ${hasta}`,
        ),
      ),
  ]);

  const debito = Number(ventas[0]?.iva ?? 0);
  const credito = Number(compras[0]?.ivaComputable ?? 0);

  return {
    ventas: {
      neto: Number(ventas[0]?.neto ?? 0),
      iva: debito,
      total: Number(ventas[0]?.total ?? 0),
      cantidad: Number(ventas[0]?.cantidad ?? 0),
    },
    compras: {
      neto: Number(compras[0]?.neto ?? 0),
      iva: credito,
      total: Number(compras[0]?.total ?? 0),
      cantidad: Number(compras[0]?.cantidad ?? 0),
    },
    gastos: {
      total: Number(gastos[0]?.total ?? 0),
      cantidad: Number(gastos[0]?.cantidad ?? 0),
    },
    retencionesPracticadas: {
      total: Number(practicadas[0]?.total ?? 0),
      cantidad: Number(practicadas[0]?.cantidad ?? 0),
    },
    retencionesSufridas: {
      total: Number(sufridas[0]?.total ?? 0),
      cantidad: Number(sufridas[0]?.cantidad ?? 0),
    },
    /** Positivo: hay que depositar. Negativo: queda saldo a favor. */
    posicionIva: debito - credito,
  };
}

/** Cuántos asientos no cierran. Debería ser siempre cero. */
export function asientosDesbalanceados(asientos: Asiento[]): Asiento[] {
  return asientos.filter((a) => !balancea(a));
}
