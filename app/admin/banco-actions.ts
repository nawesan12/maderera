"use server";

import { revalidatePath } from "next/cache";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";
import { importeDelCampo, importeIlegible } from "@/lib/formato";
import type { ResultadoDeAccion } from "@/components/admin/usar-accion";

/**
 * Lo que dice el banco ahora, desde la tarjeta «Plata hoy» del inicio
 * (mes simulado, M2S1-027). Go exige el admin y lo anota en la bitácora.
 */
export async function cargarSaldoDelBanco(_: ResultadoDeAccion, datos: FormData): Promise<ResultadoDeAccion> {
  const texto = String(datos.get("monto") ?? "").trim();
  if (!texto || importeIlegible(texto)) return { error: "Escribí el saldo que dice el banco." };
  const r = await (await api()).POST("/api/v1/admin/inicio/saldo-banco", {
    body: { monto: importeDelCampo(texto) },
  });
  if (!r.response.ok) return { error: mensajeDe(r.error as Problema | undefined, "No se pudo guardar el saldo.") };
  revalidatePath("/admin");
  return { ok: "Saldo del banco guardado." };
}
