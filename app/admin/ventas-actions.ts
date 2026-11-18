"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { avisarPedidoNuevo } from "@/lib/dal/existencia";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";

/**
 * Pedidos y presupuestos del panel. Lo hace la API de Go
 * (backend/internal/pedidos): los permisos, los candados, la numeración, la
 * reserva de la mercadería, la bitácora y los avisos al cliente (los encola
 * en la misma transacción y los manda su worker). Acá quedan la firma de
 * siempre y lo que Next tiene que revalidar.
 */

export interface EstadoVenta {
  error?: string;
  ok?: string;
}

function refrescar() {
  revalidatePath("/admin");
  revalidatePath("/admin/pedidos");
  revalidatePath("/admin/presupuestos");
  revalidatePath("/admin/clientes");
}

type Respuesta = {
  data?: { ok: string; id?: string; numero?: string; estado?: string };
  error?: unknown;
};

function fallo(r: Respuesta): EstadoVenta {
  return { error: mensajeDe(r.error as Problema | undefined) };
}

/* -------------------------------------------------------------------------- */
/* Estados                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Avanza el pedido al siguiente estado. El recorrido es fijo y de una sola
 * dirección; uno de retiro pasa de "listo" a "entregado", uno con envío a
 * "en camino".
 */
export async function avanzarPedido(id: string): Promise<EstadoVenta> {
  const r = await (await api()).POST("/api/v1/admin/pedidos/{id}/avanzar", { params: { path: { id } } });
  if (!r.data) return fallo(r);

  // El WhatsApp y el correo al cliente los encoló Go con el avance: salen
  // aunque esta respuesta se corte, y no la demoran.
  refrescar();

  return { ok: r.data.ok };
}

export async function cancelarPedido(id: string, motivo?: string): Promise<EstadoVenta> {
  const r = await (await api()).POST("/api/v1/admin/pedidos/{id}/cancelar", {
    params: { path: { id } },
    body: motivo ? { motivo } : {},
  });
  if (!r.data) return fallo(r);
  refrescar();
  revalidatePath("/admin/stock");
  return { ok: r.data.ok };
}

export async function cambiarEstadoPresupuesto(id: string, estado: string): Promise<EstadoVenta> {
  const r = await (await api()).POST("/api/v1/admin/presupuestos/{id}/estado", {
    params: { path: { id } },
    body: { estado },
  });
  if (!r.data) return fallo(r);
  refrescar();
  return { ok: r.data.ok };
}

/* -------------------------------------------------------------------------- */
/* Presupuesto a pedido                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Convierte un presupuesto en pedido, con el precio que tenían las líneas
 * (el cliente aceptó ese número), y reserva la mercadería.
 */
export type MedioDelPedido = "efectivo" | "transferencia" | "debito" | "credito" | "mercado_pago" | "cuenta_corriente";

export interface EntregaDelPedido {
  tipoEntrega: "retiro" | "envio";
  direccion?: string;
  zona?: string;
  costoEnvio?: number;
  medioPago?: MedioDelPedido;
  /** AAAA-MM-DD: el día que se compromete la entrega. */
  entregarEl?: string;
}

export async function convertirEnPedido(quoteId: string, entrega?: EntregaDelPedido): Promise<EstadoVenta & { id?: string }> {
  const r = await (await api()).POST("/api/v1/admin/presupuestos/{id}/pedido", {
    params: { path: { id: quoteId } },
    body: entrega,
  });
  if (!r.data) return fallo(r);
  refrescar();
  revalidatePath("/admin/stock");
  if (r.data.numero) avisarPedidoNuevo(r.data.numero);
  return { ok: r.data.ok, id: r.data.id };
}

/* -------------------------------------------------------------------------- */
/* Cobro                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Marca un pedido como cobrado: lo que ya se cobró por otro lado. Un pedido a
 * cuenta corriente no pasa por acá (su cobro va con recibo).
 */
export async function marcarPagado(id: string, medioPago?: Exclude<MedioDelPedido, "cuenta_corriente">): Promise<EstadoVenta> {
  const r = await (await api()).POST("/api/v1/admin/pedidos/{id}/cobrado", {
    params: { path: { id } },
    body: medioPago ? { medioPago } : {},
  });
  if (!r.data) return fallo(r);
  refrescar();
  return { ok: r.data.ok };
}

/* -------------------------------------------------------------------------- */
/* Alta de presupuesto desde el panel                                          */
/* -------------------------------------------------------------------------- */

/** Quince días, igual que los que nacen en el sitio. */
const DIAS_DE_VALIDEZ = 15;

/**
 * Carga un presupuesto a mano (el que llega por teléfono). Con «Guardar y
 * pasar a pedido», Go además lo convierte con la misma función que el botón
 * del listado.
 *
 * A Go le llega lo mismo que antes se le pasaba a zod: los campos del
 * FormData con sus `|| undefined`, y las líneas leídas con JSON.parse.
 */
export async function crearPresupuesto(_previo: EstadoVenta, formData: FormData): Promise<EstadoVenta> {
  const cabecera = {
    customerId: (formData.get("customerId") as string) || undefined,
    contactoNombre: formData.get("contactoNombre"),
    contactoTelefono: (formData.get("contactoTelefono") as string) || undefined,
    contactoEmail: (formData.get("contactoEmail") as string) || undefined,
    branchId: (formData.get("branchId") as string) || undefined,
    sellerId: (formData.get("sellerId") as string) || undefined,
    notas: (formData.get("notas") as string) || undefined,
    diasValidez: formData.get("diasValidez") || DIAS_DE_VALIDEZ,
    necesitaPara: (formData.get("necesitaPara") as string) || undefined,
  };
  const lineas: unknown[] = formData.getAll("linea").map((cruda) => JSON.parse(String(cruda)));
  // «Guardar y pasar a pedido» guarda y abre el paso a pedido en la ficha,
  // que pregunta cómo se entrega y cómo paga.
  const pasar = formData.get("convertir") === "si";

  const r = await (await api()).POST("/api/v1/admin/presupuestos", { body: { cabecera, lineas, convertir: false } });
  if (!r.data) return fallo(r);

  refrescar();
  // Al guardar, a la ficha: quedarse en el formulario lleno invitaba a
  // guardarlo dos veces, y el PDF y el WhatsApp están en la ficha.
  if (r.data.id) redirect(`/admin/presupuestos/${r.data.id}${pasar ? "?pasar=1" : ""}`);
  return { ok: r.data.ok };
}

/** Corrige el día comprometido de entrega; vacío lo saca. */
export async function cambiarEntrega(id: string, entregarEl: string): Promise<EstadoVenta> {
  const r = await (await api()).PUT("/api/v1/admin/pedidos/{id}/entrega", {
    params: { path: { id } },
    body: { entregarEl: entregarEl || null },
  });
  if (!r.data) return fallo(r);
  refrescar();
  revalidatePath(`/admin/pedidos/${id}`);
  return { ok: r.data.ok };
}
