"use server";

import { secretoDeBajas, verificarBaja } from "@/lib/campanas/baja";
import { darDeBaja, volverARecibir } from "@/lib/campanas/bajas";

/** La baja desde la página: el mismo enlace firmado, confirmado con un botón. */
export async function confirmarBaja(e: string, t: string, recibir: boolean): Promise<{ ok?: true; error?: string }> {
  const email = verificarBaja(e, t, secretoDeBajas());
  if (!email) return { error: "El enlace no es válido." };
  if (recibir) await volverARecibir(email);
  else await darDeBaja(email, "enlace");
  return { ok: true };
}
