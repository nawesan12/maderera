import "server-only";

import { cache } from "react";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  accountMovements,
  addresses,
  branches,
  customers,
  orderItems,
  orderStatusHistory,
  orders,
  quoteItems,
  quotes,
} from "@/lib/db/schema";
import { getSession } from "@/lib/dal/session";

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
    // `getSession()` y no `verifySession()`: el checkout también pregunta por la
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
      sucursalDireccion: branches.address,
      sucursalHorario: branches.hours,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .leftJoin(branches, eq(branches.id, orders.branchId))
    // El filtro por dueño va acá, junto al número: si estuviera después del
    // select ya habríamos leído el pedido de otra persona.
    .where(and(eq(orders.numero, numero), eq(orders.customerId, cliente.id)))
    .limit(1);

  if (!pedido) return null;

  const [items, historial] = await Promise.all([
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
  ]);

  return { ...pedido, items, historial };
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
  const cliente = await clienteDeLaSesion();

  if (!cliente) {
    return { saldo: 0, limiteCredito: 0, disponible: 0, movimientos: [] };
  }

  const filas = await db
    .select()
    .from(accountMovements)
    .where(eq(accountMovements.customerId, cliente.id))
    .orderBy(asc(accountMovements.createdAt));

  let corrido = 0;
  const movimientos = filas.map((m) => {
    corrido += Number(m.monto);
    return {
      id: m.id,
      tipo: m.tipo as string,
      monto: Number(m.monto),
      detalle: m.detalle,
      referencia: m.referencia,
      saldoDespues: corrido,
      createdAt: m.createdAt,
    };
  });

  movimientos.reverse();

  return {
    saldo: corrido,
    limiteCredito: cliente.limiteCredito,
    disponible: Math.max(cliente.limiteCredito - corrido, 0),
    movimientos,
  };
}

/**
 * Saldo actual del cliente, sumado en la base.
 *
 * Lo usa el checkout para decidir si la compra entra en el límite de crédito.
 * Va por separado de `miCuentaCorriente()` para no traerse todos los
 * movimientos cuando solo hace falta el número.
 */
export async function miSaldo(): Promise<number> {
  const cliente = await clienteDeLaSesion();
  if (!cliente) return 0;

  const [fila] = await db
    .select({ saldo: sql<string>`coalesce(sum(${accountMovements.monto}), 0)` })
    .from(accountMovements)
    .where(eq(accountMovements.customerId, cliente.id));

  return Number(fila?.saldo ?? 0);
}

export interface CreditoDisponible {
  /** Si el negocio le habilitó cuenta corriente. */
  habilitado: boolean;
  saldo: number;
  limiteCredito: number;
  disponible: number;
  /** Motivo por el que no puede usarla ahora, para poder decírselo. */
  motivo: string | null;
}

/**
 * Si esta persona puede cargar una compra a su cuenta corriente.
 *
 * Antes el checkout ofrecía la opción a quien tuviera el rol "profesional" y la
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
  const cliente = await clienteDeLaSesion();

  const vacio = {
    habilitado: false,
    saldo: 0,
    limiteCredito: 0,
    disponible: 0,
  };

  if (!cliente) {
    return { ...vacio, motivo: "Necesitás iniciar sesión con tu cuenta." };
  }

  if (cliente.limiteCredito <= 0) {
    return { ...vacio, motivo: "Tu cuenta no tiene cuenta corriente habilitada." };
  }

  const saldo = await miSaldo();
  const disponible = Math.max(cliente.limiteCredito - saldo, 0);
  const base = {
    saldo,
    limiteCredito: cliente.limiteCredito,
    disponible,
  };

  if (cliente.estado === "moroso") {
    return {
      ...base,
      habilitado: false,
      motivo: "Tu cuenta está con pagos pendientes. Escribinos y lo vemos.",
    };
  }

  if (monto > 0 && saldo + monto > cliente.limiteCredito) {
    return {
      ...base,
      habilitado: false,
      motivo: `Esta compra supera tu límite de crédito. Tenés ${disponible.toLocaleString("es-AR")} disponibles.`,
    };
  }

  return { ...base, habilitado: true, motivo: null };
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
