import "server-only";

import { api, datos } from "@/lib/api/servidor";

/**
 * Los pagos a proveedores y sus retenciones. Los sirve la API de Go
 * (backend/internal/compras), que también registra el pago.
 */

/** Los pagos hechos, con lo retenido en cada uno y las facturas que cubrió. */
export async function listarPagosAProveedores(limite = 60) {
  const filas = datos(await (await api()).GET("/api/v1/admin/compras/pagos", { params: { query: { limite } } }));
  return filas.map((f) => ({ ...f, fecha: new Date(f.fecha) }));
}

/** Las facturas del proveedor con saldo por imputar. */
export async function facturasConSaldo(supplierId: string) {
  const filas = datos(
    await (await api()).GET("/api/v1/admin/proveedores/{id}/facturas-con-saldo", { params: { path: { id: supplierId } } }),
  );
  return filas.map((f) => ({ ...f, fechaEmision: new Date(f.fechaEmision) }));
}

/** Los regímenes activos, para elegir al pagar. */
export async function regimenesActivos() {
  return regimenes(false);
}

/** Todos los regímenes (también los apagados), por impuesto y código. */
export async function todosLosRegimenes() {
  return regimenes(true);
}

async function regimenes(todos: boolean) {
  const filas = datos(
    await (await api()).GET("/api/v1/admin/compras/regimenes", { params: { query: todos ? { todos } : {} } }),
  );
  return filas.map((f) => ({ ...f, createdAt: new Date(f.createdAt), updatedAt: new Date(f.updatedAt) }));
}

/** Lo ya retenido a un proveedor en el mes, por régimen. */
export async function acumuladoDelMes(supplierId: string) {
  return datos(
    await (await api()).GET("/api/v1/admin/proveedores/{id}/acumulado-del-mes", { params: { path: { id: supplierId } } }),
  );
}

/** Un certificado con todo lo que hace falta para imprimirlo, por número. */
export async function certificadoParaImprimir(numero: string) {
  const r = await (await api()).GET("/api/v1/admin/compras/certificados/{numero}", { params: { path: { numero } } });
  if (r.response.status === 404) return null;
  const c = datos(r);
  return { ...c, fecha: new Date(c.fecha), pagoFecha: new Date(c.pagoFecha) };
}
