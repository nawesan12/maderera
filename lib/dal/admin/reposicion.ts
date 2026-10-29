import "server-only";

import { api, datos } from "@/lib/api/servidor";
import type { Esquemas } from "@/lib/api/tipos";

/**
 * El reporte de reposición: stock, ventas y cuánto convendría comprar. Es el
 * pedido 85 de la clienta: un reporte de stock por rubros y sucursal cruzado
 * con las ventas, "accionable para tomar buenas acciones de compra".
 *
 * Lo arma la API de Go (backend/internal/reportes/reposicion.go, la cuenta en
 * puro.go con golden contra el TS de antes). El período se elige en pantalla:
 * un producto estacional medido en su mes fuerte sugiere de más, y eso lo
 * corrige quien mira, no una fórmula.
 */

export type FilaDeReposicion = Esquemas["ReposicionFila"];
export type ReporteDeReposicion = Esquemas["Reposicion"];

export async function reporteDeReposicion(opciones: {
  diasDelPeriodo: number;
  coberturaObjetivo: number;
  categoria?: string;
  /** El rubro, que es el nivel que la clienta llama así. */
  rubro?: string;
  sucursal?: string;
}): Promise<ReporteDeReposicion> {
  return datos(
    await (await api()).GET("/api/v1/admin/reportes/reposicion", {
      params: {
        query: {
          dias: String(opciones.diasDelPeriodo),
          objetivo: String(opciones.coberturaObjetivo),
          ...(opciones.categoria ? { cat: opciones.categoria } : {}),
          ...(opciones.rubro ? { rubro: opciones.rubro } : {}),
          ...(opciones.sucursal ? { sucursal: opciones.sucursal } : {}),
        },
      },
    }),
  );
}
