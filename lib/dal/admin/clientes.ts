import "server-only";

import { api, datos } from "@/lib/api/servidor";
import type { Esquemas } from "@/lib/api/tipos";
import { listarListasDePrecios } from "@/lib/dal/admin/precios";

/**
 * La cartera de clientes del panel. La sirve la API de Go
 * (backend/internal/clientes/lecturas.go): el listado con saldo, compras y
 * deuda vencida, y la ficha.
 */

type Crudo = Esquemas["ClienteListado"];

export interface ClienteListado extends Omit<Crudo, "ultimaCompra"> {
  ultimaCompra: Date | null;
}

export async function listarClientes(
  filtros: { busqueda?: string; tipo?: string; rubro?: string; vendedor?: string } = {},
): Promise<ClienteListado[]> {
  const query = {
    ...(filtros.busqueda ? { busqueda: filtros.busqueda.slice(0, 200) } : {}),
    ...(filtros.tipo ? { tipo: filtros.tipo } : {}),
    ...(filtros.rubro ? { rubro: filtros.rubro } : {}),
    ...(filtros.vendedor ? { vendedor: filtros.vendedor } : {}),
  };
  const filas = datos(await (await api()).GET("/api/v1/admin/clientes", { params: { query } }));
  return filas.map((f) => ({ ...f, ultimaCompra: f.ultimaCompra ? new Date(f.ultimaCompra) : null }));
}

type FichaCruda = Esquemas["FichaDeCliente"];
type ComprobanteCrudo = FichaCruda["pedidos"][number];

export interface FichaDeCliente
  extends Omit<FichaCruda, "createdAt" | "updatedAt" | "cuentaWebSinVincular" | "pedidos" | "presupuestos"> {
  createdAt: Date;
  updatedAt: Date;
  cuentaWebSinVincular: { id: string; nombre: string; createdAt: Date } | null;
  pedidos: (Omit<ComprobanteCrudo, "createdAt"> & { createdAt: Date })[];
  presupuestos: (Omit<ComprobanteCrudo, "createdAt"> & { createdAt: Date })[];
}

/** La ficha, o null si no existe. */
export async function obtenerCliente(id: string): Promise<FichaDeCliente | null> {
  const r = await (await api()).GET("/api/v1/admin/clientes/{id}", { params: { path: { id } } });
  if (r.response.status === 404 || r.response.status === 400) return null;
  const c = datos(r);
  const conFecha = <T extends { createdAt: string }>(x: T) => ({ ...x, createdAt: new Date(x.createdAt) });
  return {
    ...c,
    createdAt: new Date(c.createdAt),
    updatedAt: new Date(c.updatedAt),
    cuentaWebSinVincular: c.cuentaWebSinVincular ? conFecha(c.cuentaWebSinVincular) : null,
    pedidos: c.pedidos.map(conFecha),
    presupuestos: c.presupuestos.map(conFecha),
  };
}

/** Las listas de precios, la general primero (para elegir la del cliente). */
export async function listarListasParaClientes() {
  return listarListasDePrecios();
}
