import "server-only";

import { urlBase } from "./config";
import type {
  AvisoEntrante,
  EstadoRemoto,
  PagoRemoto,
  Preferencia,
  ProveedorPagos,
  SolicitudPreferencia,
} from "./tipos";

/**
 * Proveedor de demostración.
 *
 * MJBJ todavía no entregó las credenciales de Mercado Pago —es un ítem de la
 * lista de insumos pendientes—, y esperarlas para escribir el checkout dejaría
 * el módulo entero sin probar hasta el final del proyecto. Es la misma decisión
 * que se tomó con WhatsApp y con ARCA, y por la misma razón: el camino de
 * demostración recorre exactamente el mismo código que el real, salvo la
 * llamada HTTP a Mercado Pago.
 *
 * En vez de un checkout externo, manda a `/pago-demo/[id]`, una pantalla con
 * dos botones que disparan el mismo procesamiento de aviso que dispararía
 * Mercado Pago.
 *
 * El estado va codificado en el id del pago simulado (`demo-<pago>-aprobado`)
 * para no necesitar una tabla de más: el proveedor de demostración no debería
 * dejar rastro en el modelo.
 */

const PREFIJO = "demo-";

export function idSimulado(pagoId: string, estado: EstadoRemoto): string {
  return `${PREFIJO}${pagoId}-${estado}`;
}

function leerIdSimulado(
  id: string,
): { pagoId: string; estado: EstadoRemoto } | null {
  if (!id.startsWith(PREFIJO)) return null;

  const resto = id.slice(PREFIJO.length);
  const corte = resto.lastIndexOf("-");
  if (corte < 0) return null;

  const pagoId = resto.slice(0, corte);
  const estado = resto.slice(corte + 1) as EstadoRemoto;

  const conocidos: EstadoRemoto[] = [
    "pendiente",
    "aprobado",
    "rechazado",
    "reintegrado",
    "cancelado",
  ];

  return conocidos.includes(estado) ? { pagoId, estado } : null;
}

export const proveedorDemo: ProveedorPagos = {
  nombre: "demo",
  real: false,

  async crearPreferencia(
    solicitud: SolicitudPreferencia,
  ): Promise<Preferencia> {
    return {
      preferenciaId: `pref-demo-${solicitud.referencia}`,
      urlPago: `${urlBase()}/pago-demo/${solicitud.referencia}`,
    };
  },

  async consultarPago(id: string): Promise<PagoRemoto | null> {
    const leido = leerIdSimulado(id);
    if (!leido) return null;

    return {
      id,
      estado: leido.estado,
      // El proveedor de demostración no inventa importes: el que vale es el que
      // ya está guardado en `payments`.
      monto: null,
      medio: "simulado",
      referencia: leido.pagoId,
      motivoRechazo:
        leido.estado === "rechazado" ? "Rechazo simulado desde la demo" : null,
      crudo: { demo: true, id, estado: leido.estado },
    };
  },

  interpretarAviso(cuerpo: unknown): AvisoEntrante | null {
    const datos = (cuerpo ?? {}) as { data?: { id?: unknown }; id?: unknown };
    const pagoRemotoId = datos.data?.id != null ? String(datos.data.id) : null;
    if (!pagoRemotoId) return null;

    return {
      eventoId: datos.id != null ? String(datos.id) : pagoRemotoId,
      tipo: "payment",
      pagoRemotoId,
    };
  },
};
