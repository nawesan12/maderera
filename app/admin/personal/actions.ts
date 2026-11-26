"use server";

import { revalidatePath } from "next/cache";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";
import type { RolStaff } from "@/lib/roles";

/* El personal: alta, puesto y baja. Lo hace la API de Go (backend/internal/clientes/personal.go). */

export interface EstadoPersonal {
  error?: string;
  ok?: string;
}

function revalidar() {
  revalidatePath("/admin/personal");
  // El alta de un vendedor lo suma a Vendedores.
  revalidatePath("/admin/clientes/vendedores");
}

export async function darDeAlta(_previo: EstadoPersonal, formData: FormData): Promise<EstadoPersonal> {
  const r = await (await api()).POST("/api/v1/admin/personal", {
    body: {
      nombre: (formData.get("nombre") as string | null) ?? "",
      correo: (formData.get("correo") as string | null) ?? "",
      rol: ((formData.get("rol") as string | null) ?? "vendedor") as RolStaff,
      clave: (formData.get("clave") as string | null) ?? "",
    },
  });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "Revisá los datos.") };
  revalidar();
  return { ok: r.data.ok };
}

export async function cambiarPuesto(id: string, rol: RolStaff): Promise<EstadoPersonal> {
  const r = await (await api()).POST("/api/v1/admin/personal/{id}/puesto", {
    params: { path: { id } },
    body: { rol },
  });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "No se pudo cambiar el puesto.") };
  revalidar();
  return { ok: r.data.ok };
}

export async function darDeBaja(id: string): Promise<EstadoPersonal> {
  const r = await (await api()).POST("/api/v1/admin/personal/{id}/baja", { params: { path: { id } } });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "No se pudo dar la baja.") };
  revalidar();
  return { ok: r.data.ok };
}
