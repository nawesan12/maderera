import "server-only";

import { api, datos } from "@/lib/api/servidor";
import type { Esquemas } from "@/lib/api/tipos";
import type { CorteListado } from "@/lib/cortes/tipos";

/**
 * La cola del taller y la ficha de cada corte. Lo sirve la API de Go
 * (backend/internal/cortes): el plano, el presupuesto y la tarifa vienen ya
 * resueltos, con el disco y el motor con que nació cada trabajo.
 */

export type { CorteListado };

export async function listarCortes(filtros: { busqueda?: string; estado?: string } = {}): Promise<CorteListado[]> {
  const query = {
    ...(filtros.busqueda ? { busqueda: filtros.busqueda.slice(0, 200) } : {}),
    ...(filtros.estado ? { estado: filtros.estado.slice(0, 40) } : {}),
  };
  const filas = datos(await (await api()).GET("/api/v1/admin/cortes", { params: { query } }));
  return filas.map((f) => ({ ...f, createdAt: new Date(f.createdAt) }));
}

type CorteDeGo = Esquemas["Corte"];
type Mitad = "largo" | "ancho" | null;
export type Corte = Omit<CorteDeGo, "createdAt" | "mitad" | "medida"> & {
  createdAt: Date;
  mitad: Mitad;
  medida: Omit<CorteDeGo["medida"], "mitad"> & { mitad: Mitad };
};
export type FichaDeCorte = Omit<Esquemas["FichaCorte"], "corte"> & { corte: Corte };

const conFecha = (c: CorteDeGo): Corte => ({
  ...c,
  createdAt: new Date(c.createdAt),
  mitad: c.mitad as Mitad,
  medida: { ...c.medida, mitad: c.medida.mitad as Mitad },
});

/** La ficha: el trabajo, su plano, el presupuesto y lo que se cobra. Nulo si no existe. */
export async function fichaDeCorte(id: string): Promise<FichaDeCorte | null> {
  const r = await (await api()).GET("/api/v1/admin/cortes/{id}", { params: { path: { id } } });
  if (r.response.status === 404 || r.response.status === 400) return null;
  const f = datos(r);
  return { ...f, corte: conFecha(f.corte) };
}

export async function obtenerCorte(id: string): Promise<Corte | null> {
  return (await fichaDeCorte(id))?.corte ?? null;
}

/** El trabajo con su plano y la hoja de corte en el orden de la máquina. */
export async function hojaDelCorte(id: string) {
  const r = await (await api()).GET("/api/v1/admin/cortes/{id}/hoja", { params: { path: { id } } });
  if (r.response.status === 404 || r.response.status === 400) return null;
  const h = datos(r);
  return { ...h, corte: conFecha(h.corte) };
}

/** Los cortes que salieron de un pedido, el más nuevo primero. */
export async function cortesDelPedido(orderId: string) {
  const filas = datos(await (await api()).GET("/api/v1/admin/pedidos/{id}/cortes", { params: { path: { id: orderId } } }));
  return filas.map((f) => ({ ...f, createdAt: new Date(f.createdAt) }));
}
