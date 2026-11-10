import "server-only";

import { apiPublica } from "@/lib/api/servidor";
import type { components } from "@/lib/api/tipos/cortes";

export type ConsultaDeCorte = components["schemas"]["ConsultaDeCorte"];

/**
 * Un corte que alguien mandó por WhatsApp, por el token del enlace. Null si
 * no existe. No se cachea: lo abre una sola persona, una vez.
 */
export async function consultaDeCorte(token: string): Promise<ConsultaDeCorte | null> {
  const r = await apiPublica.GET("/api/v1/cortes/consulta/{token}", {
    params: { path: { token: token.slice(0, 40) } },
  });
  return r.data ?? null;
}
