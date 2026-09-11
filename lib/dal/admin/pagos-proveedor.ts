import "server-only";

import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  purchaseInvoices,
  regimenesRetencion,
  retencionesPracticadas,
  supplierPayments,
  suppliers,
} from "@/lib/db/schema";
import { requireStaff, requireStaffRole } from "@/lib/dal/session";

/** Los pagos hechos, con lo retenido en cada uno. */
export async function listarPagosAProveedores(limite = 60) {
  await requireStaffRole("admin");

  const retenido = db
    .select({
      paymentId: retencionesPracticadas.paymentId,
      total: sql<string>`sum(${retencionesPracticadas.importe})`.as("retenido"),
      cantidad: sql<number>`count(*)::int`.as("certificados"),
      /*
       * Los números de los certificados, para poder bajarlos desde la tabla.
       *
       * La pantalla los contaba —"2 certificados"— y no daba forma de abrirlos,
       * aunque la ruta que los imprime existe: solo se enlazaba en el momento de
       * crear el pago. Después de cerrar esa pantalla, el PDF del comprobante
       * que el proveedor necesita para computarse la retención no se podía
       * volver a sacar de ningún lado.
       */
      numeros: sql<string[]>`array_agg(${retencionesPracticadas.numero} order by ${retencionesPracticadas.numero})`.as("numeros_certificado"),
    })
    .from(retencionesPracticadas)
    .groupBy(retencionesPracticadas.paymentId)
    .as("retenido");

  const filas = await db
    .select({
      id: supplierPayments.id,
      fecha: supplierPayments.fecha,
      total: supplierPayments.total,
      neto: supplierPayments.neto,
      medio: supplierPayments.medio,
      circuito: supplierPayments.circuito,
      referencia: supplierPayments.referencia,
      proveedor: suppliers.nombre,
      supplierId: supplierPayments.supplierId,
      retenido: retenido.total,
      certificados: retenido.cantidad,
      numerosCertificado: retenido.numeros,
    })
    .from(supplierPayments)
    .innerJoin(suppliers, eq(suppliers.id, supplierPayments.supplierId))
    .leftJoin(retenido, eq(retenido.paymentId, supplierPayments.id))
    .orderBy(desc(supplierPayments.fecha))
    .limit(limite);

  return filas.map((f) => ({
    ...f,
    total: Number(f.total),
    neto: Number(f.neto),
    retenido: Number(f.retenido ?? 0),
    certificados: Number(f.certificados ?? 0),
    numerosCertificado: f.numerosCertificado ?? [],
  }));
}

/** Los regímenes activos, para elegir al pagar. */
/**
 * Las facturas del proveedor con saldo por imputar.
 *
 * El saldo es lo facturado menos lo ya imputado en pagos anteriores. Es lo que
 * el formulario de pago muestra para responder "estoy pagando estas facturas",
 * que es como se paga de verdad: contra papeles, no contra un número global.
 */
export async function facturasConSaldo(supplierId: string) {
  await requireStaff();

  const filas = await db
    .select({
      id: purchaseInvoices.id,
      puntoVenta: purchaseInvoices.puntoVenta,
      numero: purchaseInvoices.numero,
      tipo: purchaseInvoices.tipo,
      fechaEmision: purchaseInvoices.fechaEmision,
      total: purchaseInvoices.total,
      imputado: sql<string>`coalesce((
        select sum(a.importe)
        from supplier_payment_allocations a
        where a.purchase_invoice_id = ${purchaseInvoices.id}
      ), 0)`,
    })
    .from(purchaseInvoices)
    .where(eq(purchaseInvoices.supplierId, supplierId))
    .orderBy(asc(purchaseInvoices.fechaEmision));

  return filas
    .map((f) => {
      const total = Number(f.total);
      const imputado = Number(f.imputado);
      return {
        id: f.id,
        // Como se lee en el papel: "0003-00001234".
        numero: `${String(f.puntoVenta).padStart(4, "0")}-${String(f.numero).padStart(8, "0")}`,
        tipo: f.tipo,
        fechaEmision: f.fechaEmision,
        total,
        imputado,
        saldo: Math.round((total - imputado) * 100) / 100,
      };
    })
    .filter((f) => f.saldo > 0.009);
}

export async function regimenesActivos() {
  await requireStaffRole("admin");

  return db
    .select()
    .from(regimenesRetencion)
    .where(eq(regimenesRetencion.activo, true))
    .orderBy(regimenesRetencion.codigo);
}

/**
 * Lo ya retenido a un proveedor en el mes, por régimen.
 *
 * La pantalla lo muestra antes de pagar: es lo que explica por qué esta vez se
 * retiene y la anterior no, que sin el acumulado a la vista parece arbitrario.
 */
export async function acumuladoDelMes(supplierId: string, ahora = new Date()) {
  await requireStaffRole("admin");

  const inicio = new Date(ahora.getFullYear(), ahora.getMonth(), 1);

  return db
    .select({
      codigoRegimen: retencionesPracticadas.codigoRegimen,
      base: sql<string>`sum(${retencionesPracticadas.base})`,
      retenido: sql<string>`sum(${retencionesPracticadas.importe})`,
    })
    .from(retencionesPracticadas)
    .where(
      and(
        eq(retencionesPracticadas.supplierId, supplierId),
        gte(retencionesPracticadas.fecha, inicio),
      ),
    )
    .groupBy(retencionesPracticadas.codigoRegimen);
}

/**
 * Un certificado con todo lo que hace falta para imprimirlo.
 *
 * Se busca **por número y no por id**: el número es lo que está impreso en el
 * papel y lo que el proveedor nombra por teléfono. Una dirección con el id
 * obligaría a buscarlo primero para poder reimprimir el papel que se tiene en
 * la mano.
 */
export async function certificadoParaImprimir(numero: string) {
  await requireStaffRole("admin");

  const [fila] = await db
    .select({
      numero: retencionesPracticadas.numero,
      fecha: retencionesPracticadas.fecha,
      impuesto: retencionesPracticadas.impuesto,
      codigoRegimen: retencionesPracticadas.codigoRegimen,
      nombreRegimen: regimenesRetencion.nombre,
      base: retencionesPracticadas.base,
      alicuota: retencionesPracticadas.alicuota,
      importe: retencionesPracticadas.importe,
      proveedorNombre: suppliers.nombre,
      proveedorRazonSocial: suppliers.razonSocial,
      proveedorCuit: suppliers.cuit,
      proveedorDomicilio: suppliers.direccion,
      pagoFecha: supplierPayments.fecha,
      pagoMedio: supplierPayments.medio,
      pagoReferencia: supplierPayments.referencia,
    })
    .from(retencionesPracticadas)
    .innerJoin(suppliers, eq(suppliers.id, retencionesPracticadas.supplierId))
    .innerJoin(
      supplierPayments,
      eq(supplierPayments.id, retencionesPracticadas.paymentId),
    )
    .leftJoin(
      regimenesRetencion,
      eq(regimenesRetencion.id, retencionesPracticadas.regimenId),
    )
    .where(eq(retencionesPracticadas.numero, numero))
    .limit(1);

  return fila ?? null;
}

/**
 * Las retenciones practicadas de un período, para el archivo del contador.
 *
 * Se exportan en **CSV plano y no en el layout SICORE**: SICORE es ancho fijo y
 * no se puede dar por bueno sin verificarlo contra el aplicativo real, que no
 * está en este entorno. Un archivo que el aplicativo rechaza es peor que no
 * tener archivo, porque se descubre el día del vencimiento.
 */
export async function retencionesDelPeriodo(desde: Date, hasta: Date) {
  await requireStaffRole("admin");

  return db
    .select({
      id: retencionesPracticadas.id,
      numero: retencionesPracticadas.numero,
      fecha: retencionesPracticadas.fecha,
      impuesto: retencionesPracticadas.impuesto,
      codigoRegimen: retencionesPracticadas.codigoRegimen,
      base: retencionesPracticadas.base,
      alicuota: retencionesPracticadas.alicuota,
      importe: retencionesPracticadas.importe,
      proveedor: suppliers.nombre,
      cuit: suppliers.cuit,
    })
    .from(retencionesPracticadas)
    .innerJoin(suppliers, eq(suppliers.id, retencionesPracticadas.supplierId))
    .where(
      and(
        gte(retencionesPracticadas.fecha, desde),
        sql`${retencionesPracticadas.fecha} <= ${hasta}`,
      ),
    )
    .orderBy(retencionesPracticadas.fecha, retencionesPracticadas.numero);
}
