"use server";

import { revalidatePath } from "next/cache";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";
import type { Autorizacion } from "@/components/autorizacion/campo-pin";

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
  /** Anular un recibo sin ser admin: hace falta el PIN de uno. */
  autorizacion?: Autorizacion;
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

/** Lo que contesta un cobro que Go frenó: el motivo y, sin caja, cuál abrir. */
function sinCobrar(p: Problema | undefined): EstadoCobro {
  const fondo = Number(p?.errores?.fondoBase);
  return {
    error: mensajeDe(p),
    sinCaja: p?.errores?.sinCaja,
    fondoBase: Number.isFinite(fondo) ? fondo : undefined,
    sucursales: leerSucursales(p?.errores?.sucursales),
  };
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
      branchId: campo(formData, "branchId"),
    },
  });
  // Sin caja abierta, el efectivo no se cobra: Go dice qué caja abrir y el
  // diálogo la abre ahí mismo, como en el cobro del pedido.
  if (!r.data) return sinCobrar(r.error as Problema | undefined);
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
  if (!r.data) return sinCobrar(r.error as Problema | undefined);
  revalidatePath("/admin");
  revalidatePath("/admin/pedidos");
  revalidatePath("/admin/reparto");
  revalidatePath("/admin/caja");
  revalidatePath("/admin/cheques");
  return { ok: r.data.ok, aviso: r.data.aviso, receiptId: r.data.receiptId };
}

/**
 * Lo que diría el cobro en efectivo del pedido antes de cobrarlo (GET
 * /admin/pedidos/{id}/cobro): vacío con la caja abierta; si no, cuál abrir o
 * entre cuáles elegir. El diálogo lo pide al abrirse: la elección aparecía
 * recién después del primer «Registrar» (mes simulado).
 */
export async function cajaDelCobro(pedidoId: string | null): Promise<Pick<EstadoCobro, "sinCaja" | "fondoBase" | "sucursales">> {
  // Sin pedido (el cobro a cuenta desde la ficha), la regla del cobro sin
  // sucursal: la única caja abierta, o elegir (H132).
  const r = pedidoId
    ? await (await api()).GET("/api/v1/admin/pedidos/{id}/cobro", { params: { path: { id: pedidoId } } })
    : await (await api()).GET("/api/v1/admin/cobros/caja");
  if (!r.data) return {};
  return { sinCaja: r.data.sinCaja, fondoBase: r.data.fondoBase, sucursales: r.data.sucursales };
}

/**
 * Los cheques que el cliente informó desde el portal y nadie aceptó todavía.
 * El cobro los muestra al abrirse: la deuda se cobraba en efectivo y los
 * cheques quedaban «en revisión» para siempre (M4-065).
 */
export async function chequesInformadosDe(customerId: string): Promise<{ cantidad: number; total: number }> {
  const r = await (await api()).GET("/api/v1/admin/cheques", { params: { query: { estado: "vivos" } } });
  const de = (r.data ?? []).filter((c) => c.estado === "informado" && c.customerId === customerId);
  return { cantidad: de.length, total: de.reduce((s, c) => s + Number(c.importe), 0) };
}

/**
 * Anula un recibo, con motivo (quien maneja plata): la deuda vuelve a la
 * cuenta. Go lo frena si una devolución ya le reintegró plata o si un cheque
 * suyo ya salió de la cartera, y el mensaje se muestra tal cual.
 */
export async function anularReciboDesdeElPanel(receiptId: string, motivo: string, pin?: string): Promise<EstadoCobro> {
  if (!motivo.trim()) return { error: "Poné el motivo de la anulación." };
  const r = await (await api()).POST("/api/v1/admin/recibos/{id}/anular", {
    params: { path: { id: receiptId } },
    body: { motivo, ...(pin ? { pin } : {}) },
  });
  if (!r.data) {
    // Quien no es admin anula con el PIN de uno, como una venta.
    const e = (r.error as Problema | undefined)?.errores;
    if (e?.pin) {
      return {
        error: e.pin,
        autorizacion: {
          motivo: "anular",
          monto: Number(e.pinMonto ?? 0),
          pinIncorrecto: e.pinIncorrecto === "si",
          bloqueadoHasta: e.pinHasta,
        },
      };
    }
    return { error: mensajeDe(r.error as Problema | undefined) };
  }
  revalidatePath("/admin/clientes");
  revalidatePath("/admin/pedidos");
  revalidatePath("/admin/cheques");
  revalidatePath("/admin/caja");
  // La retención sufrida se anula con su recibo, desde su lista (M3S1-027).
  revalidatePath("/admin/arca/retenciones");
  // Y desde la factura que cobraba (M4-097).
  revalidatePath("/admin/facturacion/[id]", "page");
  revalidatePath("/admin/pagos");
  return { ok: r.data.ok };
}

/**
 * El banco rechazó un cheque que entregó el cliente (H272): lo registra quien
 * maneja plata desde la ficha, con el PIN de un admin si no es admin. Go hace
 * lo mismo que /admin/cheques: la deuda vuelve con una nota de débito.
 */
export async function rechazarChequeDesdeLaFicha(chequeId: string, motivo: string, pin?: string): Promise<EstadoCobro> {
  if (!motivo.trim()) return { error: "Poné el motivo del rechazo: lo lee el cliente." };
  const r = await (await api()).POST("/api/v1/admin/cheques/{id}/rechazo", {
    params: { path: { id: chequeId } },
    body: { motivo, ...(pin ? { pin } : {}) },
  });
  if (!r.data) {
    const e = (r.error as Problema | undefined)?.errores;
    if (e?.pin) {
      return {
        error: e.pin,
        autorizacion: {
          motivo: e.pinMotivo === "cheque_devuelto" ? "cheque_devuelto" : "cheque",
          monto: Number(e.pinMonto ?? 0),
          pinIncorrecto: e.pinIncorrecto === "si",
          bloqueadoHasta: e.pinHasta,
          conClave: e.pinConClave === "si",
          sinAdmins: e.pinSinAdmins === "si",
        },
      };
    }
    return { error: mensajeDe(r.error as Problema | undefined) };
  }
  revalidatePath("/admin/clientes");
  revalidatePath("/admin/cheques");
  revalidatePath("/admin");
  return { ok: r.data.ok };
}

/** `anularReciboDesdeElPanel` desde un formulario (useActionState). */
export async function anularRecibo(_previo: EstadoCobro, formData: FormData): Promise<EstadoCobro> {
  const id = campo(formData, "receiptId");
  if (!id) return { error: "Falta el recibo." };
  return anularReciboDesdeElPanel(id, (formData.get("motivo") as string | null) ?? "");
}
