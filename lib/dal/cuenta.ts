import "server-only";

import { cache } from "react";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  accountMovements,
  addresses,
  branches,
  customers,
  deliveries,
  invoices,
  orderItems,
  orderStatusHistory,
  orders,
  quoteItems,
  quotes,
} from "@/lib/db/schema";
import { getSession } from "@/lib/dal/session";
import { api, datos } from "@/lib/api/servidor";
import { saldoDeAcopio } from "@/lib/entregas";

/**
 * Portal del cliente.
 *
 * La regla de la casa, sin excepciones: el `customerId` sale de la sesión y
 * entra en el `where` de la consulta. Nunca llega por parámetro, y nunca se
 * verifica la propiedad después de traer la fila —eso ya sería haber leído
 * datos ajenos—. Un portal con cuentas corrientes de por medio no perdona
 * atajos.
 */

export interface ClienteDeSesion {
  id: string;
  nombre: string;
  razonSocial: string | null;
  cuit: string | null;
  condicionIva: string;
  email: string | null;
  telefono: string | null;
  direccion: string | null;
  tipo: "particular" | "profesional";
  estado: "activo" | "moroso" | "inactivo";
  limiteCredito: number;
}

/**
 * Ficha de cliente de quien tiene la sesión abierta.
 *
 * Devuelve null si esa persona todavía no tiene ficha: pasa con el personal, y
 * con cuentas creadas antes de que existiera el portal.
 */
export const clienteDeLaSesion = cache(
  async (): Promise<ClienteDeSesion | null> => {
    // `getSession()` y no `verifySession()`: el carrito también pregunta por la
    // ficha y ahí no hay que redirigir a nadie, porque se puede comprar sin
    // cuenta. Las pantallas del portal ya exigen la sesión en su layout.
    const sesion = await getSession();
    if (!sesion) return null;

    const [cliente] = await db
      .select({
        id: customers.id,
        nombre: customers.nombre,
        razonSocial: customers.razonSocial,
        cuit: customers.cuit,
        condicionIva: customers.condicionIva,
        email: customers.email,
        telefono: customers.telefono,
        direccion: customers.direccion,
        tipo: customers.tipo,
        estado: customers.estado,
        limiteCredito: customers.limiteCredito,
      })
      .from(customers)
      .where(and(eq(customers.userId, sesion.userId), eq(customers.active, true)))
      .limit(1);

    if (!cliente) return null;

    return { ...cliente, limiteCredito: Number(cliente.limiteCredito) };
  },
);

export interface ResumenCuenta {
  /** Pedidos que todavía están en movimiento. */
  pedidosEnCurso: number;
  /** Presupuestos enviados esperando que el cliente conteste. */
  presupuestosAResponder: number;
  saldo: number;
  limiteCredito: number;
}

/**
 * Los tres números que hacen falta para la navegación del portal.
 *
 * Va aparte de las listas porque el layout los necesita en cada pantalla, y
 * traer todos los pedidos para contarlos sería pagar la lista completa en cada
 * navegación.
 */
export const resumenCuenta = cache(async (): Promise<ResumenCuenta> => {
  const cliente = await clienteDeLaSesion();

  if (!cliente) {
    return {
      pedidosEnCurso: 0,
      presupuestosAResponder: 0,
      saldo: 0,
      limiteCredito: 0,
    };
  }

  const [pedidos, presupuestos, saldo] = await Promise.all([
    db
      .select({ total: sql<number>`count(*)` })
      .from(orders)
      .where(
        and(
          eq(orders.customerId, cliente.id),
          sql`${orders.estado} not in ('entregado', 'cancelado')`,
        ),
      ),
    db
      .select({ total: sql<number>`count(*)` })
      .from(quotes)
      .where(and(eq(quotes.customerId, cliente.id), eq(quotes.estado, "enviado"))),
    db
      .select({ saldo: sql<string>`coalesce(sum(${accountMovements.monto}), 0)` })
      .from(accountMovements)
      .where(eq(accountMovements.customerId, cliente.id)),
  ]);

  return {
    pedidosEnCurso: Number(pedidos[0]?.total ?? 0),
    presupuestosAResponder: Number(presupuestos[0]?.total ?? 0),
    saldo: Number(saldo[0]?.saldo ?? 0),
    limiteCredito: cliente.limiteCredito,
  };
});

/* -------------------------------------------------------------------------- */
/* Pedidos                                                                     */
/* -------------------------------------------------------------------------- */

export interface PedidoPropio {
  id: string;
  numero: string;
  estado: string;
  estadoPago: string;
  tipoEntrega: "retiro" | "envio";
  total: number;
  items: number;
  sucursal: string | null;
  createdAt: Date;
}

export async function misPedidos(): Promise<PedidoPropio[]> {
  const cliente = await clienteDeLaSesion();
  if (!cliente) return [];

  const cantidadItems = db
    .select({
      orderId: orderItems.orderId,
      items: sql<number>`count(*)`.as("items"),
    })
    .from(orderItems)
    .groupBy(orderItems.orderId)
    .as("cantidad_items");

  const filas = await db
    .select({
      id: orders.id,
      numero: orders.numero,
      estado: orders.estado,
      estadoPago: orders.estadoPago,
      tipoEntrega: orders.tipoEntrega,
      total: orders.total,
      items: cantidadItems.items,
      sucursal: branches.name,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .leftJoin(cantidadItems, eq(cantidadItems.orderId, orders.id))
    .leftJoin(branches, eq(branches.id, orders.branchId))
    .where(eq(orders.customerId, cliente.id))
    .orderBy(desc(orders.createdAt));

  return filas.map((f) => ({
    ...f,
    total: Number(f.total),
    items: Number(f.items ?? 0),
  }));
}

/** Detalle de un pedido propio. Devuelve null si el número no es suyo. */
export async function miPedido(numero: string) {
  const cliente = await clienteDeLaSesion();
  if (!cliente) return null;

  const [pedido] = await db
    .select({
      id: orders.id,
      numero: orders.numero,
      estado: orders.estado,
      estadoPago: orders.estadoPago,
      medioPago: orders.medioPago,
      tipoEntrega: orders.tipoEntrega,
      direccionEntrega: orders.direccionEntrega,
      zonaEnvio: orders.zonaEnvio,
      costoEnvio: orders.costoEnvio,
      subtotal: orders.subtotal,
      total: orders.total,
      notas: orders.notas,
      sucursal: branches.name,
      sucursalSlug: branches.slug,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .leftJoin(branches, eq(branches.id, orders.branchId))
    // El filtro por dueño va acá, junto al número: si estuviera después del
    // select ya habríamos leído el pedido de otra persona.
    .where(and(eq(orders.numero, numero), eq(orders.customerId, cliente.id)))
    .limit(1);

  if (!pedido) return null;

  const [items, historial, entregas] = await Promise.all([
    db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, pedido.id))
      .orderBy(asc(orderItems.orden)),
    db
      .select({
        id: orderStatusHistory.id,
        estado: orderStatusHistory.estado,
        nota: orderStatusHistory.nota,
        createdAt: orderStatusHistory.createdAt,
      })
      .from(orderStatusHistory)
      .where(eq(orderStatusHistory.orderId, pedido.id))
      .orderBy(desc(orderStatusHistory.createdAt)),
    // Los retiros ya hechos. El pedido está filtrado por dueño, así que sus
    // remitos también lo están.
    db
      .select({
        id: deliveries.id,
        numero: deliveries.numero,
        tipo: deliveries.tipo,
        estado: deliveries.estado,
        receptorNombre: deliveries.receptorNombre,
        firmadoAt: deliveries.firmadoAt,
        createdAt: deliveries.createdAt,
      })
      .from(deliveries)
      .where(eq(deliveries.orderId, pedido.id))
      .orderBy(desc(deliveries.createdAt)),
  ]);

  // Lo que queda en acopio, renglón por renglón. Es la pregunta que un cliente
  // de maderera se hace todo el tiempo: "¿cuánto me falta retirar?".
  const acopio = await saldoDeAcopio(pedido.id);
  const enAcopio = acopio.filter((a) => a.pendiente > 0.01);

  return { ...pedido, items, historial, entregas, acopio, enAcopio };
}

/* -------------------------------------------------------------------------- */
/* Presupuestos                                                                */
/* -------------------------------------------------------------------------- */

export interface PresupuestoPropio {
  id: string;
  numero: string;
  estado: string;
  total: number;
  items: number;
  validoHasta: Date | null;
  createdAt: Date;
}

export async function misPresupuestos(): Promise<PresupuestoPropio[]> {
  const cliente = await clienteDeLaSesion();
  if (!cliente) return [];

  const cantidadItems = db
    .select({
      quoteId: quoteItems.quoteId,
      items: sql<number>`count(*)`.as("items"),
    })
    .from(quoteItems)
    .groupBy(quoteItems.quoteId)
    .as("cantidad_items_presu");

  const filas = await db
    .select({
      id: quotes.id,
      numero: quotes.numero,
      estado: quotes.estado,
      total: quotes.total,
      items: cantidadItems.items,
      validoHasta: quotes.validoHasta,
      createdAt: quotes.createdAt,
    })
    .from(quotes)
    .leftJoin(cantidadItems, eq(cantidadItems.quoteId, quotes.id))
    .where(eq(quotes.customerId, cliente.id))
    .orderBy(desc(quotes.createdAt));

  return filas.map((f) => ({
    ...f,
    total: Number(f.total),
    items: Number(f.items ?? 0),
  }));
}

export async function miPresupuesto(numero: string) {
  const cliente = await clienteDeLaSesion();
  if (!cliente) return null;

  const [presupuesto] = await db
    .select({
      id: quotes.id,
      numero: quotes.numero,
      estado: quotes.estado,
      subtotal: quotes.subtotal,
      total: quotes.total,
      notas: quotes.notas,
      asesor: quotes.asesor,
      validoHasta: quotes.validoHasta,
      sucursal: branches.name,
      createdAt: quotes.createdAt,
    })
    .from(quotes)
    .leftJoin(branches, eq(branches.id, quotes.branchId))
    .where(and(eq(quotes.numero, numero), eq(quotes.customerId, cliente.id)))
    .limit(1);

  if (!presupuesto) return null;

  const items = await db
    .select()
    .from(quoteItems)
    .where(eq(quoteItems.quoteId, presupuesto.id))
    .orderBy(asc(quoteItems.orden));

  return { ...presupuesto, items };
}

/* -------------------------------------------------------------------------- */
/* Cuenta corriente                                                            */
/* -------------------------------------------------------------------------- */

export interface MovimientoConSaldo {
  id: string;
  tipo: string;
  monto: number;
  detalle: string | null;
  referencia: string | null;
  /** Saldo de la cuenta después de este movimiento. */
  saldoDespues: number;
  /** El recibo del pago, si es un pago con recibo. */
  receiptId: string | null;
  createdAt: Date;
}

export interface CuentaCorriente {
  saldo: number;
  limiteCredito: number;
  disponible: number;
  movimientos: MovimientoConSaldo[];
}

/**
 * Cuenta corriente del cliente, con el saldo corrido en cada movimiento.
 *
 * Es la vista que evita la discusión de mostrador: no alcanza con el saldo
 * final, hay que poder seguir de dónde salió. Por eso cada fila muestra cómo
 * quedó la cuenta después de ese movimiento, calculado de más viejo a más
 * nuevo y mostrado al revés.
 */
export async function miCuentaCorriente(): Promise<CuentaCorriente> {
  const c = datos(await (await api()).GET("/api/v1/cuenta/corriente"));
  return {
    ...c,
    movimientos: c.movimientos.map((m) => ({
      id: m.id,
      tipo: m.tipo,
      monto: m.monto,
      detalle: m.detalle,
      referencia: m.referencia,
      receiptId: m.receiptId,
      saldoDespues: m.saldo,
      createdAt: new Date(m.fecha),
    })),
  };
}

export interface CreditoDisponible {
  /** Si el negocio le habilitó cuenta corriente. */
  habilitado: boolean;
  saldo: number;
  limiteCredito: number;
  disponible: number;
  /** Motivo por el que no puede usarla ahora, para poder decírselo. */
  motivo: string | null;
  /** No tiene crédito: lo que puede usar es su saldo a favor. */
  soloSaldoAFavor?: boolean;
}

/**
 * Si esta persona puede cargar una compra a su cuenta corriente.
 *
 * Antes el carrito ofrecía la opción a quien tuviera el rol "profesional" y la
 * acción la aceptaba sin mirar nada: cualquiera podía mandar el formulario con
 * `medioPago: cuenta_corriente` y llevarse la mercadería sin pagar ni tener
 * cuenta. Ahora la decisión sale del límite que le puso el negocio y del saldo
 * que ya debe, y se vuelve a verificar al confirmar.
 *
 * `estado: moroso` bloquea aunque quede margen: es el interruptor que usa el
 * mostrador cuando una cuenta se atrasó.
 */
export async function creditoDisponible(
  monto = 0,
): Promise<CreditoDisponible> {
  return datos(await (await api()).GET("/api/v1/cuenta/credito", { params: { query: { monto } } }));
}

/* -------------------------------------------------------------------------- */
/* Comprobantes                                                                */
/* -------------------------------------------------------------------------- */

export interface ComprobantePropio {
  id: string;
  tipo: string;
  puntoVenta: number;
  numero: number;
  estado: string;
  total: number;
  cae: string | null;
  fechaEmision: Date;
}

/**
 * Facturas y notas de crédito del cliente. Las lee Go con la cookie
 * (backend/internal/facturacion): solo las de su ficha y sin borradores (un
 * borrador es trabajo interno del mostrador y todavía puede cambiar).
 */
export async function misComprobantes(): Promise<ComprobantePropio[]> {
  const r = await (await api()).GET("/api/v1/cuenta/comprobantes");
  if (r.response.status === 401) return [];
  return datos(r).map((f) => ({ ...f, fechaEmision: new Date(f.fechaEmision) }));
}

/* -------------------------------------------------------------------------- */
/* Direcciones                                                                 */
/* -------------------------------------------------------------------------- */

export async function misDirecciones() {
  const cliente = await clienteDeLaSesion();
  if (!cliente) return [];

  return db
    .select()
    .from(addresses)
    .where(eq(addresses.customerId, cliente.id))
    .orderBy(desc(addresses.predeterminada), asc(addresses.etiqueta));
}
