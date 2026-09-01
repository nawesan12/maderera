import { cache } from "react";
import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { branches, orderItems, orders } from "@/lib/db/schema";
import { getSession } from "@/lib/dal/session";
import { clienteDeLaSesion } from "@/lib/dal/cuenta";

/**
 * La página de seguimiento de un pedido.
 *
 * Es la única pantalla del sitio que muestra datos de una persona **sin exigir
 * sesión**, y tiene que ser así: la mayoría compra sin crearse cuenta, y el
 * enlace de la confirmación, el del correo y el de vuelta de Mercado Pago
 * tienen que abrir.
 *
 * Lo que autoriza no es el número —que es consecutivo, se dice por teléfono y
 * va en el remito— sino el token: quien tiene el enlace entra. Con el número
 * solo se llegaba a cualquier pedido recorriendo la secuencia, y con él salían
 * el nombre, el teléfono, la dirección de entrega y la compra entera.
 *
 * Hay un segundo camino: si la persona tiene sesión y el pedido es suyo, entra
 * sin token. Eso es lo que hace que un enlace viejo, de antes de que existiera
 * el token, siga funcionando para quien corresponde.
 */
/*
 * Memoizada por request: la pide el cuerpo de la página y también su
 * `generateMetadata`, que necesita saber si el pedido existe para no titular
 * "Pedido confirmado" una pantalla de no encontrado. Sin esto serían dos
 * consultas idénticas por carga.
 */
export const pedidoParaSeguimiento = cache(
  async (numero: string, token?: string) => {
    const [pedido] = await db
      .select({
        id: orders.id,
        numero: orders.numero,
        publicToken: orders.publicToken,
        customerId: orders.customerId,
        cliente: orders.contactoNombre,
        telefono: orders.contactoTelefono,
        tipoEntrega: orders.tipoEntrega,
        direccionEntrega: orders.direccionEntrega,
        zonaEnvio: orders.zonaEnvio,
        costoEnvio: orders.costoEnvio,
        subtotal: orders.subtotal,
        total: orders.total,
        medioPago: orders.medioPago,
        estadoPago: orders.estadoPago,
        estado: orders.estado,
        sucursal: branches.name,
        sucursalDireccion: branches.address,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .leftJoin(branches, eq(branches.id, orders.branchId))
      .where(eq(orders.numero, numero))
      .limit(1);

    if (!pedido) return null;

    // Comparación de longitud fija sobre dos uuid. No se usa el token en el
    // `where` para poder distinguir "no existe" de "no autorizado" y devolver lo
    // mismo en los dos casos: un 404 distinto confirmaría qué números existen.
    const conToken = Boolean(token) && token === pedido.publicToken;

    if (!conToken) {
      const sesion = await getSession();
      if (!sesion) return null;

      // El personal ve cualquiera: es su trabajo.
      if (sesion.role !== "staff") {
        const cliente = await clienteDeLaSesion();
        if (!cliente || pedido.customerId !== cliente.id) return null;
      }
    }

    const items = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, pedido.id))
      .orderBy(orderItems.orden);

    return { ...pedido, items };
  },
);

/**
 * Un pedido, solo si quien pregunta puede tocarlo.
 *
 * La usan las acciones que salen de la página de seguimiento: abrir el pago y
 * subir el comprobante de una transferencia. Las dos recibían el número y nada
 * más, heredando la suposición de que conocer el número era prueba suficiente
 * —la misma que hacía enumerable la página—. Con eso se le podía adjuntar un
 * comprobante inventado al pedido de cualquiera y dejarlo esperando que alguien
 * lo diera por bueno en la conciliación.
 *
 * Devuelve null tanto si el pedido no existe como si no corresponde: quien
 * prueba números no puede distinguir un caso del otro.
 */
export async function pedidoAutorizado(numero: string, token?: string) {
  const [pedido] = await db
    .select({
      id: orders.id,
      numero: orders.numero,
      publicToken: orders.publicToken,
      customerId: orders.customerId,
      total: orders.total,
      estadoPago: orders.estadoPago,
    })
    .from(orders)
    .where(eq(orders.numero, numero))
    .limit(1);

  if (!pedido) return null;

  if (token && token === pedido.publicToken) return pedido;

  const sesion = await getSession();
  if (!sesion) return null;
  if (sesion.role === "staff") return pedido;

  const cliente = await clienteDeLaSesion();
  if (!cliente || pedido.customerId !== cliente.id) return null;

  return pedido;
}

/** El token de un pedido, para armar el enlace desde donde solo se tiene el id. */
export async function tokenDelPedido(orderId: string): Promise<string | null> {
  const [fila] = await db
    .select({ token: orders.publicToken })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  return fila?.token ?? null;
}

/** Igual, pero por número: lo necesitan los avisos, que trabajan con el número. */
export async function tokenPorNumero(numero: string): Promise<string | null> {
  const [fila] = await db
    .select({ token: orders.publicToken })
    .from(orders)
    .where(and(eq(orders.numero, numero)))
    .limit(1);

  return fila?.token ?? null;
}
