import "server-only";

import { api, datos } from "@/lib/api/servidor";
import type { Esquemas } from "@/lib/api/tipos";

/**
 * Eventos y sus inscriptos, para el panel (el ACCESO de /admin/eventos). Los
 * sirve la API de Go (backend/internal/profesionales/eventos.go), que también
 * resuelve `proximo` y `recaudado` (lo cobrado: solo lo confirmado).
 */

export type EventoAdmin = Omit<Esquemas["EventoAdmin"], "inicia" | "termina"> & { inicia: Date; termina: Date | null };

export async function listarEventos(): Promise<EventoAdmin[]> {
  const filas = datos(await (await api()).GET("/api/v1/admin/eventos"));
  return filas.map((e) => ({ ...e, inicia: new Date(e.inicia), termina: e.termina ? new Date(e.termina) : null }));
}

export type Asistente = Omit<Esquemas["AsistenteEvento"], "recordadoAt" | "createdAt"> & {
  recordadoAt: Date | null;
  createdAt: Date;
};

export async function asistentesDe(eventId: string): Promise<Asistente[]> {
  const filas = datos(
    await (await api()).GET("/api/v1/admin/eventos/{id}/asistentes", { params: { path: { id: eventId } } }),
  );
  return filas.map((a) => ({ ...a, recordadoAt: a.recordadoAt ? new Date(a.recordadoAt) : null, createdAt: new Date(a.createdAt) }));
}
