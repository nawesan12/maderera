"use server";

import { revalidatePath } from "next/cache";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";

/*
 * Los formatos de exportación para el optimizador. Los valida y guarda la API
 * de Go (backend/internal/cortes): uno solo queda por defecto. Se guardan
 * desde el panel y no desde el código porque acertarle al formato del
 * optimizador es prueba y error contra la máquina.
 */

export interface EstadoPerfil {
  error?: string;
  ok?: string;
}

export async function guardarPerfil(_previo: EstadoPerfil, formData: FormData): Promise<EstadoPerfil> {
  let columnas: unknown = [];
  try {
    columnas = JSON.parse(String(formData.get("columnas") ?? "[]"));
  } catch {
    return { error: "No pudimos guardar las columnas. Revisá que todas tengan nombre." };
  }
  if (!Array.isArray(columnas)) {
    return { error: "No pudimos guardar las columnas. Revisá que todas tengan nombre." };
  }
  const texto = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" ? v : "";
  };
  const r = await (await api()).POST("/api/v1/admin/cortes/perfiles", {
    body: {
      ...(texto("id") ? { id: texto("id") } : {}),
      nombre: texto("nombre"),
      programa: texto("programa"),
      separador: texto("separador") || ";",
      conEncabezado: formData.get("conEncabezado") === "on",
      unidad: texto("unidad") || "mm",
      decimal: texto("decimal") || ",",
      valorSi: texto("valorSi") || "Sí",
      valorNo: texto("valorNo") || "No",
      finDeLinea: texto("finDeLinea") || "crlf",
      columnas: (columnas as { clave?: unknown; encabezado?: unknown }[]).map((c) => ({
        clave: String(c?.clave ?? ""),
        encabezado: String(c?.encabezado ?? ""),
      })),
      porDefecto: formData.get("porDefecto") === "on",
    },
  });
  if (!r.response.ok) return { error: mensajeDe(r.error as Problema | undefined, "Revisá los datos.") };
  revalidatePath("/admin/cortes/formato");
  return { ok: "Formato guardado." };
}

export async function borrarPerfil(_previo: EstadoPerfil, formData: FormData): Promise<EstadoPerfil> {
  const id = String(formData.get("id") ?? "").slice(0, 80);
  const r = await (await api()).DELETE("/api/v1/admin/cortes/perfiles/{perfil}", {
    params: { path: { perfil: id || "x" } },
  });
  if (!r.response.ok) {
    return { error: mensajeDe(r.error as Problema | undefined, "No encontramos ese formato. Puede que lo hayan borrado.") };
  }
  revalidatePath("/admin/cortes/formato");
  return { ok: "Formato borrado." };
}
