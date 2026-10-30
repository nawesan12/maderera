import "server-only";

import { api, apiPublica, datos } from "@/lib/api/servidor";
import type { Esquemas } from "@/lib/api/tipos";

/**
 * Lecturas de cobros para las pantallas públicas y del portal. Las contesta
 * Go (backend/internal/pagos, tanda 6).
 */

export interface CobroDelPedido {
  id: string;
  estado: string;
  proveedor: string;
  monto: number;
  comprobanteUrl: string | null;
  motivoRechazo: string | null;
  createdAt: Date;
}

/**
 * Último intento de cobro de un pedido, y si los cobros salen de verdad. Con
 * el mismo permiso que la página de seguimiento (el token, el dueño o el
 * personal); null si no corresponde.
 */
export async function cobroDelPedido(
  numero: string,
  token?: string,
): Promise<{ cobro: CobroDelPedido | null; enVivo: boolean } | null> {
  const r = await (await api()).GET("/api/v1/pagos/pedido/{numero}/cobro", {
    params: { path: { numero: numero.slice(0, 40) }, query: token ? { t: token.slice(0, 64) } : {} },
  });
  if (r.response.status === 404) return null;
  const { cobro, enVivo } = datos(r);
  return { cobro: cobro ? { ...cobro, createdAt: new Date(cobro.createdAt) } : null, enVivo };
}

export type DatosParaTransferir = NonNullable<Esquemas["DatosBancariosDelPanel"]>;

/**
 * Datos bancarios para mostrarle a quien va a transferir. Null cuando
 * todavía no se cargaron: la pantalla no inventa un CBU.
 */
export async function datosParaTransferir(): Promise<DatosParaTransferir | null> {
  return datos(await apiPublica.GET("/api/v1/pagos/datos-para-transferir")).datos ?? null;
}

/** Si los cobros online salen de verdad o son una simulación. */
export async function cobrosEnVivo(): Promise<boolean> {
  return datos(await apiPublica.GET("/api/v1/pagos/estado")).enVivo;
}

export type CobroSimulado = Esquemas["CobroSimulado"];

/**
 * Datos de un cobro para la pantalla de demostración. Go solo devuelve los
 * del proveedor `demo`: la pantalla no puede aprobar un cobro real.
 */
export async function cobroSimulado(pagoId: string): Promise<CobroSimulado | null> {
  const r = await apiPublica.GET("/api/v1/pagos/demo/{id}", { params: { path: { id: pagoId.slice(0, 64) } } });
  if (r.response.status === 404) return null;
  return datos(r);
}
