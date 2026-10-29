import "server-only";

import { and, asc, eq, gt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { posDevices } from "@/lib/db/schema";
import { api, datos } from "@/lib/api/servidor";

/**
 * Las máquinas que venden en el mostrador.
 *
 * Se administran desde el panel y no desde la máquina misma. Es la decisión de
 * fondo del módulo: **el código lo asigna el servidor**. Si cada navegador se
 * autobautiza, dos terminan llamándose `CAJA1`, y como el número provisorio se
 * imprime en el papel del cliente, dos personas distintas se van del local con
 * el mismo comprobante en la mano.
 *
 * Lo del panel lo lee la API de Go (backend/internal/caja/panel.go).
 */

export async function listarCajasFisicas() {
  const filas = datos(await (await api()).GET("/api/v1/admin/caja/cajas-fisicas"));
  return filas.map((c) => ({ ...c, ultimaVezAt: c.ultimaVezAt ? new Date(c.ultimaVezAt) : null }));
}

/** Cuánto vale la vida de un latido antes de considerar la caja apagada. */
const LATIDO_VIGENTE_MIN = 15;

/**
 * Las cajas de una sucursal que reportaron ventas sin subir.
 *
 * Ya está en Go (`caja.CajasConPendientes`); queda acá mientras el mostrador
 * (app/mostrador/actions.ts) no se mude, y se borra con él.
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
 * Ventas en efectivo que no cayeron en ningún turno: las que se cobraron sin
 * conexión mientras no había ninguna caja abierta. El trabajo que queda es
 * humano: decir a qué turno pertenece.
 */
export async function ventasSinCaja() {
  const filas = datos(await (await api()).GET("/api/v1/admin/caja/ventas-sueltas"));
  return filas.map((v) => ({
    ...v,
    cobradaAt: v.cobradaAt ? new Date(v.cobradaAt) : null,
    createdAt: new Date(v.createdAt),
  }));
}

/**
 * Los turnos a los que se puede mandar una venta suelta, con la etiqueta del
 * selector ya escrita en hora argentina.
 */
export async function turnosParaAsignar(branchId: string) {
  const filas = datos(
    await (await api()).GET("/api/v1/admin/caja/turnos-para-asignar", { params: { query: { sucursal: branchId } } }),
  );
  return filas.map((t) => ({
    ...t,
    abiertaAt: new Date(t.abiertaAt),
    cerradaAt: t.cerradaAt ? new Date(t.cerradaAt) : null,
  }));
}

/**
 * Qué emitió cada caja en el mes (`2026-03`, hora argentina), para poder
 * levantarlo desde otro equipo: por caja y por persona, con el número
 * provisorio que trae el cliente en el ticket.
 */
export async function emitidoPorCaja(periodo: string) {
  const filas = datos(await (await api()).GET("/api/v1/admin/caja/emitido", { params: { query: { periodo } } }));
  return filas.map((v) => ({ ...v, createdAt: new Date(v.createdAt) }));
}
