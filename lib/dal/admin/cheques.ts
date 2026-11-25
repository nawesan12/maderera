import "server-only";

import { api, datos } from "@/lib/api/servidor";
import type { Esquemas } from "@/lib/api/tipos";

/**
 * La cartera de cheques. La sirve la API de Go
 * (backend/internal/cobros/lecturas.go).
 */

export interface ChequeListado extends Omit<Esquemas["ChequeListado"], "fechaPago"> {
  fechaPago: Date;
}

export async function listarCheques(filtros: { estado?: string; sentido?: string } = {}): Promise<ChequeListado[]> {
  const query = {
    ...(filtros.estado ? { estado: filtros.estado } : {}),
    ...(filtros.sentido ? { sentido: filtros.sentido } : {}),
  };
  const filas = datos(await (await api()).GET("/api/v1/admin/cheques", { params: { query } }));
  return filas.map((f) => ({ ...f, fechaPago: new Date(f.fechaPago) }));
}

/**
 * Los acreditados, rechazados y anulados, lo último que cambió primero, de a
 * `porPagina`, con el total para paginar.
 */
export async function chequesTerminados(pagina = 1, porPagina = 30) {
  const r = datos(
    await (await api()).GET("/api/v1/admin/cheques/terminados", {
      params: { query: { limite: porPagina, desplazamiento: (pagina - 1) * porPagina } },
    }),
  );
  return {
    total: r.total,
    filas: r.filas.map((f): ChequeListado => ({ ...f, fechaPago: new Date(f.fechaPago) })),
  };
}

/** Los recibidos que siguen en la cartera, para entregarlos a un proveedor. */
export async function chequesEnCartera() {
  const filas = datos(await (await api()).GET("/api/v1/admin/cheques/cartera"));
  return filas.map((f) => ({ ...f, fechaPago: new Date(f.fechaPago) }));
}
