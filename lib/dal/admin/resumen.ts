import "server-only";

import { api, datos } from "@/lib/api/servidor";
import type { Periodo } from "@/lib/periodos";

/**
 * Los números del resumen del panel, que solo ve administración. Los arma la
 * API de Go (backend/internal/reportes/inicio.go), con «este mes» y los meses
 * del gráfico en hora argentina.
 *
 * Las ventas cuentan pedidos no cancelados: un pedido cancelado nunca fue una
 * venta, y dejarlo sumando infla el mes sin que se note.
 */
export async function metricasDelResumen(periodo?: Periodo) {
  return datos(
    await (await api()).GET("/api/v1/admin/inicio/metricas", {
      params: { query: { periodo: periodo?.clave ?? "mes" } },
    }),
  );
}

/** Ventas por sucursal de los últimos seis meses, para el gráfico. */
export async function ventasPorSucursal() {
  return datos(await (await api()).GET("/api/v1/admin/inicio/ventas-por-sucursal"));
}

/** Lo que hay que reponer, con su sucursal, lo más urgente primero. */
export async function stockParaReponer(limite = 5) {
  return datos(await (await api()).GET("/api/v1/admin/inicio/reponer", { params: { query: { limite } } }));
}

/** Últimos presupuestos y pedidos, para las listas del resumen. */
export async function actividadReciente() {
  const a = datos(await (await api()).GET("/api/v1/admin/inicio/actividad"));
  return {
    presupuestos: a.presupuestos.map((p) => ({ ...p, createdAt: new Date(p.createdAt) })),
    pedidos: a.pedidos.map((p) => ({ ...p, createdAt: new Date(p.createdAt) })),
    cortesEnCola: a.cortesEnCola,
  };
}
