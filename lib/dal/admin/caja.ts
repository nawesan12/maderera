import "server-only";

import { api, datos } from "@/lib/api/servidor";

/**
 * La caja vista desde el panel: las sucursales con su turno y el historial de
 * turnos cerrados con su cierre Z. Lo arma la API de Go
 * (backend/internal/caja/panel.go); el mostrador tiene lo suyo.
 */

/** Las sucursales activas, en su orden, con el turno abierto si hay. */
export async function sucursalesConCaja() {
  const filas = datos(await (await api()).GET("/api/v1/admin/caja/sucursales"));
  return filas.map((s) => ({ ...s, abiertaAt: s.abiertaAt ? new Date(s.abiertaAt) : null }));
}

/**
 * Los turnos ya cerrados, del más nuevo al más viejo, cada uno con su cierre
 * Z (cuánto entró por cada medio) en `cierre`.
 */
export async function turnosCerrados(limite = 30) {
  const filas = datos(await (await api()).GET("/api/v1/admin/caja/turnos-cerrados", { params: { query: { limite } } }));
  return filas.map((t) => ({
    ...t,
    abiertaAt: new Date(t.abiertaAt),
    cerradaAt: t.cerradaAt ? new Date(t.cerradaAt) : null,
  }));
}
