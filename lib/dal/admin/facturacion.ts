import "server-only";

import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { resolverPeriodo, type Periodo } from "@/lib/periodos";
import { db } from "@/lib/db";
import {
  branches,
  customers,
  invoiceItems,
  invoicePayments,
  invoiceTributos,
  invoices,
  puntosVenta,
} from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";
import { obtenerConfiguracionFiscal } from "@/lib/fiscal/emitir";
import { proveedorFiscal } from "@/lib/fiscal/proveedores";
import type { TipoComprobante } from "@/lib/fiscal/comprobantes";

/** Lectura de comprobantes. Solo personal de la empresa. */

export interface ComprobanteListado {
  id: string;
  tipo: TipoComprobante;
  puntoVenta: number;
  numero: number;
  estado: string;
  receptorNombre: string;
  receptorCuit: string | null;
  total: number;
  cobrado: number;
  cae: string | null;
  fechaEmision: Date;
  fechaVencimiento: Date | null;
}

export async function listarComprobantes(
  filtros: { estado?: string; desde?: Date } = {},
): Promise<ComprobanteListado[]> {
  await requireStaff();

  const condiciones = [];

  if (filtros.estado && filtros.estado !== "todos") {
    condiciones.push(
      eq(
        invoices.estado,
        filtros.estado as "borrador" | "emitida" | "autorizada" | "anulada" | "rechazada",
      ),
    );
  }
  if (filtros.desde) condiciones.push(gte(invoices.fechaEmision, filtros.desde));

  // Lo cobrado se suma acá y no se guarda en la factura: un saldo cacheado se
  // desincroniza en cuanto un cobro falla a mitad de camino, y esa diferencia
  // se descubre discutiendo con el cliente.
  const cobros = db
    .select({
      invoiceId: invoicePayments.invoiceId,
      cobrado: sql<string>`sum(${invoicePayments.monto})`.as("cobrado"),
    })
    .from(invoicePayments)
    .groupBy(invoicePayments.invoiceId)
    .as("cobros");

  const filas = await db
    .select({
      id: invoices.id,
      tipo: invoices.tipo,
      puntoVenta: invoices.puntoVenta,
      numero: invoices.numero,
      estado: invoices.estado,
      receptorNombre: invoices.receptorNombre,
      receptorCuit: invoices.receptorCuit,
      total: invoices.total,
      cobrado: cobros.cobrado,
      cae: invoices.cae,
      fechaEmision: invoices.fechaEmision,
      fechaVencimiento: invoices.fechaVencimiento,
    })
    .from(invoices)
    .leftJoin(cobros, eq(cobros.invoiceId, invoices.id))
    .where(condiciones.length > 0 ? and(...condiciones) : undefined)
    .orderBy(desc(invoices.fechaEmision), desc(invoices.numero))
    .limit(200);

  return filas.map((f) => ({
    ...f,
    tipo: f.tipo as TipoComprobante,
    total: Number(f.total),
    cobrado: Number(f.cobrado ?? 0),
  }));
}

/** Comprobante completo, con líneas, cobros y tributos. */
export async function obtenerComprobante(id: string) {
  await requireStaff();
  return leerComprobante(id);
}

/**
 * Lectura sin control de sesión, para reusar desde el portal del cliente.
 *
 * Quien la llame tiene que haber verificado antes de quién es el comprobante.
 * Es privada al módulo por eso mismo: no se exporta.
 */
async function leerComprobante(id: string) {
  const [comprobante] = await db
    .select({
      id: invoices.id,
      tipo: invoices.tipo,
      puntoVenta: invoices.puntoVenta,
      numero: invoices.numero,
      estado: invoices.estado,
      customerId: invoices.customerId,
      orderId: invoices.orderId,
      receptorNombre: invoices.receptorNombre,
      receptorCuit: invoices.receptorCuit,
      receptorCondicionIva: invoices.receptorCondicionIva,
      receptorDomicilio: invoices.receptorDomicilio,
      neto: invoices.neto,
      iva21: invoices.iva21,
      iva105: invoices.iva105,
      iva27: invoices.iva27,
      exento: invoices.exento,
      tributosTotal: invoices.tributos,
      total: invoices.total,
      cae: invoices.cae,
      caeVencimiento: invoices.caeVencimiento,
      observacionesArca: invoices.observacionesArca,
      comprobanteOrigenId: invoices.comprobanteOrigenId,
      /* Cuánto ya se acreditó y cuánto se debitó: es lo que decide si se puede
         emitir otra nota y por cuánto. */
      acreditado: invoices.acreditado,
      debitado: invoices.debitado,
      fechaEmision: invoices.fechaEmision,
      fechaVencimiento: invoices.fechaVencimiento,
      observaciones: invoices.observaciones,
      puntoVentaNombre: puntosVenta.nombre,
      sucursal: branches.name,
    })
    .from(invoices)
    .leftJoin(puntosVenta, eq(puntosVenta.id, invoices.puntoVentaId))
    .leftJoin(branches, eq(branches.id, puntosVenta.branchId))
    .where(eq(invoices.id, id))
    .limit(1);

  if (!comprobante) return null;

  const [items, cobros, tributos] = await Promise.all([
    db
      .select()
      .from(invoiceItems)
      .where(eq(invoiceItems.invoiceId, id))
      .orderBy(invoiceItems.orden),
    db
      .select()
      .from(invoicePayments)
      .where(eq(invoicePayments.invoiceId, id))
      .orderBy(desc(invoicePayments.fecha)),
    db
      .select()
      .from(invoiceTributos)
      .where(eq(invoiceTributos.invoiceId, id)),
  ]);

  const cobrado = cobros.reduce((suma, c) => suma + Number(c.monto), 0);

  return {
    ...comprobante,
    tipo: comprobante.tipo as TipoComprobante,
    items,
    cobros,
    tributos,
    cobrado,
    saldo: Number(comprobante.total) - cobrado,
  };
}

/** Comprobante propio del cliente que tiene la sesión abierta. */
export async function comprobanteDelCliente(
  id: string,
  customerId: string,
) {
  const comprobante = await leerComprobante(id);
  if (!comprobante || comprobante.customerId !== customerId) return null;
  return comprobante;
}

/** Números del mes, para la cabecera de la pantalla. */
export async function resumenFacturacion(periodo?: Periodo) {
  await requireStaff();

  // Sin período, el de siempre: este mes. El corte lo calcula `lib/periodos.ts`
  // y no cada pantalla por su cuenta, para que "este mes" signifique lo mismo
  // acá, en Cobros y en el Resumen.
  const rango = periodo ?? resolverPeriodo("mes");

  const [mes] = await db
    .select({
      cantidad: sql<number>`count(*)`,
      total: sql<string>`coalesce(sum(${invoices.total}), 0)`,
      iva: sql<string>`coalesce(sum(${invoices.iva21} + ${invoices.iva105} + ${invoices.iva27}), 0)`,
    })
    .from(invoices)
    .where(
      and(
        rango.desde ? gte(invoices.fechaEmision, rango.desde) : undefined,
        rango.hasta ? lt(invoices.fechaEmision, rango.hasta) : undefined,
        sql`${invoices.estado} <> 'anulada'`,
        sql`${invoices.tipo}::text not like 'nota_credito%'`,
      ),
    );

  const [pendientes] = await db
    .select({ cantidad: sql<number>`count(*)` })
    .from(invoices)
    .where(sql`${invoices.estado} in ('emitida', 'rechazada')`);

  return {
    cantidadMes: Number(mes?.cantidad ?? 0),
    totalMes: Number(mes?.total ?? 0),
    ivaMes: Number(mes?.iva ?? 0),
    pendientesDeAutorizar: Number(pendientes?.cantidad ?? 0),
  };
}

export async function listarPuntosVenta() {
  await requireStaff();

  return db
    .select({
      id: puntosVenta.id,
      numero: puntosVenta.numero,
      nombre: puntosVenta.nombre,
      modalidad: puntosVenta.modalidad,
      activo: puntosVenta.activo,
      branchId: puntosVenta.branchId,
      sucursal: branches.name,
    })
    .from(puntosVenta)
    .leftJoin(branches, eq(branches.id, puntosVenta.branchId))
    .orderBy(puntosVenta.numero);
}

/** Estado de la conexión con ARCA, para la sección tributaria. */
export async function estadoArca() {
  await requireStaff();
  return proveedorFiscal().estado();
}

export async function configuracionFiscalActual() {
  await requireStaff();
  return obtenerConfiguracionFiscal();
}

/**
 * Libro IVA ventas de un período.
 *
 * Es lo que pide el contador todos los meses. Se arma desde los comprobantes,
 * con las notas de crédito en negativo: así el total de la columna es lo que
 * hay que declarar, sin restar a mano.
 */
export async function libroIvaVentas(desde: Date, hasta: Date) {
  await requireStaff();

  const filas = await db
    .select({
      id: invoices.id,
      fechaEmision: invoices.fechaEmision,
      tipo: invoices.tipo,
      puntoVenta: invoices.puntoVenta,
      numero: invoices.numero,
      receptorNombre: invoices.receptorNombre,
      receptorCuit: invoices.receptorCuit,
      receptorCondicionIva: invoices.receptorCondicionIva,
      neto: invoices.neto,
      iva21: invoices.iva21,
      iva105: invoices.iva105,
      iva27: invoices.iva27,
      exento: invoices.exento,
      tributos: invoices.tributos,
      total: invoices.total,
      cae: invoices.cae,
      estado: invoices.estado,
    })
    .from(invoices)
    .where(
      and(
        gte(invoices.fechaEmision, desde),
        sql`${invoices.fechaEmision} <= ${hasta}`,
        sql`${invoices.estado} <> 'borrador'`,
      ),
    )
    .orderBy(invoices.fechaEmision, invoices.numero);

  // Una nota de crédito resta: se le da signo negativo acá para que sumar la
  // columna dé directamente lo que se declara.
  const conSigno = filas.map((f) => {
    const signo = f.tipo.startsWith("nota_credito") ? -1 : 1;

    return {
      ...f,
      tipo: f.tipo as TipoComprobante,
      neto: signo * Number(f.neto),
      iva21: signo * Number(f.iva21),
      iva105: signo * Number(f.iva105),
      iva27: signo * Number(f.iva27),
      exento: signo * Number(f.exento),
      tributos: signo * Number(f.tributos),
      total: signo * Number(f.total),
    };
  });

  const totales = conSigno.reduce(
    (acumulado, fila) => ({
      neto: acumulado.neto + fila.neto,
      iva21: acumulado.iva21 + fila.iva21,
      iva105: acumulado.iva105 + fila.iva105,
      iva27: acumulado.iva27 + fila.iva27,
      exento: acumulado.exento + fila.exento,
      tributos: acumulado.tributos + fila.tributos,
      total: acumulado.total + fila.total,
    }),
    { neto: 0, iva21: 0, iva105: 0, iva27: 0, exento: 0, tributos: 0, total: 0 },
  );

  return { filas: conSigno, totales };
}

/** Pedido listo para facturar, con sus ítems y la condición fiscal del cliente. */
export async function pedidoParaFacturar(orderId: string) {
  await requireStaff();

  const { orders, orderItems, productVariants, products } = await import(
    "@/lib/db/schema"
  );

  const [pedido] = await db
    .select({
      id: orders.id,
      numero: orders.numero,
      customerId: orders.customerId,
      contactoNombre: orders.contactoNombre,
      costoEnvio: orders.costoEnvio,
      zonaEnvio: orders.zonaEnvio,
      total: orders.total,
      clienteNombre: customers.nombre,
      clienteRazonSocial: customers.razonSocial,
      clienteCuit: customers.cuit,
      clienteCondicionIva: customers.condicionIva,
      clienteDireccion: customers.direccion,
    })
    .from(orders)
    .leftJoin(customers, eq(customers.id, orders.customerId))
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!pedido) return null;

  // La alícuota sale del producto: la madera va al 21 %, pero hay excepciones
  // y quedan cargadas en la ficha, no en la cabeza de quien factura.
  const items = await db
    .select({
      descripcion: orderItems.descripcion,
      unidad: orderItems.unidad,
      cantidad: orderItems.cantidad,
      precioUnitario: orderItems.precioUnitario,
      alicuota: products.alicuotaIva,
    })
    .from(orderItems)
    .leftJoin(productVariants, eq(productVariants.id, orderItems.variantId))
    .leftJoin(products, eq(products.id, productVariants.productId))
    .where(eq(orderItems.orderId, orderId))
    .orderBy(orderItems.orden);

  const [yaFacturado] = await db
    .select({ id: invoices.id, numero: invoices.numero, tipo: invoices.tipo })
    .from(invoices)
    .where(
      and(eq(invoices.orderId, orderId), sql`${invoices.estado} <> 'anulada'`),
    )
    .limit(1);

  return { pedido, items, yaFacturado: yaFacturado ?? null };
}
