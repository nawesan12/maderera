"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { avisarPedidoNuevo } from "@/lib/dal/existencia";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";
import type { Autorizacion } from "@/components/autorizacion/campo-pin";

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
 * "en camino". `desde` es el estado que se veía: si ya cambió, Go contesta
 * 409 en vez de dar un paso de más (que en un retiro emite el remito).
 */
export async function avanzarPedido(
  id: string,
  desde?: string,
  /** Quien retira: en un retiro que pasa a entregado, el documento va en el remito y es obligatorio. */
  quien?: { receptorNombre?: string; receptorDocumento?: string; pin?: string },
): Promise<EstadoVenta & { autorizacion?: Autorizacion; firmaToken?: string; campo?: string }> {
  const r = await (await api()).POST("/api/v1/admin/pedidos/{id}/avanzar", {
    params: { path: { id }, query: desde ? { desde } : {} },
    body: quien ?? {},
  });
  if (!r.data) {
    // Soltar lo que no se cobró pide el PIN de un admin
    // (entregas.AutorizarSinCobrar).
    const e = (r.error as Problema | undefined)?.errores;
    if (e?.pin && e.pinMotivo === "sin_cobrar") {
      return {
        error: e.pin,
        autorizacion: {
          motivo: "sin_cobrar",
          monto: Number(e.pinMonto ?? 0),
          pinIncorrecto: e.pinIncorrecto === "si",
          sinAdmins: e.pinSinAdmins === "si" || undefined,
          conClave: e.pinConClave === "si" || undefined,
          bloqueadoHasta: e.pinHasta,
        },
      };
    }
    if (e?.receptorDocumento) return { error: e.receptorDocumento, campo: "receptorDocumento" };
    return fallo(r);
  }

  // El WhatsApp y el correo al cliente los encoló Go con el avance: salen
  // aunque esta respuesta se corte, y no la demoran.
  refrescar();
  revalidatePath("/admin/reparto");

  return { ok: r.data.ok, firmaToken: r.data.firmaToken };
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

export async function cambiarEstadoPresupuesto(id: string, estado: string, motivo?: string): Promise<EstadoVenta> {
  const r = await (await api()).POST("/api/v1/admin/presupuestos/{id}/estado", {
    params: { path: { id } },
    body: { estado, ...(motivo ? { motivo } : {}) },
  });
  if (!r.data) return fallo(r);
  refrescar();
  return { ok: r.data.ok };
}

/**
 * Ata un pedido o presupuesto sin cliente a la ficha con el correo de su
 * contacto. La tienda ya no lo hace sola sin la sesión de ese correo.
 */
export async function unirAFicha(
  que: "pedido" | "presupuesto",
  id: string,
  customerId: string,
): Promise<EstadoVenta> {
  const a = await api();
  const r =
    que === "pedido"
      ? await a.POST("/api/v1/admin/pedidos/{id}/ficha", { params: { path: { id } }, body: { customerId } })
      : await a.POST("/api/v1/admin/presupuestos/{id}/ficha", { params: { path: { id } }, body: { customerId } });
  if (!r.data) return fallo(r);
  refrescar();
  revalidatePath(`/admin/${que === "pedido" ? "pedidos" : "presupuestos"}/${id}`);
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
  /** El envío va sin flete: sin flete escrito ni esto, Go no lo deja salir. */
  sinCargo?: boolean;
  medioPago?: MedioDelPedido;
  /** Pedido partido (H047): lo que va a cuenta corriente; el resto, con medioPago. */
  aCuenta?: number;
  /** AAAA-MM-DD: el día que se compromete la entrega. */
  entregarEl?: string;
  /** Un presupuesto vencido: los precios de hoy o los suyos (con PIN). */
  precios?: "actualizar" | "respetar";
  pin?: string;
  /** El slug de la sucursal de donde sale, si no es la del presupuesto. */
  sucursal?: string;
}

export async function convertirEnPedido(
  quoteId: string,
  entrega?: EntregaDelPedido,
): Promise<EstadoVenta & { id?: string; autorizacion?: Autorizacion }> {
  const r = await (await api()).POST("/api/v1/admin/presupuestos/{id}/pedido", {
    params: { path: { id: quoteId } },
    body: entrega,
  });
  if (!r.data) {
    // Respetar los precios vencidos pasado lo libre: Go pide el PIN con lo
    // que se deja de cobrar (pedidos.faltaDePIN).
    const e = (r.error as Problema | undefined)?.errores;
    if (e?.pin) {
      return {
        error: e.pin,
        autorizacion: {
          motivo: "presupuesto",
          monto: Number(e.pinMonto ?? 0),
          pinIncorrecto: e.pinIncorrecto === "si",
          sinAdmins: e.pinConClave === "si" || undefined,
          conClave: e.pinConClave === "si" || undefined,
          bloqueadoHasta: e.pinHasta,
        },
      };
    }
    return fallo(r);
  }
  refrescar();
  revalidatePath("/admin/stock");
  if (r.data.numero) avisarPedidoNuevo(r.data.numero);
  return { ok: r.data.ok, id: r.data.id };
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
function leerFormulario(formData: FormData) {
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
  return { cabecera, lineas };
}

export async function crearPresupuesto(_previo: EstadoVenta, formData: FormData): Promise<EstadoVenta> {
  const { cabecera, lineas } = leerFormulario(formData);
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

/* -------------------------------------------------------------------------- */
/* Devolver y corregir un pedido sin factura                                   */
/* -------------------------------------------------------------------------- */

/**
 * La devolución de un pedido sin factura (mes simulado): lo que vuelve al
 * stock queda atado al pedido y baja lo que falta cobrar. Con factura, se
 * devuelve desde la factura, con su nota de crédito. Lo hace Go
 * (pedidos.DevolverSinFactura).
 */
export async function devolverPedido(
  id: string,
  renglones: { orderItemId: string; cantidad: number }[],
  motivo: string,
  clave: string,
  destino?: "caja" | "afuera",
): Promise<EstadoVenta> {
  const r = await (await api()).POST("/api/v1/admin/pedidos/{id}/devolucion", {
    params: { path: { id } },
    body: { renglones, motivo, clave, ...(destino ? { destino } : {}) },
  });
  if (!r.data) return fallo(r);
  refrescar();
  revalidatePath(`/admin/pedidos/${id}`);
  revalidatePath("/admin/stock");
  if (destino === "caja") revalidatePath("/admin/caja");
  return { ok: r.data.ok };
}

/** El importe de la nota de crédito que saldría (con los tributos), sin hacer nada. */
export async function calcularDevolucionFacturada(
  id: string,
  renglones: { itemId: string; cantidad: number }[],
): Promise<{ importe?: number; error?: string }> {
  const r = await (await api()).POST("/api/v1/admin/facturacion/pedidos/{id}/devolucion/calculo", {
    params: { path: { id } },
    body: { renglones },
  });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined) };
  return { importe: r.data.importe };
}

/**
 * La devolución de un pedido facturado, con su nota de crédito (H279): baja
 * lo que falta cobrar o va a la cuenta corriente. La plata no sale de acá.
 */
export async function devolverPedidoFacturado(
  id: string,
  renglones: { itemId: string; cantidad: number }[],
  motivo: string,
  clave: string,
  importe: number | null,
  destino?: "caja" | "afuera",
): Promise<EstadoVenta & { notaId?: string }> {
  const r = await (await api()).POST("/api/v1/admin/facturacion/pedidos/{id}/devolucion", {
    params: { path: { id } },
    body: { renglones, motivo, clave, importe, ...(destino ? { destino } : {}) },
  });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined) };
  refrescar();
  revalidatePath(`/admin/pedidos/${id}`);
  revalidatePath("/admin/stock");
  revalidatePath("/admin/facturacion");
  if (destino === "caja") revalidatePath("/admin/caja");
  return { ok: "Devolución registrada.", notaId: r.data.notaId || undefined };
}

/**
 * Corrige los renglones y el flete de un pedido sin factura ni cobro (mes
 * simulado: PED-1066 salió sin flete y no había cómo agregarlo). Un precio
 * bajo la lista, pasado lo libre, pide el PIN de un admin.
 */
export async function corregirPedido(
  id: string,
  correccion: {
    renglones: { orderItemId: string; cantidad: number; precioUnitario: number }[];
    nuevos?: { variantId: string; descripcion: string; unidad?: string; cantidad: number; precioUnitario: number }[];
    costoEnvio?: number;
    entrega?: "retiro" | "envio";
    direccion?: string;
    zona?: string;
    motivo: string;
    pin?: string;
  },
): Promise<EstadoVenta & { autorizacion?: Autorizacion }> {
  const r = await (await api()).POST("/api/v1/admin/pedidos/{id}/correccion", {
    params: { path: { id } },
    body: correccion,
  });
  if (!r.data) {
    const e = (r.error as Problema | undefined)?.errores;
    if (e?.pin) {
      return {
        error: e.pin,
        autorizacion: {
          motivo: "precio",
          monto: Number(e.pinMonto ?? 0),
          pinIncorrecto: e.pinIncorrecto === "si",
          bloqueadoHasta: e.pinHasta,
        },
      };
    }
    return fallo(r);
  }
  refrescar();
  revalidatePath(`/admin/pedidos/${id}`);
  revalidatePath("/admin/reparto");
  revalidatePath("/admin/stock");
  return { ok: r.data.ok };
}

/**
 * Corrige un presupuesto que todavía no se mandó: los mismos campos que el
 * alta, con el mismo número (mes simulado: había que rechazarlo y cargarlo de
 * nuevo). Go no deja si ya se mandó o tiene pedido.
 */
export async function editarPresupuesto(_previo: EstadoVenta, formData: FormData): Promise<EstadoVenta> {
  const id = String(formData.get("id") ?? "");
  const { cabecera, lineas } = leerFormulario(formData);
  const r = await (await api()).PUT("/api/v1/admin/presupuestos/{id}", {
    params: { path: { id } },
    body: { cabecera, lineas },
  });
  if (!r.data) return fallo(r);
  refrescar();
  revalidatePath(`/admin/presupuestos/${id}`);
  redirect(`/admin/presupuestos/${id}`);
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
