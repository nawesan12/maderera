"use server";

import { revalidatePath } from "next/cache";
import { api, comoFormulario, mensajeDe, soloCampos, type Problema } from "@/lib/api/servidor";

/*
 * La documentación técnica. La guarda la API de Go
 * (backend/internal/contenido/documentos.go): valida el tipo y la firma del
 * archivo, lo sube y deja la línea en la bitácora. Acá queda revalidar.
 */

export interface EstadoDocumento {
  error?: string;
  ok?: string;
}

function refrescar() {
  revalidatePath("/admin/documentacion");
  revalidatePath("/documentacion");
  revalidatePath("/profesionales");
}

export async function subirDocumento(_previo: EstadoDocumento, formData: FormData): Promise<EstadoDocumento> {
  const r = await (await api()).POST("/api/v1/admin/documentos", {
    body: soloCampos(formData) as never,
    ...comoFormulario,
  });
  if (r.error) return { error: mensajeDe(r.error as Problema, "Revisá los datos.") };
  refrescar();
  return { ok: "Documento publicado." };
}

export async function cambiarVisibilidad(_previo: EstadoDocumento, formData: FormData): Promise<EstadoDocumento> {
  const soloProfesionales = formData.get("soloProfesionales") === "si";
  const r = await (await api()).POST("/api/v1/admin/documentos/{id}/visibilidad", {
    params: { path: { id: String(formData.get("id") ?? "") } },
    body: { soloProfesionales },
  });
  if (r.error) {
    return { error: mensajeDe(r.error as Problema, "No pudimos identificar ese documento. Recargá la pantalla y probá de nuevo.") };
  }
  refrescar();
  return { ok: soloProfesionales ? "Ahora solo lo ven los profesionales." : "Ahora lo ve cualquiera." };
}

async function activar(formData: FormData, activo: boolean, ok: string): Promise<EstadoDocumento> {
  const r = await (await api()).POST("/api/v1/admin/documentos/{id}/activo", {
    params: { path: { id: String(formData.get("id") ?? "") } },
    body: { activo },
  });
  if (r.error) {
    return { error: mensajeDe(r.error as Problema, "No encontramos ese documento. Puede que ya lo hayan dado de baja.") };
  }
  refrescar();
  return { ok };
}

export async function borrarDocumento(_previo: EstadoDocumento, formData: FormData): Promise<EstadoDocumento> {
  return activar(formData, false, "Documento dado de baja.");
}

export async function restaurarDocumento(_previo: EstadoDocumento, formData: FormData): Promise<EstadoDocumento> {
  return activar(formData, true, "El documento vuelve a estar en línea.");
}
