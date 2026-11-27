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
 * Los turnos cerrados en el mes (`aaaa-mm`, el argentino), del más nuevo al
 * más viejo, de a `porPagina`, cada uno con su cierre Z (cuánto entró por cada
 * medio) en `cierre`, y cuántos hay en total para paginar.
 */
export async function turnosCerrados(periodo: string, pagina = 1, porPagina = 30) {
  const r = datos(
    await (await api()).GET("/api/v1/admin/caja/turnos-cerrados", {
      params: { query: { periodo, limite: porPagina, desplazamiento: (pagina - 1) * porPagina } },
    }),
  );
  return {
    total: r.total,
    primerMes: r.primerMes ?? null,
    filas: r.filas.map((t) => ({
      ...t,
      abiertaAt: new Date(t.abiertaAt),
      cerradaAt: t.cerradaAt ? new Date(t.cerradaAt) : null,
    })),
  };
}
