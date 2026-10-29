"use server";

import { revalidatePath } from "next/cache";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";

/*
 * La ficha del cliente y su cuenta corriente. Lo hace la API de Go
 * (backend/internal/clientes): el alta (frena un CUIT que ya es de otra
 * ficha), el movimiento a mano (solo el admin), vincular la cuenta web,
 * bloquear la cuenta corriente y el plazo de pago.
 */

export interface EstadoCliente {
  error?: string;
  ok?: string;
}

const campo = (formData: FormData, nombre: string) => (formData.get(nombre) as string | null) ?? undefined;

function resultado(r: { data?: { ok: string }; error?: unknown }, porDefecto?: string): EstadoCliente {
  return r.data ? { ok: r.data.ok } : { error: mensajeDe(r.error as Problema | undefined, porDefecto) };
}

export async function guardarCliente(_previo: EstadoCliente, formData: FormData): Promise<EstadoCliente> {
  const r = await (await api()).POST("/api/v1/admin/clientes", {
    body: {
      id: campo(formData, "id") || undefined,
      nombre: campo(formData, "nombre") ?? "",
      razonSocial: campo(formData, "razonSocial"),
      cuit: campo(formData, "cuit"),
      condicionIva: campo(formData, "condicionIva"),
      tipo: campo(formData, "tipo"),
      email: campo(formData, "email"),
      telefono: campo(formData, "telefono"),
      direccion: campo(formData, "direccion"),
      rubro: campo(formData, "rubro"),
      asesor: campo(formData, "asesor"),
      sellerId: campo(formData, "sellerId"),
      limiteCredito: campo(formData, "limiteCredito"),
      priceListId: campo(formData, "priceListId"),
      notas: campo(formData, "notas"),
    },
  });
  if (r.data) revalidatePath("/admin/clientes");
  return resultado(r, "Revisá los datos.");
}

export async function registrarMovimiento(_previo: EstadoCliente, formData: FormData): Promise<EstadoCliente> {
  const r = await (await api()).POST("/api/v1/admin/clientes/{id}/movimientos", {
    params: { path: { id: campo(formData, "customerId") ?? "" } },
    body: { tipo: campo(formData, "tipo") ?? "", monto: campo(formData, "monto") ?? "", detalle: campo(formData, "detalle") },
  });
  if (r.data) revalidatePath("/admin/clientes");
  return resultado(r, "Revisá los datos.");
}

export async function vincularCuentaWeb(_previo: EstadoCliente, formData: FormData): Promise<EstadoCliente> {
  const r = await (await api()).POST("/api/v1/admin/clientes/{id}/cuenta-web", {
    params: { path: { id: campo(formData, "customerId") ?? "" } },
    body: { cuentaWebId: campo(formData, "cuentaWebId") ?? "" },
  });
  if (r.data) {
    revalidatePath("/admin/clientes");
    revalidatePath("/mi-cuenta", "layout");
  }
  return resultado(r, "No pudimos encontrar esos dos clientes. Recargá la pantalla y probá de nuevo.");
}

export async function bloquearCuentaCorriente(customerId: string, bloquear: boolean, motivo: string): Promise<EstadoCliente> {
  const r = await (await api()).PUT("/api/v1/admin/clientes/{id}/bloqueo", {
    params: { path: { id: customerId } },
    body: { bloquear, motivo },
  });
  if (r.data) {
    revalidatePath("/admin/clientes");
    revalidatePath(`/admin/clientes/${customerId}`);
  }
  return resultado(r, "No se pudo actualizar la cuenta.");
}

export async function cambiarPlazoDePago(customerId: string, dias: number): Promise<EstadoCliente> {
  if (!Number.isFinite(dias)) return { error: "El plazo va en días, de 0 a 365." };
  const r = await (await api()).PUT("/api/v1/admin/clientes/{id}/plazo", {
    params: { path: { id: customerId } },
    body: { dias },
  });
  if (r.data) {
    revalidatePath("/admin/clientes");
    revalidatePath(`/admin/clientes/${customerId}`);
  }
  return resultado(r, "El plazo va en días, de 0 a 365.");
}
