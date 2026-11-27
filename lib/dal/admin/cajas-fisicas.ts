import "server-only";

import { api, datos } from "@/lib/api/servidor";

/**
 * Las máquinas que venden en el mostrador.
 *
 * Se administran desde el panel y no desde la máquina misma. Es la decisión de
 * fondo del módulo: **el código lo asigna el servidor**. Si cada navegador se
 * autobautiza, dos terminan llamándose `CAJA1`, y como el número provisorio se
 * imprime en el papel del cliente, dos personas distintas se van del local con
 * el mismo comprobante en la mano.
 *
 * Lo del panel lo lee la API de Go (backend/internal/caja/panel.go).
 */

export async function listarCajasFisicas() {
  const filas = datos(await (await api()).GET("/api/v1/admin/caja/cajas-fisicas"));
  return filas.map((c) => ({
    ...c,
    ultimaVezAt: c.ultimaVezAt ? new Date(c.ultimaVezAt) : null,
    ultimoTurnoAt: c.ultimoTurnoAt ? new Date(c.ultimoTurnoAt) : null,
  }));
}

/**
 * El efectivo del mes que no pasó por ningún turno: recibos cobrados en
 * efectivo desde el panel, gastos en efectivo cargados sin caja abierta y
 * pagos a proveedores en efectivo sin caja. El
 * asiento mueve la cuenta Caja, pero ningún arqueo lo incluía (H157).
 */
export async function efectivoFueraDeCaja(periodo: string) {
  const filas = datos(await (await api()).GET("/api/v1/admin/caja/fuera-de-caja", { params: { query: { periodo } } }));
  return filas.map((f) => ({ ...f, fecha: new Date(f.fecha) }));
}

/**
 * Ventas en efectivo que no cayeron en ningún turno: las que se cobraron sin
 * conexión mientras no había ninguna caja abierta. El trabajo que queda es
 * humano: decir a qué turno pertenece.
 */
export async function ventasSinCaja() {
  const filas = datos(await (await api()).GET("/api/v1/admin/caja/ventas-sueltas"));
  return filas.map((v) => ({
    ...v,
    cobradaAt: v.cobradaAt ? new Date(v.cobradaAt) : null,
    createdAt: new Date(v.createdAt),
  }));
}

/**
 * Los turnos a los que se puede mandar una venta suelta, con la etiqueta del
 * selector ya escrita en hora argentina.
 */
export async function turnosParaAsignar(branchId: string) {
  const filas = datos(
    await (await api()).GET("/api/v1/admin/caja/turnos-para-asignar", { params: { query: { sucursal: branchId } } }),
  );
  return filas.map((t) => ({
    ...t,
    abiertaAt: new Date(t.abiertaAt),
    cerradaAt: t.cerradaAt ? new Date(t.cerradaAt) : null,
  }));
}

/**
 * Qué emitió cada caja en el mes (`2026-03`, hora argentina), para poder
 * levantarlo desde otro equipo: por caja y por persona, con el número
 * provisorio que trae el cliente en el ticket.
 */
/**
 * Las anulaciones del mostrador del mes por quien las hizo, contadas en Go
 * por la fecha de la anulación y sin el tope de lo emitido.
 */
export async function anulacionesPorPersona(periodo: string) {
  return datos(await (await api()).GET("/api/v1/admin/caja/anulaciones", { params: { query: { periodo } } }));
}

/**
 * Con los totales del mes y no de la página: la lista cortaba en 200 sin
 * decirlo (mes simulado, M3S2-040). `pagina` empieza en 1.
 */
export async function emitidoPorCaja(periodo: string, pagina = 1, porPagina = 200) {
  const r = datos(
    await (await api()).GET("/api/v1/admin/caja/emitido", {
      params: { query: { periodo, limite: porPagina, desplazamiento: (pagina - 1) * porPagina } },
    }),
  );
  return {
    resumen: r.resumen,
    filas: r.filas.map((v) => ({
      ...v,
      createdAt: new Date(v.createdAt),
      anuladaAt: v.anuladaAt ? new Date(v.anuladaAt) : null,
    })),
  };
}

/** Lo que tiene la caja fuerte de cada sucursal (00350). */
export async function cajasFuertes() {
  const filas = datos(await (await api()).GET("/api/v1/admin/caja/cajas-fuertes"));
  return filas.map((c) => ({ ...c, ultimoDeposito: c.ultimoDeposito ? new Date(c.ultimoDeposito) : null }));
}
