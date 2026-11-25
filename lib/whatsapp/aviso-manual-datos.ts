import "server-only";

import { api, datos } from "@/lib/api/servidor";
import type { components } from "@/lib/api/tipos/whatsapp";
import type { EventoManual } from "./aviso-manual";

type Esquemas = components["schemas"];

/**
 * Los datos del botón «Avisar por WhatsApp». Los arma la API de Go
 * (backend/internal/whatsapp/avisomanual_datos.go): el texto de la plantilla
 * con los datos reales, el enlace de wa.me y la historia del aviso. Lo llaman
 * las páginas del panel.
 */

export type TipoEntidad = "order" | "cutting_order" | "quote" | "receipt" | "cheque" | "customer" | "invoice" | "delivery";

export const TIPOS_ENTIDAD: TipoEntidad[] = ["order", "cutting_order", "quote", "receipt", "cheque", "customer", "invoice", "delivery"];

export type HistoriaDelAviso = Esquemas["Historia"];
export type AvisoManualListo = Omit<Esquemas["AvisoManual"], "evento" | "entidadTipo"> & {
  evento: EventoManual;
  entidadTipo: TipoEntidad;
};

async function pedir(evento: EventoManual, tipo: TipoEntidad, ids: string[], saldo?: string) {
  if (ids.length === 0) return {};
  const r = await (await api()).GET("/api/v1/admin/whatsapp/avisos-manuales", {
    params: { query: { evento, tipo, ids: ids.join(","), ...(saldo ? { saldo } : {}) } },
  });
  return datos(r) as Record<string, AvisoManualListo>;
}

/**
 * Todo lo que necesita el botón para un aviso.
 *
 * @param extra valores que la página ya tiene (el saldo de la cuenta).
 * @returns null si la entidad no existe.
 */
export async function avisoManual(
  evento: EventoManual,
  entidad: { tipo: TipoEntidad; id: string },
  extra?: Record<string, string>,
): Promise<AvisoManualListo | null> {
  const todos = await pedir(evento, entidad.tipo, [entidad.id], extra?.saldo);
  return todos[entidad.id] ?? null;
}

/** Varios a la vez, para un tablero: los que no existen se descartan. */
export async function avisosManuales(evento: EventoManual, tipo: TipoEntidad, ids: string[]): Promise<Record<string, AvisoManualListo>> {
  return pedir(evento, tipo, ids);
}

/** El recibo de los últimos tres días, para avisarle desde la ficha del cliente. */
export async function avisoDelUltimoRecibo(customerId: string): Promise<AvisoManualListo | null> {
  const r = await (await api()).GET("/api/v1/admin/whatsapp/avisos-manuales/ultimo-recibo/{customerId}", {
    params: { path: { customerId: customerId || "-" } },
  });
  return (datos(r) as AvisoManualListo | null) ?? null;
}
