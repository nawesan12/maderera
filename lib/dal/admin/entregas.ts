import "server-only";

import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { sucursalPublicada } from "@/lib/sucursales";
import { saldoAlRemito } from "@/lib/entregas";
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

  /*
   * Acotado a los remitos de este pedido.
   *
   * Antes traía **todas** las filas de `delivery_items` de la base y filtraba
   * en memoria: con un pedido de tres remitos alcanzaba, y con dos años de
   * operación la ficha de cualquier pedido empieza a barrer la tabla entera.
   */
  const conteos = await db
    .select({
      deliveryId: deliveryItems.deliveryId,
      cantidad: deliveryItems.cantidad,
    })
    .from(deliveryItems)
    .where(
      inArray(
        deliveryItems.deliveryId,
        filas.map((f) => f.id),
      ),
    );

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
  /** Del pedido: si lo que sale está pago, a cuenta o pendiente. */
  estadoPago: string;
  medioPago: string | null;
  sucursal: string | null;
  sucursalDireccion: string | null;
  transportista: string | null;
  numeroSeguimiento: string | null;
  lineas: {
    descripcion: string;
    unidad: string;
    cantidad: number;
  }[];
  /**
   * Lo que quedó en acopio en el momento de este remito.
   *
   * Es lo que convierte el papel en "remito completo" o "remito de acopio",
   * que fue el pedido de la clienta: quien lo recibe tiene que poder leer si
   * se lleva todo o si le queda mercadería en la maderera. Vacío: se entregó
   * el pedido entero.
   */
  pendientes: {
    descripcion: string;
    unidad: string;
    pendiente: number;
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
      // Si la mercadería que sale está paga o no: la clienta lo pidió en el
      // remito. Sin importes —eso va en la factura—, solo la condición.
      estadoPago: orders.estadoPago,
      medioPago: orders.medioPago,
      sucursal: branches.name,
      sucursalSlug: branches.slug,
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

  const [lineas, pendientes] = await Promise.all([
    db
      .select({
        descripcion: orderItems.descripcion,
        unidad: orderItems.unidad,
        cantidad: deliveryItems.cantidad,
        orden: deliveryItems.orden,
      })
      .from(deliveryItems)
      .innerJoin(orderItems, eq(orderItems.id, deliveryItems.orderItemId))
      .where(eq(deliveryItems.deliveryId, deliveryId))
      .orderBy(deliveryItems.orden),
    // Lo que quedaba **en ese momento**, no lo que queda hoy: un remito
    // reimpreso tiene que decir lo mismo que dijo el día que se firmó.
    saldoAlRemito(remito.pedidoId, deliveryId),
  ]);

  return {
    ...remito,
    // La dirección de la sucursal sale de la ficha publicada, no de la fila.
    sucursalDireccion: remito.sucursalSlug
      ? (sucursalPublicada(remito.sucursalSlug)?.direccion ?? null)
      : null,
    lineas: lineas.map((l) => ({
      descripcion: l.descripcion,
      unidad: l.unidad,
      cantidad: Number(l.cantidad),
    })),
    pendientes: pendientes.map((p) => ({
      descripcion: p.descripcion,
      unidad: p.unidad,
      pendiente: p.pendiente,
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
