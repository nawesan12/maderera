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
  /** Los certificados emitidos, para poder imprimirlos en el acto. */
  certificados?: { numero: string; impuesto: string; importe: number }[];
}

export interface DatosPago {
  supplierId: string;
  /** Lo que se le imputa a la deuda, retenciones incluidas. */
  total: number;
  medio: "transferencia" | "efectivo" | "cheque" | "echeq";
  circuito?: "blanco" | "negro";
  referencia?: string;
  notas?: string;
  retenciones: { regimenId: string; base: number }[];
  imputaciones?: { purchaseInvoiceId: string; importe: number }[];
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
  revalidatePath(`/admin/proveedores/${datos.supplierId}`);
  return { ok: r.data.ok, certificados: r.data.certificados };
}

/** Lo ya retenido este mes, para mostrarlo antes de pagar. */
export async function verAcumulado(supplierId: string) {
  return acumuladoDelMes(supplierId);
}

/** Las facturas con saldo del proveedor, para imputar el pago. */
export async function verFacturasConSaldo(supplierId: string) {
  return facturasConSaldo(supplierId);
}

/** Los cheques recibidos que siguen en cartera, para endosarlos. */
export async function verChequesEnCartera() {
  return chequesEnCartera();
}
