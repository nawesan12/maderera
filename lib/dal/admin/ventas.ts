import "server-only";

import { api, apiInterna, datos } from "@/lib/api/servidor";
import type { components } from "@/lib/api/tipos/ventas";

/**
 * Pedidos y presupuestos del panel. Los lee la API de Go
 * (backend/internal/pedidos, api/ventas.yaml) con la sesión de quien pide;
 * acá quedan los mismos nombres y la misma forma de antes, con las fechas
 * como Date, para no tocar las pantallas.
 *
 * Los permisos los decide Go: el tablero y los presupuestos, quien entra a
 * su pantalla; la ficha de un pedido, todo el personal (la leen también el
 * ticket impreso y el alta de un corte).
 */

type Esquemas = components["schemas"];

const fecha = (s: string) => new Date(s);
const fechaONula = (s: string | null) => (s ? new Date(s) : null);

/* -------------------------------------------------------------------------- */
/* Presupuestos                                                                */
/* -------------------------------------------------------------------------- */

export interface PresupuestoListado
  extends Omit<Esquemas["PresupuestoListado"], "createdAt" | "validoHasta" | "respondeHasta" | "necesitaPara"> {
  createdAt: Date;
  validoHasta: Date | null;
  /** Compromiso de respuesta. Todos lo tienen; los express, más corto. */
  respondeHasta: Date | null;
  /** Para cuándo lo necesita el cliente. Es lo que de verdad apura. */
  necesitaPara: Date | null;
}

/**
 * "Abiertos" no es un estado de la tabla sino los tres que todavía esperan
 * algo —pendiente, en revisión y enviado—: es el número de la tarjeta del
 * resumen, y la tarjeta tiene que llevar a esa misma lista.
 */
export async function listarPresupuestos(
  filtros: { busqueda?: string; estado?: string; sucursal?: string } = {},
): Promise<PresupuestoListado[]> {
  const r = await (await api()).GET("/api/v1/admin/presupuestos", { params: { query: filtros } });
  return datos(r).map((p) => ({
    ...p,
    createdAt: fecha(p.createdAt),
    validoHasta: fechaONula(p.validoHasta),
    respondeHasta: fechaONula(p.respondeHasta),
    necesitaPara: fechaONula(p.necesitaPara),
  }));
}

export interface PresupuestoCompleto extends Omit<Esquemas["FichaDePresupuesto"], "validoHasta" | "createdAt"> {
  validoHasta: Date | null;
  createdAt: Date;
}

function presupuesto(p: Esquemas["FichaDePresupuesto"]): PresupuestoCompleto {
  return { ...p, validoHasta: fechaONula(p.validoHasta), createdAt: fecha(p.createdAt) };
}

export async function obtenerPresupuesto(id: string): Promise<PresupuestoCompleto | null> {
  const r = await (await api()).GET("/api/v1/admin/presupuestos/{id}", { params: { path: { id } } });
  if (r.response.status === 404 || r.response.status === 400) return null;
  return presupuesto(datos(r));
}

/**
 * La ficha sin exigir personal, con el secreto interno.
 *
 * La usa lo que manda el presupuesto por WhatsApp a su dueño (puede correr en
 * la cola, sin la cookie de nadie): **quien llama ya decidió que se puede
 * ver**. No usar desde una pantalla. La descarga del PDF ya no pasa por acá:
 * Go mira de quién es.
 */
export async function consultarPresupuesto(id: string): Promise<PresupuestoCompleto | null> {
  const r = await apiInterna.GET("/api/v1/admin/presupuestos/{id}", { params: { path: { id } } });
  if (r.response.status === 404 || r.response.status === 400) return null;
  return presupuesto(datos(r));
}

/* -------------------------------------------------------------------------- */
/* Pedidos                                                                     */
/* -------------------------------------------------------------------------- */

export interface PedidoListado extends Omit<Esquemas["PedidoListado"], "createdAt"> {
  createdAt: Date;
}

export async function listarPedidos(
  filtros: { busqueda?: string; estado?: string; sucursal?: string } = {},
): Promise<PedidoListado[]> {
  const r = await (await api()).GET("/api/v1/admin/pedidos", { params: { query: filtros } });
  return datos(r).map((p) => ({ ...p, createdAt: fecha(p.createdAt) }));
}

export interface PedidoCompleto extends Omit<Esquemas["FichaDePedido"], "createdAt" | "historial"> {
  createdAt: Date;
  historial: (Omit<Esquemas["PasoDelPedido"], "createdAt"> & { createdAt: Date })[];
}

/**
 * La ficha del pedido con sus líneas, su historial y cómo se pagó. `margen`
 * viene solo para el admin (y null si ninguna línea tiene costo congelado).
 */
export async function obtenerPedido(id: string): Promise<PedidoCompleto | null> {
  const r = await (await api()).GET("/api/v1/admin/pedidos/{id}", { params: { path: { id } } });
  if (r.response.status === 404 || r.response.status === 400) return null;
  const p = datos(r);
  return {
    ...p,
    createdAt: fecha(p.createdAt),
    historial: p.historial.map((h) => ({ ...h, createdAt: fecha(h.createdAt) })),
  };
}

/*
 * La numeración de pedidos y presupuestos está en Go (internal/numeracion)
 * y, mientras el mostrador y el carrito sigan en TS, también en
 * `lib/dal/numeracion-ventas.ts`: los dos lados toman el mismo candado.
 */
