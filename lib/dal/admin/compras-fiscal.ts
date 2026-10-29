import "server-only";

import { api, datos } from "@/lib/api/servidor";

/**
 * Libro IVA compras y las facturas de compra. Los sirve la API de Go
 * (backend/internal/compras): las notas de crédito van en negativo, como en
 * ventas, para que cada columna se sume de arriba abajo.
 */

export interface RenglonLibroCompras {
  id: string;
  fechaEmision: Date;
  tipo: string;
  puntoVenta: number;
  numero: number;
  proveedor: string;
  cuit: string | null;
  neto: number;
  iva21: number;
  iva105: number;
  iva27: number;
  exento: number;
  percepciones: number;
  total: number;
  cae: string | null;
}

export async function libroIvaCompras(desde: Date, hasta: Date) {
  const libro = datos(
    await (await api()).GET("/api/v1/admin/compras/libro-iva", {
      params: { query: { desde: desde.toISOString(), hasta: hasta.toISOString() } },
    }),
  );
  const filas: RenglonLibroCompras[] = libro.filas.map((f) => ({ ...f, fechaEmision: new Date(f.fechaEmision) }));
  return { filas, totales: libro.totales };
}

/** Las facturas de compra cargadas, para el listado del panel. */
export async function listarFacturasDeCompra(limite = 60) {
  const filas = datos(await (await api()).GET("/api/v1/admin/compras/facturas", { params: { query: { limite } } }));
  return filas.map((f) => ({
    ...f,
    fechaEmision: new Date(f.fechaEmision),
    fechaVencimiento: f.fechaVencimiento ? new Date(f.fechaVencimiento) : null,
  }));
}
