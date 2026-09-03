import "server-only";

import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { purchaseInvoices, suppliers } from "@/lib/db/schema";
import { requireStaffRole } from "@/lib/dal/session";

/**
 * Libro IVA compras.
 *
 * Espejo exacto del de ventas, con una diferencia de fondo: allá el IVA es
 * **débito** —lo que se le cobró al cliente y hay que depositar— y acá es
 * **crédito** —lo que se pagó al proveedor y se descuenta—. La posición del mes
 * es la resta de los dos, y por eso los dos tienen que estar armados igual.
 *
 * Las notas de crédito van en negativo, como en ventas: así la columna se suma
 * de arriba abajo y da directamente lo que se declara, sin restar a mano.
 */

export interface RenglonLibroCompras {
  id: string;
  fechaEmision: Date;
  tipo: string;
  puntoVenta: number;
  numero: number;
  proveedor: string;
  cuit: string | null;
  neto: number;
  iva21: number;
  iva105: number;
  iva27: number;
  exento: number;
  percepciones: number;
  total: number;
  cae: string | null;
}

export async function libroIvaCompras(desde: Date, hasta: Date) {
  await requireStaffRole("admin");

  const filas = await db
    .select({
      id: purchaseInvoices.id,
      fechaEmision: purchaseInvoices.fechaEmision,
      tipo: purchaseInvoices.tipo,
      puntoVenta: purchaseInvoices.puntoVenta,
      numero: purchaseInvoices.numero,
      proveedor: suppliers.nombre,
      cuit: suppliers.cuit,
      neto: purchaseInvoices.neto,
      iva21: purchaseInvoices.iva21,
      iva105: purchaseInvoices.iva105,
      iva27: purchaseInvoices.iva27,
      exento: purchaseInvoices.exento,
      percepciones: purchaseInvoices.percepciones,
      total: purchaseInvoices.total,
      cae: purchaseInvoices.cae,
    })
    .from(purchaseInvoices)
    .innerJoin(suppliers, eq(suppliers.id, purchaseInvoices.supplierId))
    .where(
      and(
        gte(purchaseInvoices.fechaEmision, desde),
        sql`${purchaseInvoices.fechaEmision} <= ${hasta}`,
      ),
    )
    .orderBy(asc(purchaseInvoices.fechaEmision), asc(purchaseInvoices.numero));

  const conSigno: RenglonLibroCompras[] = filas.map((f) => {
    const signo = f.tipo.startsWith("nota_credito") ? -1 : 1;
    return {
      ...f,
      neto: signo * Number(f.neto),
      iva21: signo * Number(f.iva21),
      iva105: signo * Number(f.iva105),
      iva27: signo * Number(f.iva27),
      exento: signo * Number(f.exento),
      percepciones: signo * Number(f.percepciones),
      total: signo * Number(f.total),
    };
  });

  const totales = conSigno.reduce(
    (a, f) => ({
      neto: a.neto + f.neto,
      iva21: a.iva21 + f.iva21,
      iva105: a.iva105 + f.iva105,
      iva27: a.iva27 + f.iva27,
      exento: a.exento + f.exento,
      percepciones: a.percepciones + f.percepciones,
      total: a.total + f.total,
    }),
    {
      neto: 0,
      iva21: 0,
      iva105: 0,
      iva27: 0,
      exento: 0,
      percepciones: 0,
      total: 0,
    },
  );

  return { filas: conSigno, totales };
}

/** Las facturas de compra cargadas, para el listado del panel. */
export async function listarFacturasDeCompra(limite = 60) {
  await requireStaffRole("admin");

  return db
    .select({
      id: purchaseInvoices.id,
      tipo: purchaseInvoices.tipo,
      puntoVenta: purchaseInvoices.puntoVenta,
      numero: purchaseInvoices.numero,
      fechaEmision: purchaseInvoices.fechaEmision,
      fechaVencimiento: purchaseInvoices.fechaVencimiento,
      proveedor: suppliers.nombre,
      supplierId: purchaseInvoices.supplierId,
      neto: purchaseInvoices.neto,
      total: purchaseInvoices.total,
    })
    .from(purchaseInvoices)
    .innerJoin(suppliers, eq(suppliers.id, purchaseInvoices.supplierId))
    .orderBy(desc(purchaseInvoices.fechaEmision))
    .limit(limite);
}
