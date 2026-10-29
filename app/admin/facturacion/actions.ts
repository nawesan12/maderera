"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";

/**
 * Las acciones de facturación. La lógica vive en Go
 * (backend/internal/facturacion): la letra, los importes, la numeración sin
 * huecos, el CAE fuera de la transacción, las notas, el cobro por
 * EmitirRecibo, la bitácora y el aviso al cliente con el PDF (que Go encola en
 * la misma transacción). Acá quedan la firma de cada acción, lo que se
 * revalida y adónde se va después.
 */

export interface EstadoFactura {
  error?: string;
  ok?: string;
  /** El recibo del cobro, para ofrecer imprimirlo en el momento. */
  receiptId?: string;
}

function refrescar(id?: string) {
  revalidatePath("/admin/facturacion");
  revalidatePath("/admin/arca");
  if (id) revalidatePath(`/admin/facturacion/${id}`);
}

/** Los campos de texto del formulario, sin los que agrega Next. */
function campos(formData: FormData): Record<string, string> {
  const c: Record<string, string> = {};
  for (const [k, v] of formData) {
    if (!k.startsWith("$") && typeof v === "string" && !(k in c)) c[k] = v;
  }
  return c;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* -------------------------------------------------------------------------- */
/* Emitir                                                                      */
/* -------------------------------------------------------------------------- */

/** Factura un pedido: los renglones y la condición frente al IVA salen del pedido. */
export async function facturarPedido(
  _previo: EstadoFactura,
  formData: FormData,
): Promise<EstadoFactura> {
  const orderId = String(formData.get("orderId") ?? "");
  if (!UUID.test(orderId)) return { error: "No encontramos ese pedido." };

  const r = await (await api()).POST("/api/v1/admin/facturacion/pedidos/{id}/facturar", {
    params: { path: { id: orderId } },
  });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined) };

  refrescar();
  revalidatePath(`/admin/pedidos/${orderId}`);
  redirect(`/admin/facturacion/${r.data.invoiceId}`);
}

/** Alta manual, para la venta de mostrador que no pasó por un pedido. */
export async function emitirManual(
  _previo: EstadoFactura,
  formData: FormData,
): Promise<EstadoFactura> {
  const lista = (k: string) => formData.getAll(k).map(String);
  const r = await (await api()).POST("/api/v1/admin/facturacion/comprobantes", {
    body: {
      campos: campos(formData),
      lineas: {
        descripcion: lista("descripcion"),
        cantidad: lista("cantidad"),
        precio: lista("precio"),
        alicuota: lista("alicuota"),
      },
    },
  });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined) };

  refrescar();
  revalidatePath("/admin/clientes");
  redirect(`/admin/facturacion/${r.data.invoiceId}`);
}

/* -------------------------------------------------------------------------- */
/* Autorizar, anular, cobrar                                                   */
/* -------------------------------------------------------------------------- */

export async function autorizar(
  _previo: EstadoFactura,
  formData: FormData,
): Promise<EstadoFactura> {
  const id = String(formData.get("id") ?? "");
  if (!UUID.test(id)) return { error: "No encontramos el comprobante." };

  const r = await (await api()).POST("/api/v1/admin/facturacion/comprobantes/{id}/autorizar", {
    params: { path: { id } },
  });
  refrescar(id);
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined) };
  return r.data;
}

export async function anular(
  _previo: EstadoFactura,
  formData: FormData,
): Promise<EstadoFactura> {
  const id = String(formData.get("id") ?? "");
  if (!UUID.test(id)) return { error: "Invalid UUID" };

  const r = await (await api()).POST("/api/v1/admin/facturacion/comprobantes/{id}/anular", {
    params: { path: { id } },
    body: campos(formData),
  });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "Revisá los datos.") };

  refrescar(id);
  redirect(`/admin/facturacion/${r.data.invoiceId}`);
}

/**
 * Registra un cobro de un comprobante: con recibo (EmitirRecibo, que deja los
 * cheques, baja la deuda y entra el efectivo a la caja) o pasándolo a cuenta
 * corriente, con el control de límite y mora.
 */
export async function registrarCobro(
  _previo: EstadoFactura,
  formData: FormData,
): Promise<EstadoFactura> {
  const id = String(formData.get("id") ?? "");
  if (!UUID.test(id)) return { error: "No encontramos el comprobante." };

  const r = await (await api()).POST("/api/v1/admin/facturacion/comprobantes/{id}/cobros", {
    params: { path: { id } },
    body: campos(formData),
  });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined) };

  refrescar(id);
  revalidatePath("/admin/clientes");
  return r.data;
}

/* -------------------------------------------------------------------------- */
/* Configuración tributaria                                                    */
/* -------------------------------------------------------------------------- */

export async function guardarDatosEmisor(
  _previo: EstadoFactura,
  formData: FormData,
): Promise<EstadoFactura> {
  const r = await (await api()).PUT("/api/v1/admin/facturacion/emisor", { body: campos(formData) });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "Revisá los datos.") };
  revalidatePath("/admin/arca");
  return { ok: r.data.ok };
}

export async function guardarPuntoVenta(
  _previo: EstadoFactura,
  formData: FormData,
): Promise<EstadoFactura> {
  const r = await (await api()).POST("/api/v1/admin/facturacion/puntos-de-venta", { body: campos(formData) });
  if (!r.data) {
    return {
      error: mensajeDe(r.error as Problema | undefined, "El número de punto de venta tiene que ser el que habilitaste en ARCA."),
    };
  }
  revalidatePath("/admin/arca");
  return { ok: r.data.ok };
}

/* -------------------------------------------------------------------------- */
/* Notas parciales y notas de débito                                           */
/* -------------------------------------------------------------------------- */

/** Nota de crédito por parte de una factura. No anula el original. */
export async function acreditarParcial(
  invoiceId: string,
  motivo: string,
  parciales: { itemId: string; cantidad: number }[],
): Promise<EstadoFactura> {
  if (!UUID.test(invoiceId)) return { error: "No encontramos el comprobante." };
  const r = await (await api()).POST("/api/v1/admin/facturacion/comprobantes/{id}/nota-de-credito", {
    params: { path: { id: invoiceId } },
    body: { motivo, parciales },
  });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined) };

  refrescar(invoiceId);
  redirect(`/admin/facturacion/${r.data.invoiceId}`);
}

/**
 * Nota de débito: le carga algo más al cliente sobre una factura ya emitida.
 * El importe se carga **final, con IVA adentro**.
 */
export async function debitar(
  invoiceId: string,
  motivo: string,
  concepto: string,
  importe: number,
  alicuota: number,
): Promise<EstadoFactura> {
  if (!UUID.test(invoiceId)) return { error: "No encontramos el comprobante." };
  const r = await (await api()).POST("/api/v1/admin/facturacion/comprobantes/{id}/nota-de-debito", {
    params: { path: { id: invoiceId } },
    // NaN viaja como null: Go lo trata como el NaN del TS.
    body: { motivo, concepto, importe: Number.isFinite(importe) ? importe : null, alicuota: Number.isFinite(alicuota) ? alicuota : null },
  });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined) };

  refrescar(invoiceId);
  redirect(`/admin/facturacion/${r.data.invoiceId}`);
}
