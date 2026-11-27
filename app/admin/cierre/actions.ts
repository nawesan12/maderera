"use server";

import { revalidatePath } from "next/cache";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";

export interface EstadoDelCierre {
  error?: string;
}

/**
 * Cierra o reabre el mes. El candado lo pone la base (backend/db/migraciones/
 * 00221): con el mes cerrado no se carga, cambia ni borra nada con fecha de
 * ese mes, así lo que tiene el estudio no cambia.
 */
export async function cerrarElMes(_previo: EstadoDelCierre, formData: FormData): Promise<EstadoDelCierre> {
  const periodo = String(formData.get("periodo") ?? "");
  if (!/^\d{4}-\d{2}$/.test(periodo)) return { error: "No entendimos el mes." };
  const cerrado = formData.get("cerrado") === "si";
  const motivo = String(formData.get("motivo") ?? "").trim();
  if (!cerrado && !motivo) return { error: "Escribí por qué se reabre el mes." };
  const r = await (await api()).POST("/api/v1/admin/cierre/cerrado", {
    body: { periodo, cerrado, ...(motivo ? { motivo: motivo.slice(0, 300) } : {}) },
  });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined) };
  revalidatePath("/admin/cierre");
  return {};
}

/** «12.345,67» o «12345.67» a número; vacío es 0. */
function importe(v: FormDataEntryValue | null): number {
  const t = String(v ?? "").trim().replace(/\s|\$/g, "");
  if (!t) return 0;
  const normal = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  return Number(normal);
}

/** Anota lo que liquidó la tarjeta: pasa de Tarjetas a acreditar al Banco. */
export async function cargarLiquidacion(_previo: EstadoDelCierre, formData: FormData): Promise<EstadoDelCierre> {
  const fecha = String(formData.get("fecha") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { error: "Elegí la fecha de la liquidación." };
  const bruto = importe(formData.get("bruto"));
  const comision = importe(formData.get("comision"));
  if (!Number.isFinite(bruto) || bruto <= 0) return { error: "Escribí lo que liquidó la tarjeta." };
  if (!Number.isFinite(comision) || comision < 0 || comision >= bruto) return { error: "La comisión tiene que ser menor que lo liquidado." };
  const r = await (await api()).POST("/api/v1/admin/cierre/liquidaciones", { body: { fecha, bruto, comision } });
  if (!r.response.ok) return { error: mensajeDe(r.error as Problema | undefined, "Revisá los importes.") };
  revalidatePath("/admin/cierre");
  return {};
}
