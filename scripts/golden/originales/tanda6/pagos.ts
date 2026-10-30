/**
 * Copias textuales de lo puro de lib/pagos (791cc3f), que se borró en la
 * tanda 6: lo que el golden de checkout corre para que internal/pagos dé lo
 * mismo. Sin `server-only` y con la configuración pasada como argumento
 * (configMercadoPago() leía el entorno).
 */

export type EstadoRemoto = "pendiente" | "aprobado" | "rechazado" | "reintegrado" | "cancelado";

export interface ItemPreferencia {
  titulo: string;
  cantidad: number;
  precioUnitario: number;
}

export interface SolicitudPreferencia {
  referencia: string;
  descripcion: string;
  monto: number;
  items: ItemPreferencia[];
  pagador?: { nombre?: string | null; email?: string | null };
  urlRetorno: string;
  urlWebhook: string;
}

export interface PagoRemoto {
  id: string;
  estado: EstadoRemoto;
  monto: number | null;
  medio: string | null;
  referencia: string | null;
  motivoRechazo: string | null;
  crudo: unknown;
}

export interface AvisoEntrante {
  eventoId: string;
  tipo: string;
  pagoRemotoId: string | null;
}

/* ------------------- lib/pagos/proveedor-mercadopago.ts ------------------- */

export function traducirEstado(estado: string, detalle?: string): EstadoRemoto {
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

export interface RespuestaPago {
  id: number | string;
  status: string;
  status_detail?: string;
  transaction_amount?: number;
  payment_method_id?: string;
  payment_type_id?: string;
  external_reference?: string;
}

/** El cuerpo que crearPreferencia le manda a POST /checkout/preferences. */
export function cuerpoDePreferencia(solicitud: SolicitudPreferencia) {
  return {
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
}

/** consultarPago sin el fetch: la respuesta de GET /v1/payments/{id}. */
export function pagoDeMercadoPago(pago: RespuestaPago): PagoRemoto | null {
  if (!pago?.id) return null;

  return {
    id: String(pago.id),
    estado: traducirEstado(pago.status, pago.status_detail),
    monto: Number(pago.transaction_amount ?? 0),
    medio: pago.payment_method_id ?? pago.payment_type_id ?? null,
    referencia: pago.external_reference ?? null,
    motivoRechazo: pago.status === "approved" ? null : (pago.status_detail ?? null),
    crudo: pago,
  };
}

export function interpretarAvisoMP(cuerpo: unknown, url: URL): AvisoEntrante | null {
  const datos = (cuerpo ?? {}) as {
    id?: unknown;
    type?: string;
    action?: string;
    data?: { id?: unknown };
  };

  const tipo = datos.type ?? url.searchParams.get("type") ?? "";

  if (tipo && tipo !== "payment") return null;

  const pagoRemotoId =
    (datos.data?.id != null ? String(datos.data.id) : null) ??
    url.searchParams.get("data.id") ??
    url.searchParams.get("id");

  if (!pagoRemotoId) return null;

  return {
    eventoId: datos.id != null ? String(datos.id) : `${pagoRemotoId}-${datos.action ?? "payment"}`,
    tipo: datos.action ?? tipo ?? "payment",
    pagoRemotoId,
  };
}

/* ----------------------- lib/pagos/proveedor-demo.ts ---------------------- */

const PREFIJO = "demo-";

export function idSimulado(pagoId: string, estado: EstadoRemoto): string {
  return `${PREFIJO}${pagoId}-${estado}`;
}

function leerIdSimulado(id: string): { pagoId: string; estado: EstadoRemoto } | null {
  if (!id.startsWith(PREFIJO)) return null;

  const resto = id.slice(PREFIJO.length);
  const corte = resto.lastIndexOf("-");
  if (corte < 0) return null;

  const pagoId = resto.slice(0, corte);
  const estado = resto.slice(corte + 1) as EstadoRemoto;

  const conocidos: EstadoRemoto[] = ["pendiente", "aprobado", "rechazado", "reintegrado", "cancelado"];

  return conocidos.includes(estado) ? { pagoId, estado } : null;
}

export function consultarDemo(id: string): PagoRemoto | null {
  const leido = leerIdSimulado(id);
  if (!leido) return null;

  return {
    id,
    estado: leido.estado,
    monto: null,
    medio: "simulado",
    referencia: leido.pagoId,
    motivoRechazo: leido.estado === "rechazado" ? "Rechazo simulado desde la demo" : null,
    crudo: { demo: true, id, estado: leido.estado },
  };
}

export function interpretarAvisoDemo(cuerpo: unknown): AvisoEntrante | null {
  const datos = (cuerpo ?? {}) as { data?: { id?: unknown }; id?: unknown };
  const pagoRemotoId = datos.data?.id != null ? String(datos.data.id) : null;
  if (!pagoRemotoId) return null;

  return {
    eventoId: datos.id != null ? String(datos.id) : pagoRemotoId,
    tipo: "payment",
    pagoRemotoId,
  };
}

/* ---------------------- app/api/pagos/webhook/route.ts --------------------- */

/** El `data.id` que se firma: el de la query, o el del cuerpo. */
export function dataIdDelAviso(url: URL, cuerpo: unknown): string | null {
  const dataId =
    url.searchParams.get("data.id") ??
    (typeof (cuerpo as { data?: { id?: unknown } })?.data?.id !== "undefined"
      ? String((cuerpo as { data: { id: unknown } }).data.id)
      : null);
  return dataId ? dataId.toLowerCase() : null;
}

/* --------------------------- lib/pagos/acreditar.ts ------------------------ */

const TOLERANCIA = 0.5;

/**
 * Lo que decide acreditarPago con el estado de la fila y el aviso, sin la
 * base: «igual», «ignorar» (aprobado que no pasa a reintegrado), «revision»
 * con su motivo, o «aplicar».
 */
export function decidir(
  estadoActual: string,
  nuestroMonto: number,
  remoto: Pick<PagoRemoto, "estado" | "monto">,
): { decision: "igual" | "ignorar" | "revision" | "aplicar"; motivo?: string } {
  if (estadoActual === remoto.estado) return { decision: "igual" };
  if (estadoActual === "aprobado" && remoto.estado !== "reintegrado") return { decision: "ignorar" };
  if (
    remoto.estado === "aprobado" &&
    remoto.monto != null &&
    Math.abs(remoto.monto - nuestroMonto) > TOLERANCIA
  ) {
    const motivo = `El proveedor informó $${remoto.monto.toFixed(2)} y el cobro es de $${nuestroMonto.toFixed(2)}.`;
    return { decision: "revision", motivo };
  }
  return { decision: "aplicar" };
}
