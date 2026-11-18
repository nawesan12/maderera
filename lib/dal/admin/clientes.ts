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

export interface CarteraDeClientes
  extends Omit<Esquemas["CarteraDeClientes"], "porCobrar" | "alDia"> {
  /** Los que deben, del más urgente al menos: los 60 primeros, o todos. */
  porCobrar: ClienteListado[];
  /** Una página de los que no deben, por nombre. */
  alDia: ClienteListado[];
}

/**
 * La cartera en sus dos grupos. Las cantidades y los totales son de todos los
 * que pasan el filtro; lo que viaja son las filas que se muestran.
 */
export async function listarClientes(
  filtros: {
    busqueda?: string;
    tipo?: string;
    rubro?: string;
    vendedor?: string;
    pagina?: number;
    todosLosDeudores?: boolean;
  } = {},
): Promise<CarteraDeClientes> {
  const query = {
    ...(filtros.busqueda ? { busqueda: filtros.busqueda.slice(0, 200) } : {}),
    ...(filtros.tipo ? { tipo: filtros.tipo } : {}),
    ...(filtros.rubro ? { rubro: filtros.rubro } : {}),
    ...(filtros.vendedor ? { vendedor: filtros.vendedor } : {}),
    ...(filtros.pagina && filtros.pagina > 1 ? { pagina: Math.min(filtros.pagina, 100_000) } : {}),
    ...(filtros.todosLosDeudores ? { deudores: "todos" as const } : {}),
  };
  const c = datos(await (await api()).GET("/api/v1/admin/clientes", { params: { query } }));
  const conFecha = (f: Crudo): ClienteListado => ({
    ...f,
    ultimaCompra: f.ultimaCompra ? new Date(f.ultimaCompra) : null,
  });
  return { ...c, porCobrar: c.porCobrar.map(conFecha), alDia: c.alDia.map(conFecha) };
}

type FichaCruda = Esquemas["FichaDeCliente"];
type ComprobanteCrudo = FichaCruda["pedidos"][number];

export interface FichaDeCliente
  extends Omit<FichaCruda, "createdAt" | "updatedAt" | "cuentaWebSinVincular" | "pedidos" | "presupuestos" | "cortes" | "facturas"> {
  createdAt: Date;
  updatedAt: Date;
  cuentaWebSinVincular: { id: string; nombre: string; createdAt: Date } | null;
  pedidos: (Omit<ComprobanteCrudo, "createdAt"> & { createdAt: Date })[];
  presupuestos: (Omit<ComprobanteCrudo, "createdAt"> & { createdAt: Date })[];
  cortes: (Omit<ComprobanteCrudo, "createdAt"> & { createdAt: Date })[];
  facturas: (Omit<ComprobanteCrudo, "createdAt"> & { createdAt: Date })[];
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
    cortes: c.cortes.map(conFecha),
    facturas: c.facturas.map(conFecha),
  };
}

/** Las listas de precios, la general primero (para elegir la del cliente). */
export async function listarListasParaClientes() {
  return listarListasDePrecios();
}
