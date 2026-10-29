import "server-only";

import { cache } from "react";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  branches,
  deliveries,
  invoices,
  orderItems,
  orderStatusHistory,
  orders,
} from "@/lib/db/schema";
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
export const clienteDeLaSesion = cache(async (): Promise<ClienteDeSesion | null> => {
  return datos(await (await api()).GET("/api/v1/cuenta/ficha")).cliente;
});

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
  return datos(await (await api()).GET("/api/v1/cuenta/resumen"));
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
  const filas = datos(await (await api()).GET("/api/v1/cuenta/pedidos"));
  return filas.map((f) => ({ ...f, createdAt: new Date(f.createdAt) }));
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
  const filas = datos(await (await api()).GET("/api/v1/cuenta/presupuestos"));
  return filas.map((f) => ({
    ...f,
    validoHasta: f.validoHasta ? new Date(f.validoHasta) : null,
    createdAt: new Date(f.createdAt),
  }));
}

export async function miPresupuesto(numero: string) {
  const r = await (await api()).GET("/api/v1/cuenta/presupuestos/{numero}", {
    params: { path: { numero: numero.slice(0, 40) } },
  });
  if (r.response.status === 404) return null;
  const p = datos(r);
  return { ...p, validoHasta: p.validoHasta ? new Date(p.validoHasta) : null, createdAt: new Date(p.createdAt) };
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
  const filas = datos(await (await api()).GET("/api/v1/cuenta/direcciones"));
  return filas.map((f) => ({ ...f, createdAt: new Date(f.createdAt) }));
}
