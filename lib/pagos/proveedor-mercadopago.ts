import "server-only";

import { randomUUID } from "node:crypto";
import { configMercadoPago } from "./config";
import type {
  AvisoEntrante,
  EstadoRemoto,
  PagoRemoto,
  Preferencia,
  ProveedorPagos,
  SolicitudPreferencia,
} from "./tipos";

/**
 * Mercado Pago por HTTP, sin SDK.
 *
 * Son dos endpoints —crear preferencia y consultar pago— y el SDK oficial es un
 * envoltorio delgado sobre ellos. La misma decisión que se tomó con ARCA: una
 * dependencia menos que seguir, y control total sobre qué se manda.
 */

const API = "https://api.mercadopago.com";

/**
 * Traducción de los estados de Mercado Pago a los nuestros.
 *
 * `in_process` y `pending` son distintos allá —uno está en revisión manual y el
 * otro espera que la persona pague en un Rapipago— pero para el negocio son lo
 * mismo: la plata todavía no está. `authorized` tampoco cuenta como cobrado:
 * es una retención sin captura.
 */
function traducirEstado(estado: string, detalle?: string): EstadoRemoto {
  switch (estado) {
    case "approved":
      return "aprobado";
    case "refunded":
    case "charged_back":
      return "reintegrado";
    case "cancelled":
      return "cancelado";
    case "rejected":
      return "rechazado";
    case "pending":
    case "in_process":
    case "in_mediation":
    case "authorized":
      return "pendiente";
    default:
      return detalle === "accredited" ? "aprobado" : "pendiente";
  }
}

interface RespuestaPago {
  id: number | string;
  status: string;
  status_detail?: string;
  transaction_amount?: number;
  payment_method_id?: string;
  payment_type_id?: string;
  external_reference?: string;
}

async function pedir<T>(
  ruta: string,
  init: RequestInit & { idempotencia?: string } = {},
): Promise<T> {
  const config = configMercadoPago();
  if (!config) throw new Error("Mercado Pago no está configurado.");

  const { idempotencia, ...resto } = init;

  const respuesta = await fetch(`${API}${ruta}`, {
    ...resto,
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      "Content-Type": "application/json",
      // Si la red corta después de que Mercado Pago creó la preferencia, el
      // reintento devuelve la misma en lugar de crear una segunda.
      ...(idempotencia ? { "X-Idempotency-Key": idempotencia } : {}),
      ...(resto.headers ?? {}),
    },
    cache: "no-store",
  });

  const texto = await respuesta.text();

  if (!respuesta.ok) {
    throw new Error(
      `Mercado Pago respondió ${respuesta.status}: ${texto.slice(0, 400)}`,
    );
  }

  return texto ? (JSON.parse(texto) as T) : ({} as T);
}

export const proveedorMercadoPago: ProveedorPagos = {
  nombre: "mercado_pago",
  real: true,

  async crearPreferencia(solicitud: SolicitudPreferencia): Promise<Preferencia> {
    const config = configMercadoPago();

    const cuerpo = {
      items: solicitud.items.map((item) => ({
        id: solicitud.referencia,
        title: item.titulo.slice(0, 250),
        quantity: Math.max(1, Math.round(item.cantidad)),
        unit_price: Number(item.precioUnitario.toFixed(2)),
        currency_id: "ARS",
      })),
      payer: solicitud.pagador?.email
        ? {
            name: solicitud.pagador.nombre ?? undefined,
            email: solicitud.pagador.email,
          }
        : undefined,
      external_reference: solicitud.referencia,
      statement_descriptor: "MADERERA JBJ",
      notification_url: solicitud.urlWebhook,
      back_urls: {
        success: solicitud.urlRetorno,
        pending: solicitud.urlRetorno,
        failure: solicitud.urlRetorno,
      },
      auto_return: "approved",
    };

    const respuesta = await pedir<{
      id: string;
      init_point: string;
      sandbox_init_point: string;
    }>("/checkout/preferences", {
      method: "POST",
      body: JSON.stringify(cuerpo),
      idempotencia: `pref-${solicitud.referencia}`,
    });

    // Con credenciales de prueba, `init_point` lleva a un checkout que no
    // acepta las tarjetas de prueba: hay que mandar a la gente al sandbox.
    const url = config?.esProduccion
      ? respuesta.init_point
      : (respuesta.sandbox_init_point ?? respuesta.init_point);

    return { preferenciaId: String(respuesta.id), urlPago: url };
  },

  async consultarPago(id: string): Promise<PagoRemoto | null> {
    const pago = await pedir<RespuestaPago>(`/v1/payments/${id}`);
    if (!pago?.id) return null;

    return {
      id: String(pago.id),
      estado: traducirEstado(pago.status, pago.status_detail),
      monto: Number(pago.transaction_amount ?? 0),
      medio: pago.payment_method_id ?? pago.payment_type_id ?? null,
      referencia: pago.external_reference ?? null,
      motivoRechazo:
        pago.status === "approved" ? null : (pago.status_detail ?? null),
      crudo: pago,
    };
  },

  interpretarAviso(cuerpo: unknown, url: URL): AvisoEntrante | null {
    const datos = (cuerpo ?? {}) as {
      id?: unknown;
      type?: string;
      action?: string;
      data?: { id?: unknown };
    };

    const tipo = datos.type ?? url.searchParams.get("type") ?? "";

    // Mercado Pago avisa también de merchant_order y de suscripciones por la
    // misma URL. Se descartan sin ruido: no son errores.
    if (tipo && tipo !== "payment") return null;

    const pagoRemotoId =
      (datos.data?.id != null ? String(datos.data.id) : null) ??
      url.searchParams.get("data.id") ??
      url.searchParams.get("id");

    if (!pagoRemotoId) return null;

    return {
      // El id del aviso identifica al aviso; si no viene, el id del pago más la
      // acción alcanzan para cortar los reintentos, que repiten ambos.
      eventoId: datos.id != null ? String(datos.id) : `${pagoRemotoId}-${datos.action ?? "payment"}`,
      tipo: datos.action ?? tipo ?? "payment",
      pagoRemotoId,
    };
  },
};

/** Id de aviso para los casos donde Mercado Pago no manda ninguno. */
export function idDeAvisoFallback(): string {
  return randomUUID();
}
