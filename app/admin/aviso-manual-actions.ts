"use server";

import { api } from "@/lib/api/servidor";

/**
 * Deja constancia de que alguien avisó por WhatsApp desde la app del teléfono.
 *
 * Lo llama el botón al abrir wa.me. No manda nada —eso lo hace la persona en
 * su WhatsApp—: la API de Go registra en `notifications_log` con canal
 * `whatsapp_manual` quién fue y cuándo (un doble clic no deja dos filas), con
 * el rol de la bandeja.
 */
export async function registrarAvisoManual(datos: {
  evento: string;
  entidadTipo: string;
  entidadId: string;
  telefono: string | null;
}): Promise<{ ok?: true; error?: string }> {
  const r = await (await api()).POST("/api/v1/admin/whatsapp/avisos-manuales/registro", {
    body: { evento: datos.evento, entidadTipo: datos.entidadTipo, entidadId: datos.entidadId, telefono: datos.telefono },
  });
  if (!r.response.ok || r.data?.error) return { error: r.data?.error ?? "No se pudo registrar el aviso." };
  return { ok: true };
}
