import "server-only";

import { api, datos } from "@/lib/api/servidor";

/**
 * Libro IVA compras, las facturas de compra y la ficha de un pago a
 * proveedor. Los sirve la API de Go
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

export interface FiltroFacturasDeCompra {
  /** «pendiente»: todas las que falta pagar, por vencimiento. Las otras, de a páginas. */
  estado?: "pendiente" | "pagadas" | "todas";
  proveedor?: string;
  desde?: Date;
  hasta?: Date;
  pagina?: number;
}

/**
 * Las facturas de compra para el listado del panel, y la deuda entera: la
 * suma de lo impago la hace Go sobre todas las facturas vivas, no sobre la
 * página que se trae.
 */
export async function listarFacturasDeCompra(filtro: FiltroFacturasDeCompra = {}) {
  const query = {
    ...(filtro.estado ? { estado: filtro.estado } : {}),
    ...(filtro.proveedor ? { proveedor: filtro.proveedor } : {}),
    ...(filtro.desde ? { desde: filtro.desde.toISOString() } : {}),
    ...(filtro.hasta ? { hasta: filtro.hasta.toISOString() } : {}),
    ...(filtro.pagina && filtro.pagina > 1 ? { pagina: filtro.pagina } : {}),
  };
  const r = datos(await (await api()).GET("/api/v1/admin/compras/facturas", { params: { query } }));
  return {
    ...r,
    facturas: r.facturas.map((f) => ({
      ...f,
      fechaEmision: new Date(f.fechaEmision),
      fechaVencimiento: f.fechaVencimiento ? new Date(f.fechaVencimiento) : null,
      anuladaAt: f.anuladaAt ? new Date(f.anuladaAt) : null,
    })),
  };
}

/** La factura entera: importes, la mercadería que cubre y los pagos que la cancelaron. */
export async function fichaDeFacturaDeCompra(id: string) {
  const r = await (await api()).GET("/api/v1/admin/compras/facturas/{id}", { params: { path: { id } } });
  if (r.response.status === 404) return null;
  const f = datos(r);
  return {
    ...f,
    fechaEmision: new Date(f.fechaEmision),
    fechaVencimiento: f.fechaVencimiento ? new Date(f.fechaVencimiento) : null,
    createdAt: new Date(f.createdAt),
    anuladaAt: f.anuladaAt ? new Date(f.anuladaAt) : null,
    pagos: f.pagos.map((p) => ({ ...p, fecha: new Date(p.fecha) })),
    creditos: f.creditos.map((c) => ({ ...c, fecha: new Date(c.fecha) })),
  };
}

/** El pago entero: facturas, retenciones, con qué salió la plata y de qué caja. */
export async function fichaDePagoAProveedor(id: string) {
  const r = await (await api()).GET("/api/v1/admin/compras/pagos/{id}", { params: { path: { id } } });
  if (r.response.status === 404) return null;
  const p = datos(r);
  return {
    ...p,
    fecha: new Date(p.fecha),
    anuladoAt: p.anuladoAt ? new Date(p.anuladoAt) : null,
    facturas: p.facturas.map((f) => ({
      ...f,
      fechaEmision: new Date(f.fechaEmision),
      fechaVencimiento: f.fechaVencimiento ? new Date(f.fechaVencimiento) : null,
    })),
    partes: p.partes.map((x) => ({ ...x, chequeFechaPago: x.chequeFechaPago ? new Date(x.chequeFechaPago) : null })),
  };
}
