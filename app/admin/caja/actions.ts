"use server";

import { revalidatePath } from "next/cache";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";

/*
 * Las acciones de la caja del panel. Las hace la API de Go
 * (backend/internal/caja/panel.go), con los mismos mensajes y la misma
 * bitácora; asignar una venta suelta bloquea el pedido, así dos clics a la vez
 * no meten dos veces el mismo efectivo en el turno.
 */

export interface EstadoCajas {
  error?: string;
  ok?: string;
}

function refrescar() {
  revalidatePath("/admin/caja");
  revalidatePath("/mostrador");
}

/**
 * Da de alta una máquina del mostrador. El código es el que sale impreso en
 * las ventas hechas sin conexión (`CAJA1-017`): se guarda en mayúsculas.
 */
export async function crearCaja(datos: {
  codigo: string;
  nombre?: string;
  branchId: string;
}): Promise<EstadoCajas> {
  const r = await (await api()).POST("/api/v1/admin/caja/cajas-fisicas", { body: { ...datos } });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "Revisá los datos.") };
  refrescar();
  return { ok: r.data.ok };
}

/**
 * Da de baja una caja. No se borra: sus ventas viejas siguen apuntando a un
 * número provisorio que lleva ese código.
 */
export async function darDeBajaCaja(id: string): Promise<EstadoCajas> {
  const r = await (await api()).POST("/api/v1/admin/caja/cajas-fisicas/{id}/baja", { params: { path: { id } } });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined) };
  refrescar();
  return { ok: r.data.ok };
}

/**
 * Mete una venta suelta en un turno: es una decisión humana —hay que saber en
 * qué cajón quedó ese efectivo— y por eso no se adivina sola.
 */
export async function asignarVentaAlTurno(orderId: string, sessionId: string): Promise<EstadoCajas> {
  const r = await (await api()).POST("/api/v1/admin/caja/ventas-sueltas/{id}/asignar", {
    params: { path: { id: orderId } },
    body: { sessionId },
  });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined) };
  refrescar();
  return { ok: r.data.ok };
}

/**
 * Fija el cambio que tiene que quedar en el cajón de una sucursal. Solo el
 * administrador.
 */
export async function guardarFondoBase(branchId: string, monto: number): Promise<EstadoCajas> {
  // Un NaN viajaría como null y Go lo leería como cero: se corta acá, como
  // lo cortaba zod.
  if (!Number.isFinite(monto)) {
    return { error: "Revisá el monto: tiene que ser un número de cero para arriba." };
  }
  const r = await (await api()).PUT("/api/v1/admin/caja/sucursales/{id}/fondo-base", {
    params: { path: { id: branchId } },
    body: { monto },
  });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined) };
  refrescar();
  return { ok: r.data.ok };
}
