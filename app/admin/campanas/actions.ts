"use server";

import { revalidatePath } from "next/cache";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";
import type { SegmentoCampana } from "@/lib/dal/admin/campanas";

/*
 * Las campañas de correo. Lo hace la API de Go (backend/internal/campanas):
 * valida como el esquema de zod de antes, guarda, arma el correo de cada
 * persona con su enlace de baja, y manda por tandas desde el worker (la
 * cola `campana.tanda`). Las programadas las arranca el worker cada minuto.
 */

export interface EstadoCampana {
  ok?: string;
  error?: string;
  id?: string;
}

const CAMPOS = ["id", "asunto", "adelanto", "cuerpo", "imagenUrl", "botonTexto", "botonUrl", "tipo", "actividad", "meses"];

/** El formulario tal cual (null lo que falta): Go lo valida como zod. */
function formulario(formData: FormData): Record<string, unknown> {
  const f: Record<string, unknown> = Object.fromEntries(CAMPOS.map((c) => [c, formData.get(c)]));
  f.rubros = formData.getAll("rubros");
  return f;
}

function resultado(
  r: { data?: { ok: string; id?: string }; error?: unknown },
  porDefecto = "Revisá los datos.",
): EstadoCampana {
  return r.data ? { ok: r.data.ok, id: r.data.id } : { error: mensajeDe(r.error as Problema | undefined, porDefecto) };
}

function refrescar(id?: string) {
  revalidatePath("/admin/campanas");
  if (id) revalidatePath(`/admin/campanas/${id}`);
}

export async function guardarCampana(_previo: EstadoCampana, formData: FormData): Promise<EstadoCampana> {
  const r = await (await api()).POST("/api/v1/admin/campanas", { body: formulario(formData) });
  if (r.data) refrescar();
  return resultado(r);
}

/** A cuántas direcciones llega un segmento, para verlo mientras se elige. */
export async function alcanceDelSegmento(
  segmento: SegmentoCampana,
): Promise<{ cantidad: number; descripcion: string; porMinuto: number }> {
  const r = await (await api()).POST("/api/v1/admin/campanas/alcance", {
    body: {
      tipo: segmento.tipo,
      rubros: segmento.rubros,
      actividad: segmento.actividad?.tipo ?? null,
      meses: segmento.actividad?.meses ?? null,
    },
  });
  if (!r.data) throw new Error(mensajeDe(r.error as Problema | undefined));
  return r.data;
}

/** El correo tal cual va a llegar, con el nombre de quien lo está armando. */
export async function vistaPrevia(formData: FormData): Promise<{ html?: string; error?: string }> {
  const r = await (await api()).POST("/api/v1/admin/campanas/vista-previa", { body: formulario(formData) });
  return r.data ? { html: r.data.html } : { error: mensajeDe(r.error as Problema | undefined) };
}

/**
 * Una prueba a la casilla de quien la arma. Es la única forma de ver cómo se
 * ve en Gmail o en el celular antes de mandarla a cientos.
 */
export async function enviarPrueba(formData: FormData): Promise<EstadoCampana> {
  return resultado(await (await api()).POST("/api/v1/admin/campanas/prueba", { body: formulario(formData) }));
}

export async function enviarCampana(id: string): Promise<EstadoCampana> {
  const r = await (await api()).POST("/api/v1/admin/campanas/{id}/envio", { params: { path: { id } } });
  if (r.data) refrescar(id);
  return resultado(r);
}

export async function programarCampana(id: string, cuando: string): Promise<EstadoCampana> {
  const r = await (await api()).PUT("/api/v1/admin/campanas/{id}/programacion", {
    params: { path: { id } },
    body: { cuando },
  });
  if (r.data) refrescar(id);
  return resultado(r);
}

export async function desprogramarCampana(id: string): Promise<EstadoCampana> {
  const r = await (await api()).DELETE("/api/v1/admin/campanas/{id}/programacion", { params: { path: { id } } });
  refrescar(id);
  return resultado(r);
}

/**
 * Corta un envío en curso. Lo que ya salió, salió; lo pendiente queda como
 * omitido, para que el conteo diga exactamente a quién no le llegó.
 */
export async function cancelarEnvio(id: string): Promise<EstadoCampana> {
  const r = await (await api()).DELETE("/api/v1/admin/campanas/{id}/envio", { params: { path: { id } } });
  if (r.data) refrescar(id);
  return resultado(r);
}

export async function duplicarCampana(id: string): Promise<EstadoCampana> {
  const r = await (await api()).POST("/api/v1/admin/campanas/{id}/copia", { params: { path: { id } } });
  if (r.data) refrescar();
  return resultado(r);
}

export async function eliminarBorrador(id: string): Promise<EstadoCampana> {
  const r = await (await api()).DELETE("/api/v1/admin/campanas/{id}", { params: { path: { id } } });
  if (r.data) refrescar();
  return resultado(r);
}
