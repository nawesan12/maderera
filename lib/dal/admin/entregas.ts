import "server-only";

import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  branches,
  deliveries,
  deliveryItems,
  orderItems,
  orders,
  shipments,
} from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";

/** Lectura de remitos para el panel. */

export interface RemitoListado {
  id: string;
  numero: string;
  tipo: string;
  estado: string;
  receptorNombre: string | null;
  firmadoAt: Date | null;
  firmaToken: string | null;
  createdAt: Date;
  transportista: string | null;
  numeroSeguimiento: string | null;
  cantidadLineas: number;
}

export async function remitosDelPedido(
  orderId: string,
): Promise<RemitoListado[]> {
  await requireStaff();

  const filas = await db
    .select({
      id: deliveries.id,
      numero: deliveries.numero,
      tipo: deliveries.tipo,
      estado: deliveries.estado,
      receptorNombre: deliveries.receptorNombre,
      firmadoAt: deliveries.firmadoAt,
      firmaToken: deliveries.firmaToken,
      createdAt: deliveries.createdAt,
      transportista: shipments.transportista,
      numeroSeguimiento: shipments.numeroSeguimiento,
    })
    .from(deliveries)
    .leftJoin(shipments, eq(shipments.deliveryId, deliveries.id))
    .where(eq(deliveries.orderId, orderId))
    .orderBy(desc(deliveries.createdAt));

  if (filas.length === 0) return [];

  const conteos = await db
    .select({
      deliveryId: deliveryItems.deliveryId,
      cantidad: deliveryItems.cantidad,
    })
    .from(deliveryItems);

  const porRemito = new Map<string, number>();
  for (const c of conteos) {
    porRemito.set(c.deliveryId, (porRemito.get(c.deliveryId) ?? 0) + 1);
  }

  return filas.map((f) => ({
    ...f,
    cantidadLineas: porRemito.get(f.id) ?? 0,
  }));
}

export interface RemitoCompleto {
  id: string;
  numero: string;
  tipo: string;
  estado: string;
  receptorNombre: string | null;
  receptorDocumento: string | null;
  firmaUrl: string | null;
  firmadoAt: Date | null;
  notas: string | null;
  createdAt: Date;
  pedidoNumero: string;
  pedidoId: string;
  clienteNombre: string;
  clienteDireccion: string | null;
  customerId: string | null;
  sucursal: string | null;
  sucursalDireccion: string | null;
  transportista: string | null;
  numeroSeguimiento: string | null;
  lineas: {
    descripcion: string;
    unidad: string;
    cantidad: number;
  }[];
}

/**
 * Un remito completo, para imprimirlo o mostrarlo.
 *
 * No verifica sesión: la usan tanto el panel como la página de firma —que es
 * pública a propósito, porque quien firma es el cliente en el mostrador— y la
 * hoja del portal. Cada una hace su propia verificación antes de llamarla; la
 * de firma la protege el token, que es lo único que se sabe.
 */
export async function remitoCompleto(
  deliveryId: string,
): Promise<RemitoCompleto | null> {
  const [remito] = await db
    .select({
      id: deliveries.id,
      numero: deliveries.numero,
      tipo: deliveries.tipo,
      estado: deliveries.estado,
      receptorNombre: deliveries.receptorNombre,
      receptorDocumento: deliveries.receptorDocumento,
      firmaUrl: deliveries.firmaUrl,
      firmadoAt: deliveries.firmadoAt,
      notas: deliveries.notas,
      createdAt: deliveries.createdAt,
      pedidoNumero: orders.numero,
      pedidoId: orders.id,
      clienteNombre: orders.contactoNombre,
      clienteDireccion: orders.direccionEntrega,
      customerId: orders.customerId,
      sucursal: branches.name,
      sucursalDireccion: branches.address,
      transportista: shipments.transportista,
      numeroSeguimiento: shipments.numeroSeguimiento,
    })
    .from(deliveries)
    .innerJoin(orders, eq(orders.id, deliveries.orderId))
    .leftJoin(branches, eq(branches.id, deliveries.branchId))
    .leftJoin(shipments, eq(shipments.deliveryId, deliveries.id))
    .where(eq(deliveries.id, deliveryId))
    .limit(1);

  if (!remito) return null;

  const lineas = await db
    .select({
      descripcion: orderItems.descripcion,
      unidad: orderItems.unidad,
      cantidad: deliveryItems.cantidad,
      orden: deliveryItems.orden,
    })
    .from(deliveryItems)
    .innerJoin(orderItems, eq(orderItems.id, deliveryItems.orderItemId))
    .where(eq(deliveryItems.deliveryId, deliveryId))
    .orderBy(deliveryItems.orden);

  return {
    ...remito,
    lineas: lineas.map((l) => ({
      descripcion: l.descripcion,
      unidad: l.unidad,
      cantidad: Number(l.cantidad),
    })),
  };
}

/** Remito buscado por su token de firma. Es lo único que conoce quien firma. */
export async function remitoPorToken(
  token: string,
): Promise<RemitoCompleto | null> {
  const [fila] = await db
    .select({ id: deliveries.id })
    .from(deliveries)
    .where(eq(deliveries.firmaToken, token))
    .limit(1);

  if (!fila) return null;

  return remitoCompleto(fila.id);
}
