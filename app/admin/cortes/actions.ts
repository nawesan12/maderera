"use server";

import { revalidatePath } from "next/cache";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";
import type { PiezaFijada } from "@/lib/cortes/tipos";

/*
 * Las acciones de la cola del taller. Las hace la API de Go
 * (backend/internal/cortes): el alta numera CRT- con el mismo candado que el
 * resto del sistema, el cambio de disco rehace el plano con el motor de hoy, y
 * todo queda en la bitácora. Acá se pasa el formulario y se revalida.
 */

export interface EstadoCorte {
  error?: string;
  ok?: string;
}

function fallo(r: { error?: unknown }, porDefecto?: string): EstadoCorte {
  return { error: mensajeDe(r.error as Problema | undefined, porDefecto) };
}

/** Avanza el corte al siguiente paso de la cola. */
export async function avanzarCorte(id: string): Promise<EstadoCorte> {
  const r = await (await api()).POST("/api/v1/admin/cortes/{id}/avanzar", { params: { path: { id } } });
  if (!r.data) return fallo(r, "No se encontró el corte.");
  revalidatePath("/admin/cortes");
  revalidatePath("/admin");
  return { ok: r.data.ok };
}

/** Marca o desmarca el corte como urgente, que es lo que ordena la cola. */
export async function alternarUrgente(id: string): Promise<EstadoCorte> {
  const r = await (await api()).POST("/api/v1/admin/cortes/{id}/urgente", { params: { path: { id } } });
  if (!r.data) return fallo(r, "No se encontró el corte.");
  revalidatePath("/admin/cortes");
  return { ok: r.data.ok };
}

/** Da de alta una orden de corte. */
export async function crearCorte(_previo: EstadoCorte, formData: FormData): Promise<EstadoCorte> {
  const campo = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" && v !== "" ? v : undefined;
  };
  const piezas: Record<string, unknown>[] = [];
  for (const cruda of formData.getAll("pieza").map(String)) {
    try {
      const p: unknown = JSON.parse(cruda);
      if (typeof p !== "object" || p === null || Array.isArray(p)) throw new Error();
      piezas.push(p as Record<string, unknown>);
    } catch {
      return { error: "Hay una pieza con medidas incompletas." };
    }
  }
  const r = await (await api()).POST("/api/v1/admin/cortes", {
    body: {
      customerId: campo("customerId"),
      orderId: campo("orderId"),
      contactoNombre: String(formData.get("contactoNombre") ?? ""),
      branchId: campo("branchId"),
      variantId: campo("variantId"),
      materialDescripcion: String(formData.get("materialDescripcion") ?? ""),
      placaLargoMm: campo("placaLargoMm"),
      placaAnchoMm: campo("placaAnchoMm"),
      mitad: campo("mitad"),
      placas: campo("placas"),
      cantoDescripcion: campo("cantoDescripcion"),
      urgente: formData.get("urgente") === "si",
      notas: campo("notas"),
      acomodoManual: campo("acomodoManual"),
      anchoSierraMm: campo("anchoSierraMm"),
      piezas,
    },
  });
  if (!r.data) return fallo(r, "Revisá los datos.");
  revalidatePath("/admin/cortes");
  revalidatePath("/taller");
  return { ok: `Se cargó el corte ${r.data.numero}.` };
}

/** Carga las pasadas de sierra de un trabajo, que es lo que lo hace cobrable. */
export async function cargarPasadas(id: string, pasadas: number): Promise<EstadoCorte> {
  const n = Number(pasadas);
  const r = await (await api()).POST("/api/v1/admin/cortes/{id}/pasadas", {
    params: { path: { id } },
    body: { pasadas: Number.isFinite(n) ? n : 0 },
  });
  if (!r.response.ok) return fallo(r, "No encontramos la orden de corte.");
  revalidatePath(`/admin/cortes/${id}`);
  revalidatePath("/admin/cortes");
  return { ok: "Pasadas cargadas." };
}

/** Guarda el acomodo que alguien corrigió a mano sobre el plano. */
export async function guardarAcomodoManual(id: string, fijadas: PiezaFijada[]): Promise<EstadoCorte> {
  const r = await (await api()).PUT("/api/v1/admin/cortes/{id}/acomodo", {
    params: { path: { id } },
    body: {
      fijadas: fijadas.map((f) => ({
        indice: f.indice,
        unidad: f.unidad,
        placa: f.placa,
        ...(typeof f.girada === "boolean" ? { girada: f.girada } : {}),
      })),
    },
  });
  if (!r.data) return fallo(r, "No encontramos la orden de corte.");
  revalidatePath(`/admin/cortes/${id}`);
  revalidatePath(`/plano/${id}`);
  return { ok: r.data.ok };
}

/** Cambia el disco de un trabajo que todavía no se cortó, y recalcula. */
export async function cambiarAnchoDeSierra(id: string, valor: string): Promise<EstadoCorte> {
  const r = await (await api()).PUT("/api/v1/admin/cortes/{id}/sierra", {
    params: { path: { id } },
    body: { valor: String(valor).slice(0, 40) },
  });
  if (!r.data) return fallo(r, "El disco tiene que medir entre 0,5 y 10 mm.");
  revalidatePath(`/admin/cortes/${id}`);
  revalidatePath(`/plano/${id}`);
  return { ok: r.data.ok };
}
