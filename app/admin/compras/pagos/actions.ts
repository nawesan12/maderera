"use server";

import { revalidatePath } from "next/cache";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";
import { acumuladoDelMes, facturasConSaldo } from "@/lib/dal/admin/pagos-proveedor";
import { chequesEnCartera } from "@/lib/dal/admin/cheques";

/*
 * Los pagos a proveedores. Los registra la API de Go
 * (backend/internal/compras): las retenciones con sus certificados (sobre el
 * acumulado del mes), las imputaciones a facturas, las partes con sus
 * cheques y un solo movimiento de cuenta por el total, con candado.
 */

export interface EstadoPago {
  error?: string;
  ok?: string;
  /** El pago registrado: para ir a su ficha y a la orden de pago. */
  id?: string;
  /** Si el efectivo no pudo salir de una caja. */
  aviso?: string;
  /** Los certificados emitidos, para poder imprimirlos en el acto. */
  certificados?: { numero: string; impuesto: string; importe: number }[];
}

export interface DatosPago {
  supplierId: string;
  /** Lo que baja la deuda, retenciones incluidas. */
  total: number;
  /** aaaa-mm-dd; sin ella, hoy. */
  fecha?: string;
  /** La sucursal de cuya caja sale el efectivo. */
  branchId?: string;
  medio: "transferencia" | "efectivo" | "cheque" | "echeq";
  circuito?: "blanco" | "negro";
  referencia?: string;
  notas?: string;
  retenciones: { regimenId: string; base: number }[];
  imputaciones?: { purchaseInvoiceId: string; importe: number }[];
  /** Los cheques rechazados que se reponen con este pago. */
  cheques?: { chequeId: string; importe: number }[];
  /** Los ajustes que subieron la deuda (un saldo inicial) que se pagan. */
  ajustes?: { movimientoId: string; importe: number }[];
  /** Las notas de crédito a favor que se descuentan. */
  notasDeCredito?: string[];
  partes?: {
    medio: "transferencia" | "efectivo" | "cheque" | "echeq";
    importe: number;
    referencia?: string | null;
    cheque?: { tipo: "fisico" | "echeq"; numero: string; banco?: string | null; fechaPago: Date } | null;
    chequeId?: string | null;
  }[];
}

/** Registra el pago y emite los certificados. */
export async function pagarAProveedor(datos: DatosPago): Promise<EstadoPago> {
  const r = await (await api()).POST("/api/v1/admin/compras/pagos", {
    // La fecha del cheque viaja como ISO (una fecha inválida, como null).
    body: JSON.parse(JSON.stringify(datos)) as Record<string, unknown>,
  });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "No se pudo registrar el pago.") };
  revalidatePath("/admin/compras/pagos");
  revalidatePath("/admin/compras/facturas");
  revalidatePath(`/admin/proveedores/${datos.supplierId}`);
  return { ok: r.data.ok, id: r.data.id, aviso: r.data.aviso, certificados: r.data.certificados };
}

export interface RetencionSimulada {
  regimenId: string;
  base: number;
  acumulado: number;
  minimo: number;
  imponible: number;
  alicuota: number;
  retenidoAntes: number;
  retencion: number;
  motivo: string | null;
}

/**
 * Lo que retendría el pago, con la misma cuenta que el certificado, sin
 * anotar nada: la pantalla lo muestra antes de confirmar.
 */
export async function simularRetenciones(
  supplierId: string,
  fecha: string,
  retenciones: { regimenId: string; base: number }[],
): Promise<RetencionSimulada[]> {
  if (!supplierId || retenciones.length === 0) return [];
  const r = await (await api()).POST("/api/v1/admin/compras/pagos/simular", {
    body: { supplierId, ...(fecha ? { fecha } : {}), retenciones },
  });
  return (r.data ?? []) as RetencionSimulada[];
}

/** Lo ya retenido este mes, para mostrarlo antes de pagar. */
export async function verAcumulado(supplierId: string) {
  return acumuladoDelMes(supplierId);
}

/** Las facturas con saldo del proveedor, por vencimiento, para elegir qué se paga. */
export async function verFacturasConSaldo(supplierId: string) {
  return facturasConSaldo(supplierId);
}

/** Los cheques recibidos que siguen en cartera, para endosarlos. */
export async function verChequesEnCartera() {
  return chequesEnCartera();
}

/**
 * Anula un pago cargado por error. Solo el admin, con motivo, y queda en la
 * bitácora. La API de Go (backend/internal/compras) devuelve la deuda con el
 * proveedor, saca lo aplicado a las facturas, anula los certificados de
 * retención, deshace los cheques (los endosados vuelven a cartera, los
 * propios se anulan) y devuelve el efectivo a la caja. Un cheque ya cobrado o
 * rechazado no se puede deshacer: se avisa.
 */
export async function anularPago(
  id: string,
  supplierId: string,
  motivo: string,
): Promise<{ error?: string; ok?: string }> {
  const r = await (await api()).POST("/api/v1/admin/compras/pagos/{id}/anular", {
    params: { path: { id } },
    body: { motivo },
  });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "No se pudo anular el pago.") };
  revalidatePath("/admin/compras/pagos");
  revalidatePath(`/admin/compras/pagos/${id}`);
  revalidatePath("/admin/compras/facturas");
  revalidatePath(`/admin/proveedores/${supplierId}`);
  revalidatePath("/admin/cheques");
  revalidatePath("/admin/caja");
  return { ok: r.data.ok };
}
