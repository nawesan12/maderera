import "server-only";

import { api, datos } from "@/lib/api/servidor";
import type { Esquemas } from "@/lib/api/tipos";
import type { Periodo } from "@/lib/periodos";
import type { CorteDelReporte } from "@/lib/reportes-cortes";

/**
 * Los números de venta, cortados por donde se los mira: qué se vende, quién
 * compra, quién vende, en qué sucursal. Los arma la API de Go
 * (backend/internal/reportes/ventas.go), con el período en hora argentina.
 *
 * **Las canceladas quedan afuera de todo.** El margen sale sin IVA renglón por
 * renglón, y los renglones sin costo se cuentan aparte (no como costo cero).
 */

export type FilaDeReporte = Esquemas["ReporteFila"];
export type MesDelReporte = Esquemas["ReporteMes"];

/**
 * Con qué se acota el reporte, además del período: el rubro del **cliente**
 * (ver `lib/rubros-cliente.ts`) y la sucursal.
 */
export interface FiltrosDeReporte {
  rubro?: string;
  sucursal?: string;
}

function consulta(periodo: Periodo, filtros: FiltrosDeReporte) {
  return {
    periodo: periodo.clave,
    ...(filtros.rubro ? { rubro: filtros.rubro } : {}),
    ...(filtros.sucursal ? { sucursal: filtros.sucursal } : {}),
  };
}

/*
 * Los cortes y su lectura viven en `lib/reportes-cortes.ts`, que no es
 * `server-only`: los botones que eligen el corte corren en el navegador.
 */
export { CORTES, leerCorte, type CorteDelReporte } from "@/lib/reportes-cortes";

/** El reporte pedido, sin que la pantalla tenga que saber cuál es cuál. */
export async function reporteDeVentas(
  corte: CorteDelReporte,
  periodo: Periodo,
  filtros: FiltrosDeReporte = {},
): Promise<FilaDeReporte[]> {
  return datos(
    await (await api()).GET("/api/v1/admin/reportes/ventas", {
      params: { query: { corte, ...consulta(periodo, filtros) } },
    }),
  );
}

/**
 * Lo vendido mes a mes, con los mismos filtros del reporte, con los meses sin
 * ventas en cero: una serie con huecos se lee como si esos meses no
 * existieran.
 */
export async function ventasPorMes(
  periodo: Periodo,
  filtros: FiltrosDeReporte = {},
  meses = 6,
): Promise<MesDelReporte[]> {
  return datos(
    await (await api()).GET("/api/v1/admin/reportes/ventas/meses", {
      params: { query: { ...consulta(periodo, filtros), meses } },
    }),
  );
}
