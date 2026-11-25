import "server-only";

import { api, datos } from "@/lib/api/servidor";
import type { Esquemas } from "@/lib/api/tipos";

/**
 * Todo lo que pasó con la plata de un cliente, en una línea de tiempo: el
 * libro de la cuenta corriente, las compras de contado (que no la mueven),
 * las transferencias informadas y los cheques que todavía no son plata. Lo
 * arma la API de Go (backend/internal/cobros/historial.go); lo ven el panel y
 * el cliente en «Movimientos».
 */

export type ClaseDeMovimiento = Esquemas["MovimientoDelCliente"]["clase"];
export type FiltroDeMovimientos = Esquemas["Filtro"];
export type PeriodoDeMovimientos = "3m" | "6m" | "12m" | "todo";

export interface MovimientoDelCliente extends Omit<Esquemas["MovimientoDelCliente"], "fecha"> {
  fecha: Date;
}

export interface Historial {
  movimientos: MovimientoDelCliente[];
  hayMas: boolean;
  saldo: number;
}

/** El período de la URL; cualquier otra cosa son los últimos doce meses. */
export function periodoDe(texto: string | undefined): PeriodoDeMovimientos {
  return texto === "3m" || texto === "6m" || texto === "todo" ? texto : "12m";
}

function conFechas(h: Esquemas["Historial"]): Historial {
  return { ...h, movimientos: h.movimientos.map((m) => ({ ...m, fecha: new Date(m.fecha) })) };
}

/** El historial de un cliente, para el panel. */
export async function historialDelCliente(
  customerId: string,
  opciones: { periodo?: string; filtro?: FiltroDeMovimientos } = {},
): Promise<Historial> {
  const query = { periodo: periodoDe(opciones.periodo), filtro: opciones.filtro ?? "todo" };
  return conFechas(
    datos(await (await api()).GET("/api/v1/admin/clientes/{id}/historial", { params: { path: { id: customerId }, query } })),
  );
}

/** El historial del cliente de la sesión, para el portal. */
export async function misMovimientos(opciones: { periodo?: string; filtro?: FiltroDeMovimientos } = {}): Promise<Historial> {
  const query = { periodo: periodoDe(opciones.periodo), filtro: opciones.filtro ?? "todo" };
  return conFechas(datos(await (await api()).GET("/api/v1/cuenta/movimientos", { params: { query } })));
}

/** Lo que debe un cliente (negativo: a favor). Para el panel. */
export async function saldoDelCliente(customerId: string): Promise<number> {
  const c = datos(await (await api()).GET("/api/v1/admin/clientes/{id}/credito", { params: { path: { id: customerId } } }));
  return c.saldo;
}
