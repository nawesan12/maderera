import "server-only";

import { api, datos } from "@/lib/api/servidor";

/**
 * Los vendedores (de salón y de calle) y su cartera. Los sirve la API de Go
 * (backend/internal/clientes/lecturas.go).
 */

export interface VendedorConCartera {
  id: string;
  nombre: string;
  tipo: "salon" | "calle";
  activo: boolean;
  clientes: number;
}

export async function listarVendedores(): Promise<VendedorConCartera[]> {
  return datos(await (await api()).GET("/api/v1/admin/vendedores"));
}

export interface VendedorParaElegir {
  id: string;
  nombre: string;
  tipo: "salon" | "calle";
}

/** Los activos, para elegir el de un cliente. */
export async function vendedoresActivos(): Promise<VendedorParaElegir[]> {
  const filas = datos(await (await api()).GET("/api/v1/admin/vendedores", { params: { query: { activos: true } } }));
  return filas.map(({ id, nombre, tipo }) => ({ id, nombre, tipo }));
}
