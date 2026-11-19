"use server";

import { revalidatePath } from "next/cache";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";

/**
 * El PIN con que un administrador autoriza en el mostrador. Lo guarda Go
 * (PUT /api/v1/sesion/pin), que pide la clave de la cuenta y cuenta los
 * intentos.
 */
export async function cargarPin(clave: string, pin: string): Promise<{ ok?: string; error?: string }> {
  const r = await (await api()).PUT("/api/v1/sesion/pin", { body: { clave, pin } });
  if (!r.response.ok) return { error: mensajeDe(r.error as Problema | undefined, "No se pudo guardar el PIN.") };
  // El aviso «Cargá tu PIN» del inicio se va.
  revalidatePath("/admin");
  return { ok: "PIN guardado." };
}

/**
 * Destraba las autorizaciones: borra los topes de errores del PIN (POST
 * /api/v1/sesion/pin/destrabar). Pide la clave de la cuenta, como cargarlo.
 */
export async function destrabarPin(clave: string): Promise<{ ok?: string; error?: string }> {
  const r = await (await api()).POST("/api/v1/sesion/pin/destrabar", { body: { clave } });
  if (!r.response.ok) return { error: mensajeDe(r.error as Problema | undefined, "No se pudo destrabar.") };
  return { ok: "Autorizaciones destrabadas." };
}
