"use server";

import { revalidatePath } from "next/cache";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";
import { CATEGORIAS_COBRO } from "@/lib/whatsapp/costos";

/**
 * Las acciones de la configuración de WhatsApp. Las hace la API de Go
 * (backend/internal/whatsapp), solo para administración: cada aviso que se
 * prende le manda mensajes a todos los clientes que lleguen a ese estado, y
 * cada uno se cobra.
 */

export interface EstadoAviso {
  error?: string;
  ok?: string;
}

function estado(r: { data?: { error?: string; ok?: string }; error?: unknown; response: Response }): EstadoAviso {
  if (!r.response.ok) return { error: mensajeDe(r.error as Problema | undefined) };
  return { ...(r.data?.error ? { error: r.data.error } : {}), ...(r.data?.ok ? { ok: r.data.ok } : {}) };
}

/** Prende o apaga un aviso automático. */
export async function cambiarAviso(_previo: EstadoAviso, formData: FormData): Promise<EstadoAviso> {
  const r = await (await api()).POST("/api/v1/admin/whatsapp/avisos/{id}", {
    params: { path: { id: String(formData.get("id") ?? "") || "-" } },
    body: { activo: formData.get("activo") === "si" },
  });
  revalidatePath("/admin/whatsapp/configuracion");
  return estado(r);
}

/** Edita el texto que se manda dentro de la ventana de 24 h. */
export async function guardarTextoAviso(_previo: EstadoAviso, formData: FormData): Promise<EstadoAviso> {
  const r = await (await api()).POST("/api/v1/admin/whatsapp/avisos/{id}/texto", {
    params: { path: { id: String(formData.get("id") ?? "") || "-" } },
    body: { textoLibre: String(formData.get("textoLibre") ?? "") },
  });
  revalidatePath("/admin/whatsapp/configuracion");
  return estado(r);
}

/** Trae las plantillas de Meta. */
export async function sincronizar(): Promise<EstadoAviso> {
  const r = await (await api()).POST("/api/v1/admin/whatsapp/plantillas/sincronizar");
  revalidatePath("/admin/whatsapp/configuracion");
  return estado(r);
}

/** El chequeo de la configuración contra Meta. Go lo guarda para mostrarlo después. */
export async function diagnosticar(): Promise<EstadoAviso> {
  const r = await (await api()).POST("/api/v1/admin/whatsapp/diagnostico");
  revalidatePath("/admin/whatsapp/configuracion");
  return estado(r);
}

/**
 * Manda un mensaje de prueba a un número: texto si escribió en las últimas
 * 24 h; si no, `hello_world` o la primera aprobada que sirva.
 */
export async function mensajeDePrueba(_previo: EstadoAviso, formData: FormData): Promise<EstadoAviso> {
  const r = await (await api()).POST("/api/v1/admin/whatsapp/prueba", {
    body: { telefono: String(formData.get("telefono") ?? "").slice(0, 100) },
  });
  revalidatePath("/admin/whatsapp/configuracion");
  return estado(r);
}

/**
 * Guarda el tope del mes y las tarifas de Meta. Si el tope cambia, los avisos
 * de 80 % y 100 % se vuelven a evaluar.
 */
export async function guardarTope(_previo: EstadoAviso, formData: FormData): Promise<EstadoAviso> {
  const campo = (k: string) => String(formData.get(k) ?? "").slice(0, 40);
  const [utility, service, marketing, authentication] = CATEGORIAS_COBRO.map(campo);
  const r = await (await api()).POST("/api/v1/admin/whatsapp/tope", {
    body: { tope: campo("tope"), utility, service, marketing, authentication },
  });
  revalidatePath("/admin/whatsapp/configuracion");
  revalidatePath("/admin/whatsapp");
  return estado(r);
}
