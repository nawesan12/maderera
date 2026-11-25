import "server-only";

import { api, datos } from "@/lib/api/servidor";
import type { Esquemas } from "@/lib/api/tipos";

/**
 * El seguimiento de cobranza y de venta: a quién llamar y cuándo. Lo sirve la
 * API de Go (backend/internal/clientes/lecturas.go).
 */

type Cruda = Esquemas["Gestion"];

export interface GestionListada extends Omit<Cruda, "proximaAccionAt" | "createdAt"> {
  proximaAccionAt: Date | null;
  createdAt: Date;
}

const conFechas = (g: Cruda): GestionListada => ({
  ...g,
  proximaAccionAt: g.proximaAccionAt ? new Date(g.proximaAccionAt) : null,
  createdAt: new Date(g.createdAt),
});

/** Las abiertas (o todas), la próxima acción más cercana primero. */
export async function listarGestiones(filtros: { incluirCerradas?: boolean } = {}): Promise<GestionListada[]> {
  const query = { cerradas: Boolean(filtros.incluirCerradas) };
  return datos(await (await api()).GET("/api/v1/admin/seguimiento", { params: { query } })).map(conFechas);
}

/** Todas las de un cliente, para su ficha. */
export async function gestionesDelCliente(customerId: string): Promise<GestionListada[]> {
  const query = { cerradas: true, cliente: customerId };
  return datos(await (await api()).GET("/api/v1/admin/seguimiento", { params: { query } })).map(conFechas);
}

/** Cuántas abiertas tienen la próxima acción vencida (para el inicio). */
export async function gestionesVencidas(): Promise<number> {
  return datos(await (await api()).GET("/api/v1/admin/seguimiento/vencidas")).cuantas;
}
