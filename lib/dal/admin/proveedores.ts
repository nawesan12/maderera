import "server-only";

import { api, datos } from "@/lib/api/servidor";

/**
 * Proveedores y lo que se les debe. Lo sirve la API de Go
 * (backend/internal/compras).
 *
 * **El signo va al revés que en clientes**: acá positivo es lo que *nosotros*
 * debemos.
 */

export interface ProveedorListado {
  id: string;
  nombre: string;
  razonSocial: string | null;
  cuit: string | null;
  rubro: string | null;
  contacto: string | null;
  telefono: string | null;
  email: string | null;
  diasPago: number;
  estado: "activo" | "inactivo";
  /** Positivo: le debemos. */
  saldo: number;
  ultimoMovimiento: Date | null;
}

export async function listarProveedores(
  filtros: { busqueda?: string; estado?: string } = {},
): Promise<ProveedorListado[]> {
  const query = {
    ...(filtros.busqueda ? { busqueda: filtros.busqueda.slice(0, 200) } : {}),
    ...(filtros.estado ? { estado: filtros.estado } : {}),
  };
  const filas = datos(await (await api()).GET("/api/v1/admin/proveedores", { params: { query } }));
  return filas.map((f) => ({ ...f, ultimoMovimiento: f.ultimoMovimiento ? new Date(f.ultimoMovimiento) : null }));
}

/** La ficha completa, con el libro de la cuenta. */
export async function obtenerProveedor(id: string) {
  const r = await (await api()).GET("/api/v1/admin/proveedores/{id}", { params: { path: { id } } });
  if (r.response.status === 404) return null;
  const p = datos(r);
  return {
    ...p,
    createdAt: new Date(p.createdAt),
    updatedAt: new Date(p.updatedAt),
    movimientos: p.movimientos.map((m) => ({ ...m, createdAt: new Date(m.createdAt) })),
  };
}

/** Las condiciones de pago que ofrece un proveedor, por escrito. */
export async function condicionesDelProveedor(supplierId: string) {
  return datos(
    await (await api()).GET("/api/v1/admin/proveedores/{id}/condiciones", { params: { path: { id: supplierId } } }),
  );
}

/** Para los selectores: nombre y poco más. */
export async function proveedoresParaElegir() {
  return datos(await (await api()).GET("/api/v1/admin/compras/proveedores-activos"));
}

/** El perfil que dice cómo viene la planilla de este proveedor, o null. */
export async function perfilDelProveedor(supplierId: string) {
  const p = datos(
    await (await api()).GET("/api/v1/admin/proveedores/{id}/perfil-lista", { params: { path: { id: supplierId } } }),
  );
  return p ? { ...p, createdAt: new Date(p.createdAt), updatedAt: new Date(p.updatedAt) } : null;
}
