"use server";

import { revalidatePath } from "next/cache";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";

/*
 * Aprobar y rechazar solicitudes de acceso profesional. Lo hace la API de Go
 * (backend/internal/profesionales): en una transacción vincula o crea la
 * ficha (gana la del CUIT y la cuenta web se muda a ella), asigna la lista y
 * el límite, marca el perfil, deja la bitácora y avisa por correo.
 *
 * Los descuentos por volumen no existen: el negocio no los da (ver la nota
 * en la historia de este archivo).
 */

export interface EstadoProfesionales {
  error?: string;
  ok?: string;
}

function refrescar() {
  revalidatePath("/admin/profesionales");
  revalidatePath("/admin/clientes");
  revalidatePath("/profesionales");
}

function resultado(r: { data?: { ok: string }; error?: unknown }): EstadoProfesionales {
  if (r.data) refrescar();
  return r.data ? { ok: r.data.ok } : { error: mensajeDe(r.error as Problema | undefined, "Revisá los datos.") };
}

export async function aprobarSolicitud(_previo: EstadoProfesionales, formData: FormData): Promise<EstadoProfesionales> {
  return resultado(
    await (await api()).POST("/api/v1/admin/profesionales/aprobacion", {
      body: { id: formData.get("id"), priceListId: formData.get("priceListId"), limiteCredito: formData.get("limiteCredito") },
    }),
  );
}

export async function rechazarSolicitud(_previo: EstadoProfesionales, formData: FormData): Promise<EstadoProfesionales> {
  return resultado(
    await (await api()).POST("/api/v1/admin/profesionales/rechazo", {
      body: { id: formData.get("id"), motivo: formData.get("motivo") },
    }),
  );
}
