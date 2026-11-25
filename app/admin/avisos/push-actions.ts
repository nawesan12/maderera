"use server";

import { api, mensajeDe, type Problema } from "@/lib/api/servidor";

/*
 * Los avisos al teléfono del panel: suscribir este dispositivo, sacarlo y
 * mandar una prueba. Lo hace la API de Go (backend/internal/avisos); quien
 * los manda de verdad (una venta, un mensaje) es cada módulo.
 */

export interface EstadoPush {
  error?: string;
  ok?: string;
}

function resultado(r: { data?: { ok: string }; error?: unknown }): EstadoPush {
  return r.data ? { ok: r.data.ok } : { error: mensajeDe(r.error as Problema | undefined) };
}

/**
 * La clave pública con la que el navegador se suscribe.
 *
 * Es pública de verdad —va en el paquete que viaja al navegador— y no sirve
 * para mandar nada: firmar el mensaje necesita la privada, que nunca sale del
 * servidor.
 */
export async function claveDePush(): Promise<{ clave: string | null; configurado: boolean }> {
  const r = await (await api()).GET("/api/v1/admin/push");
  return r.data ?? { clave: null, configurado: false };
}

/** Prende los avisos en este dispositivo. */
export async function activarAvisos(suscripcion: {
  endpoint: string;
  p256dh: string;
  auth: string;
  descripcion?: string;
}): Promise<EstadoPush> {
  return resultado(await (await api()).POST("/api/v1/admin/push", { body: suscripcion }));
}

/** Apaga los avisos en este dispositivo. */
export async function desactivarAvisos(endpoint: string): Promise<EstadoPush> {
  return resultado(await (await api()).DELETE("/api/v1/admin/push", { body: { endpoint } }));
}

/**
 * Manda un aviso de prueba.
 *
 * Es lo que convierte «activé los avisos» en «los avisos funcionan»: el permiso
 * del navegador se puede dar y el mensaje igual no llegar —por la clave, por el
 * modo de ahorro del teléfono, por mil cosas—, y eso hay que poder verlo ahora y
 * no el sábado que entre la primera venta.
 */
export async function probarAviso(): Promise<EstadoPush> {
  return resultado(await (await api()).POST("/api/v1/admin/push/prueba"));
}
