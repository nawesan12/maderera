import "server-only";

import { api, apiPublica } from "@/lib/api/servidor";
import type { components } from "@/lib/api/tipos/cortes";

export type ConsultaDeCorte = components["schemas"]["ConsultaDeCorte"];
export type GrupoDeConsulta = components["schemas"]["GrupoDeConsulta"];

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

export type ContactoDeLaConsulta = components["schemas"]["ContactoDeLaConsulta"];

/**
 * Quién mandó la consulta por WhatsApp (el cliente de la conversación, su
 * nombre y su teléfono), para que el alta del corte no arranque vacía.
 * Todo nulo si no salió de una conversación o si no se pudo leer.
 */
export async function contactoDeLaConsulta(token: string): Promise<ContactoDeLaConsulta | null> {
  const r = await (await api()).GET("/api/v1/admin/cortes/consulta/{token}/contacto", {
    params: { path: { token: token.slice(0, 40) } },
  });
  return r.data ?? null;
}
