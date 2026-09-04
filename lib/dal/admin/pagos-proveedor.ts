import "server-only";

import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  regimenesRetencion,
  retencionesPracticadas,
  supplierPayments,
  suppliers,
} from "@/lib/db/schema";
import { requireStaffRole } from "@/lib/dal/session";

/** Los pagos hechos, con lo retenido en cada uno. */
export async function listarPagosAProveedores(limite = 60) {
  await requireStaffRole("admin");

  const retenido = db
    .select({
      paymentId: retencionesPracticadas.paymentId,
      total: sql<string>`sum(${retencionesPracticadas.importe})`.as("retenido"),
      cantidad: sql<number>`count(*)::int`.as("certificados"),
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
      referencia: supplierPayments.referencia,
      proveedor: suppliers.nombre,
      supplierId: supplierPayments.supplierId,
      retenido: retenido.total,
      certificados: retenido.cantidad,
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
  }));
}

/** Los regímenes activos, para elegir al pagar. */
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
