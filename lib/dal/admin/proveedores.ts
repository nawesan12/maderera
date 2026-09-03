import "server-only";

import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { suppliers, supplierMovements } from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";
import { coincideBusqueda } from "@/lib/busqueda";

/**
 * Proveedores y lo que se les debe.
 *
 * **El signo va al revés que en clientes**: acá positivo es lo que *nosotros*
 * debemos. Es el espejo natural, pero es la clase de detalle que se copia mal
 * al reusar una consulta de cuenta corriente, y el resultado —un saldo con el
 * signo cambiado— igual parece razonable en la pantalla.
 *
 * Como allá, el saldo se suma y no se guarda.
 */

export interface ProveedorListado {
  id: string;
  nombre: string;
  razonSocial: string | null;
  cuit: string | null;
  rubro: string | null;
  contacto: string | null;
  telefono: string | null;
  email: string | null;
  diasPago: number;
  estado: "activo" | "inactivo";
  /** Positivo: le debemos. */
  saldo: number;
  ultimoMovimiento: Date | null;
}

export async function listarProveedores(
  filtros: { busqueda?: string; estado?: string } = {},
): Promise<ProveedorListado[]> {
  await requireStaff();

  const condiciones = [eq(suppliers.active, true)];

  if (filtros.estado && filtros.estado !== "todos") {
    condiciones.push(
      eq(suppliers.estado, filtros.estado as "activo" | "inactivo"),
    );
  }
  if (filtros.busqueda) {
    const coincidencia = coincideBusqueda(filtros.busqueda, [
      suppliers.nombre,
      suppliers.razonSocial,
      suppliers.cuit,
      suppliers.rubro,
      suppliers.contacto,
    ]);
    if (coincidencia) condiciones.push(coincidencia);
  }

  /*
   * El saldo como subconsulta agrupada, igual que en clientes: una sola pasada
   * por los movimientos para toda la lista. La alternativa —una consulta de
   * saldo por proveedor— es el N+1 que hace que la pantalla tarde dos segundos
   * el día que hay ochenta proveedores.
   */
  const saldos = db
    .select({
      supplierId: supplierMovements.supplierId,
      saldo: sql<string>`sum(${supplierMovements.monto})`.as("saldo"),
      ultimo: sql<Date>`max(${supplierMovements.createdAt})`.as("ultimo_mov"),
    })
    .from(supplierMovements)
    .groupBy(supplierMovements.supplierId)
    .as("saldos");

  const filas = await db
    .select({
      id: suppliers.id,
      nombre: suppliers.nombre,
      razonSocial: suppliers.razonSocial,
      cuit: suppliers.cuit,
      rubro: suppliers.rubro,
      contacto: suppliers.contacto,
      telefono: suppliers.telefono,
      email: suppliers.email,
      diasPago: suppliers.diasPago,
      estado: suppliers.estado,
      saldo: saldos.saldo,
      ultimoMovimiento: saldos.ultimo,
    })
    .from(suppliers)
    .leftJoin(saldos, eq(saldos.supplierId, suppliers.id))
    .where(and(...condiciones))
    .orderBy(asc(suppliers.nombre));

  return filas.map((f) => ({
    ...f,
    saldo: Number(f.saldo ?? 0),
    ultimoMovimiento: f.ultimoMovimiento ? new Date(f.ultimoMovimiento) : null,
  }));
}

/** La ficha completa, con el libro de la cuenta. */
export async function obtenerProveedor(id: string) {
  await requireStaff();

  const [proveedor] = await db
    .select()
    .from(suppliers)
    .where(eq(suppliers.id, id))
    .limit(1);

  if (!proveedor) return null;

  const movimientos = await db
    .select({
      id: supplierMovements.id,
      tipo: supplierMovements.tipo,
      monto: supplierMovements.monto,
      detalle: supplierMovements.detalle,
      referencia: supplierMovements.referencia,
      createdAt: supplierMovements.createdAt,
    })
    .from(supplierMovements)
    .where(eq(supplierMovements.supplierId, id))
    .orderBy(desc(supplierMovements.createdAt))
    .limit(200);

  /*
   * El saldo corriente de cada renglón se arma del más viejo al más nuevo y se
   * devuelve al revés. Sin eso el libro muestra los montos pero no permite
   * responder la única pregunta que se hace mirándolo: cuánto se le debía el
   * día de esa factura.
   */
  let acumulado = 0;
  const conSaldo = [...movimientos]
    .reverse()
    .map((m) => {
      acumulado += Number(m.monto);
      return { ...m, monto: Number(m.monto), saldo: acumulado };
    })
    .reverse();

  return {
    ...proveedor,
    diasPago: proveedor.diasPago,
    saldo: acumulado,
    movimientos: conSaldo,
  };
}

/** Para los selectores: nombre y poco más. */
export async function proveedoresParaElegir() {
  await requireStaff();

  return db
    .select({
      id: suppliers.id,
      nombre: suppliers.nombre,
      cuit: suppliers.cuit,
      condicionIva: suppliers.condicionIva,
      diasPago: suppliers.diasPago,
    })
    .from(suppliers)
    .where(and(eq(suppliers.active, true), eq(suppliers.estado, "activo")))
    .orderBy(asc(suppliers.nombre));
}
