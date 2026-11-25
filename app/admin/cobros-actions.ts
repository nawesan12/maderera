"use server";

import { revalidatePath } from "next/cache";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";

/*
 * Los cobros a un cliente desde el panel. Los hace la API de Go
 * (backend/internal/cobros): EmitirRecibo es la única puerta para la plata de
 * un cliente; los cheques entran a la cartera, el efectivo a la caja abierta,
 * y el aviso al cliente (correo y WhatsApp con el PDF) se encola en la misma
 * transacción.
 */

export interface EstadoCobro {
  ok?: string;
  error?: string;
  receiptId?: string;
  /** Algo que hay que decir aunque el cobro salió bien: la caja cerrada. */
  aviso?: string;
  /** El efectivo no entró porque la sucursal no tiene caja abierta: cuál. */
  sinCaja?: string;
  /** El fondo de cambio de esa sucursal, para abrir la caja con él. */
  fondoBase?: number;
  /** Un pedido sin sucursal: en qué caja puede entrar el efectivo. */
  sucursales?: SucursalParaCobrar[];
}

export interface SucursalParaCobrar {
  id: string;
  nombre: string;
  abierta: boolean;
  fondo: number;
}

function leerSucursales(texto: string | undefined): SucursalParaCobrar[] | undefined {
  if (!texto) return undefined;
  try {
    return JSON.parse(texto) as SucursalParaCobrar[];
  } catch {
    return undefined;
  }
}

const campo = (formData: FormData, nombre: string) => (formData.get(nombre) as string | null) || undefined;

/**
 * Registra lo que pagó un cliente y emite el recibo. Con `orderId` es el cobro
 * de un pedido a cuenta corriente: si alcanza a cubrirlo, el pedido queda
 * cobrado.
 */
export async function registrarCobroDeCliente(_previo: EstadoCobro, formData: FormData): Promise<EstadoCobro> {
  const customerId = campo(formData, "customerId");
  if (!customerId) return { error: "Falta el cliente." };
  const r = await (await api()).POST("/api/v1/admin/clientes/{id}/cobros", {
    params: { path: { id: customerId } },
    body: {
      partes: (formData.get("partes") as string | null) ?? "",
      orderId: campo(formData, "orderId"),
      concepto: campo(formData, "concepto"),
      clave: campo(formData, "clave"),
    },
  });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined) };
  revalidatePath("/admin/clientes");
  revalidatePath("/admin/pedidos");
  revalidatePath("/admin/cheques");
  return { ok: r.data.ok, aviso: r.data.aviso, receiptId: r.data.receiptId };
}

/**
 * Cobra un pedido con su recibo, tenga o no cliente (POST
 * /admin/pedidos/{id}/cobro). El efectivo entra al turno de la sucursal del
 * pedido; sin caja abierta Go lo rechaza y dice cuál abrir.
 */
export async function cobrarPedido(_previo: EstadoCobro, formData: FormData): Promise<EstadoCobro> {
  const id = campo(formData, "pedidoId");
  if (!id) return { error: "Falta el pedido." };
  const r = await (await api()).POST("/api/v1/admin/pedidos/{id}/cobro", {
    params: { path: { id } },
    body: {
      partes: (formData.get("partes") as string | null) ?? "",
      clave: campo(formData, "clave"),
      branchId: campo(formData, "branchId"),
    },
  });
  if (!r.data) {
    const p = r.error as Problema | undefined;
    const fondo = Number(p?.errores?.fondoBase);
    return {
      error: mensajeDe(p),
      sinCaja: p?.errores?.sinCaja,
      fondoBase: Number.isFinite(fondo) ? fondo : undefined,
      sucursales: leerSucursales(p?.errores?.sucursales),
    };
  }
  revalidatePath("/admin");
  revalidatePath("/admin/pedidos");
  revalidatePath("/admin/reparto");
  revalidatePath("/admin/caja");
  revalidatePath("/admin/cheques");
  return { ok: r.data.ok, aviso: r.data.aviso, receiptId: r.data.receiptId };
}

/**
 * Anula un recibo, con motivo (quien maneja plata): la deuda vuelve a la
 * cuenta. Go lo frena si una devolución ya le reintegró plata o si un cheque
 * suyo ya salió de la cartera, y el mensaje se muestra tal cual.
 */
export async function anularReciboDesdeElPanel(receiptId: string, motivo: string): Promise<EstadoCobro> {
  if (!motivo.trim()) return { error: "Poné el motivo de la anulación." };
  const r = await (await api()).POST("/api/v1/admin/recibos/{id}/anular", {
    params: { path: { id: receiptId } },
    body: { motivo },
  });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined) };
  revalidatePath("/admin/clientes");
  revalidatePath("/admin/pedidos");
  revalidatePath("/admin/cheques");
  revalidatePath("/admin/caja");
  return { ok: r.data.ok };
}

/** `anularReciboDesdeElPanel` desde un formulario (useActionState). */
export async function anularRecibo(_previo: EstadoCobro, formData: FormData): Promise<EstadoCobro> {
  const id = campo(formData, "receiptId");
  if (!id) return { error: "Falta el recibo." };
  return anularReciboDesdeElPanel(id, (formData.get("motivo") as string | null) ?? "");
}
