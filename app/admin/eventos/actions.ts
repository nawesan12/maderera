"use server";

import { revalidatePath, updateTag } from "next/cache";
import { ETIQUETAS } from "@/lib/cache-publico";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";

/*
 * El panel de eventos. Lo hace la API de Go
 * (backend/internal/profesionales/eventos.go): el alta (nace en borrador,
 * con la fecha en hora de Buenos Aires), publicar o cerrar, la asistencia y
 * los recordatorios del día anterior (que además manda solo el worker, a las
 * 7). Acá quedan las invalidaciones de la caché del sitio.
 */

export interface EstadoEvento {
  error?: string;
  ok?: string;
}

function refrescar() {
  // Los eventos del sitio están cacheados entre visitas: sin expirar la
  // etiqueta, una capacitación recién publicada tardaría en aparecer.
  updateTag(ETIQUETAS.eventos);
  revalidatePath("/admin/eventos");
  revalidatePath("/eventos");
  revalidatePath("/profesionales");
}

function resultado(r: { data?: { ok: string }; error?: unknown }): EstadoEvento {
  if (r.data) refrescar();
  return r.data ? { ok: r.data.ok } : { error: mensajeDe(r.error as Problema | undefined, "Revisá los datos.") };
}

/**
 * Alta de un evento.
 *
 * Nace en borrador: publicar es una decisión aparte. Cargar la fecha, el lugar
 * y el precio de una capacitación lleva varios minutos, y un evento a medio
 * cargar visible en el sitio es peor que ninguno.
 */
export async function crearEvento(_previo: EstadoEvento, formData: FormData): Promise<EstadoEvento> {
  const campo = (c: string) => formData.get(c);
  return resultado(
    await (await api()).POST("/api/v1/admin/eventos", {
      body: {
        titulo: campo("titulo"),
        resumen: campo("resumen"),
        descripcion: campo("descripcion"),
        lugar: campo("lugar"),
        inicia: campo("inicia"),
        termina: campo("termina"),
        cupo: campo("cupo") ?? 0,
        precio: campo("precio"),
        soloProfesionales: campo("soloProfesionales") === "on",
      },
    }),
  );
}

export async function cambiarEstadoEvento(_previo: EstadoEvento, formData: FormData): Promise<EstadoEvento> {
  return resultado(
    await (await api()).PUT("/api/v1/admin/eventos/estado", {
      body: { id: formData.get("id"), estado: formData.get("estado") },
    }),
  );
}

/** Toma asistencia: quién vino y quién no. */
export async function marcarAsistencia(_previo: EstadoEvento, formData: FormData): Promise<EstadoEvento> {
  return resultado(
    await (await api()).PUT("/api/v1/admin/eventos/asistencia", {
      body: { id: formData.get("id"), estado: formData.get("estado") },
    }),
  );
}

/**
 * Manda los recordatorios de los eventos de mañana, a mano. El worker de Go
 * los manda solo todos los días a las 7; el botón queda para el evento que
 * se cargó tarde.
 */
export async function mandarRecordatorios(_previo: EstadoEvento): Promise<EstadoEvento> {
  return resultado(await (await api()).POST("/api/v1/admin/eventos/recordatorios"));
}
