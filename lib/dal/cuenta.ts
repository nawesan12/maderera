import "server-only";

import { cache } from "react";
import { api, datos } from "@/lib/api/servidor";

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
  /** Ya facturó o mueve cuenta: lo fiscal lo cambia la casa. */
  datosFiscalesFijos: boolean;
  /** La ficha existía antes que la cuenta web (mostrador o ISIS). */
  vinculada: boolean;
  /** Su lista de precios, si no es la general. */
  lista: string | null;
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
  medioPago: string | null;
  tipoEntrega: "retiro" | "envio";
  total: number;
  items: number;
  sucursal: string | null;
  /** Ya retiró una parte y le queda mercadería en acopio. */
  enAcopio: boolean;
  /** Lo que falta pagar de un pedido a cuenta corriente (null: no es a cuenta). */
  debeEnCuenta: number | null;
  /** Lo que cuesta en la cuenta después de sus notas de crédito. */
  cuestaEnCuenta?: number | null;
  /** Lo informado que falta verificar (transferencia con comprobante). */
  enRevision: number | null;
  createdAt: Date;
}

export async function misPedidos(): Promise<PedidoPropio[]> {
  const filas = datos(await (await api()).GET("/api/v1/cuenta/pedidos"));
  return filas.map((f) => ({ ...f, createdAt: new Date(f.createdAt) }));
}

/** Detalle de un pedido propio. Devuelve null si el número no es suyo. */
export async function miPedido(numero: string) {
  // El pedido, sus renglones (sin costo) y su historial los da Go
  // (backend/internal/portal), que busca por número y dueño juntos.
  const r = await (await api()).GET("/api/v1/cuenta/pedidos/{numero}", { params: { path: { numero: numero.slice(0, 40) } } });
  if (r.response.status === 404) return null;
  const p = datos(r);
  const pedido = { ...p, createdAt: new Date(p.createdAt) };
  // Un paso que repite el estado del anterior (la devolución o una nota de la
  // casa dejan su entrada con el mismo estado) no es un paso: se lista una
  // vez, cuando se llegó a ese estado. Viene del más nuevo al más viejo.
  const historial = p.historial
    .filter((h, i, todos) => h.estado !== todos[i + 1]?.estado)
    .map((h) => ({ ...h, createdAt: new Date(h.createdAt) }));

  // Los retiros ya hechos y lo que queda en acopio, renglón por renglón (la
  // pregunta que un cliente de maderera se hace todo el tiempo: "¿cuánto me
  // falta retirar?"). Los da Go (backend/internal/entregas), que vuelve a
  // mirar que el pedido sea del cliente de la sesión.
  const retiros = datos(
    await (await api()).GET("/api/v1/mi-cuenta/pedidos/{id}/entregas", { params: { path: { id: p.id } } }),
  );
  const entregas = retiros.entregas.map((e) => ({
    ...e,
    firmadoAt: e.firmadoAt ? new Date(e.firmadoAt) : null,
    createdAt: new Date(e.createdAt),
  }));
  const acopio = retiros.acopio;
  // «Te queda en acopio» es que ya retiró algo y le falta: sin ningún remito
  // vivo todo el pedido está pendiente y no es un acopio; cancelado, no queda
  // nada por retirar (mes simulado, PED-1129, PED-1130, PED-1133).
  const retiro = entregas.some((e) => e.estado !== "anulada");
  const enAcopio =
    retiro && p.estado !== "cancelado" ? acopio.filter((a) => a.pendiente > 0.01) : [];

  return { ...pedido, items: p.items, historial, entregas, acopio, enAcopio };
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
  reciboNumero: string | null;
  createdAt: Date;
}

export interface CuentaCorriente {
  saldo: number;
  limiteCredito: number;
  disponible: number;
  /** Lo cargado de pedidos que todavía no se entregaron ni facturaron. */
  sinEntregar: number;
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
      reciboNumero: m.reciboNumero ?? null,
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
  /** El número del pedido que factura. */
  pedido: string | null;
  /** El pedido se canceló: sin CAE, esa factura no vale. */
  ventaAnulada: boolean;
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
