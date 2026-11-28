"use server";

import { revalidatePath } from "next/cache";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";

/*
 * Las facturas de compra. Las carga, las corrige y las anula la API de Go
 * (backend/internal/compras): la factura y la deuda en el mismo acto, y el
 * total sumado, no tipeado.
 */

export interface EstadoFacturaCompra {
  error?: string;
  ok?: string;
  id?: string;
  /** El campo del error («receiptIds»: el proveedor tiene remitos sin factura). */
  campo?: string;
}

export interface DatosFacturaCompra {
  supplierId: string;
  tipo: string;
  puntoVenta: number;
  numero: number;
  fechaEmision: string;
  /** aaaa-mm-dd. Sin él, Go pone la emisión más los días de pago del proveedor. */
  fechaVencimiento?: string;
  cae?: string;
  neto: number;
  iva21: number;
  iva105: number;
  iva27: number;
  exento: number;
  /** La suma de las dos de abajo: es lo que suma la factura. */
  percepciones: number;
  percepcionIva: number;
  percepcionIibb: number;
  observaciones?: string;
  /** La recepción que cubre: si está, la factura carga solo la diferencia. */
  receiptId?: string;
  /** Los demás remitos que cubre la misma factura. */
  receiptIds?: string[];
  /** De una nota de crédito, la factura a la que se aplica. */
  aplicaA?: string;
  /** Si la diferencia con lo recibido pasa al costo de la mercadería. */
  ajustarCosto?: boolean;
  /** El proveedor tiene remitos sin factura y esta no cubre ninguno (ya se avisó). */
  sinRemitos?: boolean;
  /** De una nota de crédito, lo que se le devuelve al proveedor (sale del stock). */
  devoluciones?: { itemId: string; cantidad: number }[];
}

/** Lo recibido del proveedor que todavía se le puede devolver con una nota de crédito. */
export async function verDevolvibles(proveedor: string) {
  if (!proveedor) return [];
  const r = await (await api()).GET("/api/v1/admin/compras/devolucion", { params: { query: { proveedor } } });
  return r.data ?? [];
}

function refrescar(supplierId: string, id?: string) {
  revalidatePath("/admin/compras/facturas");
  if (id) revalidatePath(`/admin/compras/facturas/${id}`);
  revalidatePath("/admin/arca/libro-iva-compras");
  revalidatePath(`/admin/proveedores/${supplierId}`);
}

export async function cargarFacturaDeCompra(datos: DatosFacturaCompra): Promise<EstadoFacturaCompra> {
  const r = await (await api()).POST("/api/v1/admin/compras/facturas", { body: { ...datos } });
  if (!r.data) {
    const p = r.error as Problema | undefined;
    return { error: mensajeDe(p, "Revisá los datos."), campo: Object.keys(p?.errores ?? {})[0] };
  }
  refrescar(r.data.supplierId ?? datos.supplierId, r.data.id);
  return { ok: r.data.ok, id: r.data.id };
}

/** Corrige los datos de una factura cargada mal; la diferencia va a la cuenta. */
export async function corregirFacturaDeCompra(
  id: string,
  datos: DatosFacturaCompra & { motivo: string },
): Promise<EstadoFacturaCompra> {
  const r = await (await api()).PUT("/api/v1/admin/compras/facturas/{id}", {
    params: { path: { id } },
    body: { ...datos },
  });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "Revisá los datos.") };
  refrescar(datos.supplierId, id);
  return { ok: r.data.ok, id };
}

/**
 * Anula una factura cargada por error: devuelve lo que cargó en la cuenta, la
 * saca del libro IVA y deja a cuenta los pagos que la cancelaban.
 */
export async function anularFacturaDeCompra(
  id: string,
  supplierId: string,
  motivo: string,
): Promise<{ error?: string; ok?: string }> {
  const r = await (await api()).POST("/api/v1/admin/compras/facturas/{id}/anular", {
    params: { path: { id } },
    body: { motivo },
  });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "No se pudo anular la factura.") };
  refrescar(supplierId, id);
  revalidatePath("/admin/compras/pagos");
  return { ok: r.data.ok };
}

/** Aplica una nota de crédito que quedó a favor a una factura con saldo. */
export async function aplicarNotaDeCredito(
  id: string,
  supplierId: string,
  facturaId: string,
): Promise<{ error?: string; ok?: string }> {
  const r = await (await api()).POST("/api/v1/admin/compras/facturas/{id}/aplicar", {
    params: { path: { id } },
    body: { facturaId },
  });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "No se pudo aplicar la nota de crédito.") };
  refrescar(supplierId, id);
  revalidatePath(`/admin/compras/facturas/${facturaId}`);
  revalidatePath("/admin/compras/pagos");
  return { ok: r.data.ok };
}
