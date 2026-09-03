import "server-only";

import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  branches,
  cashMovements,
  cashSessions,
  orders,
  posDevices,
} from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";

/**
 * Las máquinas que venden en el mostrador.
 *
 * Se administran desde el panel y no desde la máquina misma. Es la decisión de
 * fondo del módulo: **el código lo asigna el servidor**. Si cada navegador se
 * autobautiza, dos terminan llamándose `CAJA1`, y como el número provisorio se
 * imprime en el papel del cliente, dos personas distintas se van del local con
 * el mismo comprobante en la mano.
 */

/** Cuánto vale la vida de un latido antes de considerar la caja apagada. */
const LATIDO_VIGENTE_MIN = 15;

export async function listarCajasFisicas() {
  await requireStaff();

  return db
    .select({
      id: posDevices.id,
      codigo: posDevices.codigo,
      nombre: posDevices.nombre,
      branchId: posDevices.branchId,
      sucursal: branches.name,
      activo: posDevices.activo,
      ultimaVezAt: posDevices.ultimaVezAt,
      pendientes: posDevices.pendientes,
    })
    .from(posDevices)
    .leftJoin(branches, eq(branches.id, posDevices.branchId))
    .orderBy(asc(posDevices.codigo));
}

/**
 * Da de alta una caja y devuelve su secreto.
 *
 * El secreto se muestra **una sola vez**, al vincular: no autoriza nada por sí
 * solo —la sesión sigue decidiendo quién entra— pero es lo que impide que una
 * máquina se apropie del contador de otra.
 */
export async function crearCajaFisica(datos: {
  codigo: string;
  nombre: string | null;
  branchId: string | null;
}) {
  const codigo = datos.codigo.trim().toUpperCase();

  const [creada] = await db
    .insert(posDevices)
    .values({
      codigo,
      nombre: datos.nombre?.trim() || null,
      branchId: datos.branchId,
      secreto: randomBytes(24).toString("base64url"),
    })
    .returning({ id: posDevices.id, secreto: posDevices.secreto });

  return { id: creada.id, codigo, secreto: creada.secreto };
}

/**
 * Las cajas de una sucursal que reportaron ventas sin subir.
 *
 * Es lo que permite que el cierre de turno avise "CAJA1 tiene 4 ventas sin
 * subir" en vez de cerrar con una diferencia que va a aparecer sola media hora
 * después, cuando ya nadie sepa de dónde salió.
 *
 * Solo cuentan las cajas que dieron señales de vida hace poco: una máquina
 * apagada hace tres semanas con un pendiente colgado no puede bloquear el
 * cierre de todas las noches.
 */
export async function cajasConPendientes(branchId: string) {
  return db
    .select({
      codigo: posDevices.codigo,
      pendientes: posDevices.pendientes,
      ultimaVezAt: posDevices.ultimaVezAt,
    })
    .from(posDevices)
    .where(
      and(
        eq(posDevices.branchId, branchId),
        eq(posDevices.activo, true),
        gt(posDevices.pendientes, 0),
        sql`${posDevices.ultimaVezAt} > now() - interval '${sql.raw(String(LATIDO_VIGENTE_MIN))} minutes'`,
      ),
    )
    .orderBy(asc(posDevices.codigo));
}

/**
 * Ventas en efectivo que no cayeron en ningún turno.
 *
 * Solo pueden ser las que se cobraron sin conexión mientras no había ninguna
 * caja abierta. La venta se guardó igual —la plata se cobró y la mercadería se
 * fue— y el trabajo que queda es humano: decir a qué turno pertenece. Mientras
 * tanto están acá, que es mucho mejor que estar en ningún lado.
 */
export async function ventasSinCaja() {
  await requireStaff();

  const filas = await db
    .select({
      id: orders.id,
      numero: orders.numero,
      numeroProvisorio: orders.numeroProvisorio,
      branchId: orders.branchId,
      sucursal: branches.name,
      cliente: orders.contactoNombre,
      total: orders.total,
      cobradaAt: orders.cobradaAt,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .leftJoin(branches, eq(branches.id, orders.branchId))
    .leftJoin(cashMovements, eq(cashMovements.orderId, orders.id))
    .where(
      and(
        eq(orders.medioPago, "efectivo"),
        eq(orders.origen, "mostrador"),
        sql`${orders.estado} <> 'cancelado'`,
        // Solo las diferidas: una venta en línea sin turno no existe, porque
        // `registrarVentaDeMostrador` la habría rechazado.
        sql`${orders.cobradaAt} is not null`,
        isNull(cashMovements.id),
      ),
    )
    .orderBy(desc(orders.cobradaAt))
    .limit(50);

  /*
   * `orders.branchId` es opcional en el esquema porque un pedido web puede
   * nacer sin sucursal asignada. Uno de mostrador nunca: se cobró en un lugar
   * físico. El filtro deja el tipo limpio para quien lo dibuja.
   */
  return filas.filter(
    (v): v is typeof v & { branchId: string } => v.branchId !== null,
  );
}

/** Los turnos a los que se puede mandar una venta suelta. */
export async function turnosParaAsignar(branchId: string) {
  return db
    .select({
      id: cashSessions.id,
      abiertaAt: cashSessions.abiertaAt,
      cerradaAt: cashSessions.cerradaAt,
      estado: cashSessions.estado,
    })
    .from(cashSessions)
    .where(eq(cashSessions.branchId, branchId))
    .orderBy(desc(cashSessions.abiertaAt))
    .limit(10);
}
