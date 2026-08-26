import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  avisosEmail,
  customers,
  invoices,
  notificationsLog,
  orderItems,
  orders,
  payments,
} from "@/lib/db/schema";
import { proveedorEmail } from "@/lib/email";
import type { AdjuntoEmail } from "@/lib/email/tipos";
import * as plantillas from "@/lib/email/plantillas";
import { fechaHora } from "@/lib/formato";

/**
 * Avisos automáticos al cliente por correo.
 *
 * Complementa a `lib/whatsapp/avisos.ts`, que hace lo mismo por el otro canal.
 * Los dos comparten tres reglas, y ninguna es negociable:
 *
 * 1. **Nunca frenan la operación.** Si el correo falla, el pedido igual avanza
 *    y el pago igual se acredita. Un aviso que no sale es un problema menor; un
 *    cobro que no se registra porque el mail rebotó es un problema real.
 * 2. **Todo queda en `notifications_log`.** "¿Le avisamos?" es una pregunta que
 *    aparece sola cuando alguien dice que nunca le llegó nada.
 * 3. **`simulada` no es `enviada`.** Sin `RESEND_API_KEY` cargada el correo se
 *    arma y no sale, y la bitácora lo dice con todas las letras.
 */

interface DespachoEmail {
  evento: string;
  para: string | null | undefined;
  correo: plantillas.CorreoArmado;
  entidadTipo?: string;
  entidadId?: string | null;
  adjuntos?: AdjuntoEmail[];
}

/** Manda un correo y lo registra. No lanza nunca. */
export async function despacharEmail(despacho: DespachoEmail): Promise<void> {
  try {
    if (!despacho.para) return;

    // Sin fila de configuración el aviso se manda: los eventos nacen
    // encendidos porque un correo no cuesta plata por mensaje, a diferencia de
    // una conversación de WhatsApp.
    const [config] = await db
      .select()
      .from(avisosEmail)
      .where(eq(avisosEmail.evento, despacho.evento))
      .limit(1);

    if (config && !config.activo) {
      await registrar({
        ...despacho,
        estado: "omitida",
        error: "El aviso está apagado en /admin/avisos.",
      });
      return;
    }

    const asunto = config?.asunto || despacho.correo.asunto;

    const resultado = await proveedorEmail().enviar({
      para: despacho.para,
      asunto,
      html: despacho.correo.html,
      texto: despacho.correo.texto,
      adjuntos: despacho.adjuntos,
    });

    await registrar({
      ...despacho,
      asunto,
      estado: resultado.simulado
        ? "simulada"
        : resultado.enviado
          ? "enviada"
          : "fallida",
      proveedorMensajeId: resultado.id,
      error: resultado.error,
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        scope: "notificaciones.email",
        evento: despacho.evento,
        error: error instanceof Error ? error.message : "desconocido",
      }),
    );
  }
}

async function registrar(datos: {
  evento: string;
  para: string | null | undefined;
  asunto?: string;
  correo?: plantillas.CorreoArmado;
  entidadTipo?: string;
  entidadId?: string | null;
  estado: "enviada" | "simulada" | "fallida" | "omitida";
  proveedorMensajeId?: string;
  error?: string;
}): Promise<void> {
  await db.insert(notificationsLog).values({
    canal: "email",
    evento: datos.evento,
    destinatario: datos.para ?? "",
    asunto: datos.asunto ?? datos.correo?.asunto ?? null,
    entidadTipo: datos.entidadTipo ?? null,
    entidadId: datos.entidadId ?? null,
    estado: datos.estado,
    proveedorMensajeId: datos.proveedorMensajeId ?? null,
    error: datos.error ?? null,
  });
}

/* -------------------------------------------------------------------------- */
/* Eventos                                                                     */
/* -------------------------------------------------------------------------- */

const MEDIOS: Record<string, string> = {
  mercado_pago: "Mercado Pago",
  transferencia: "Transferencia bancaria",
  efectivo: "Efectivo",
  cuenta_corriente: "Cuenta corriente",
};

export async function notificarPedidoRecibido(orderId: string): Promise<void> {
  try {
    const [pedido] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);

    if (!pedido?.contactoEmail) return;

    const lineas = await db
      .select({
        descripcion: orderItems.descripcion,
        cantidad: orderItems.cantidad,
        unidad: orderItems.unidad,
        subtotal: orderItems.subtotal,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));

    await despacharEmail({
      evento: "pedido_recibido",
      para: pedido.contactoEmail,
      entidadTipo: "order",
      entidadId: orderId,
      correo: plantillas.pedidoRecibido({
        nombre: pedido.contactoNombre.split(" ")[0],
        numero: pedido.numero,
        total: pedido.total,
        entrega:
          pedido.tipoEntrega === "retiro"
            ? "Retiro en sucursal"
            : `Envío${pedido.zonaEnvio ? ` · ${pedido.zonaEnvio}` : ""}`,
        medioPago: MEDIOS[pedido.medioPago ?? ""] ?? "A coordinar",
        lineas: lineas.map((l) => ({
          descripcion: l.descripcion,
          cantidad: Number(l.cantidad),
          unidad: l.unidad,
          importe: l.subtotal,
        })),
      }),
    });
  } catch {
    // Ver la regla 1: esto no puede voltear la confirmación de la compra.
  }
}

export async function notificarCambioDeEstado(
  orderId: string,
  estado: string,
): Promise<void> {
  try {
    const [pedido] = await db
      .select({
        numero: orders.numero,
        nombre: orders.contactoNombre,
        email: orders.contactoEmail,
      })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);

    if (!pedido?.email) return;

    const [config] = await db
      .select()
      .from(avisosEmail)
      .where(eq(avisosEmail.evento, estado))
      .limit(1);

    await despacharEmail({
      evento: estado,
      para: pedido.email,
      entidadTipo: "order",
      entidadId: orderId,
      correo: plantillas.pedidoCambioDeEstado({
        nombre: pedido.nombre.split(" ")[0],
        numero: pedido.numero,
        estado,
        asuntoPersonalizado: config?.asunto,
        encabezadoPersonalizado: config?.encabezado,
      }),
    });
  } catch {
    // Igual que arriba: cambiar el estado de un pedido no puede fallar por esto.
  }
}

/**
 * Avisa el resultado de un cobro.
 *
 * La llama el webhook y también la conciliación manual de transferencias, así
 * que recibe lo que devuelve `acreditarPago` y no un id suelto.
 */
export async function notificarResultadoDePago(resultado: {
  orderId?: string | null;
  customerId?: string | null;
  tipo?: "pedido" | "deuda" | "inscripcion";
  detalle?: string;
}): Promise<void> {
  try {
    if (resultado.detalle !== "aprobado") return;

    // Una inscripción a un evento tiene su propio correo, con la fecha y el
    // lugar: el genérico de "recibimos tu pago" no le sirve a quien lo que
    // quiere saber es dónde y cuándo tiene que estar.
    if (resultado.tipo === "inscripcion") {
      const { notificarInscripcionPorPago } = await import("./eventos");
      await notificarInscripcionPorPago(resultado);
      return;
    }

    if (resultado.orderId) {
      const [pedido] = await db
        .select({
          numero: orders.numero,
          nombre: orders.contactoNombre,
          email: orders.contactoEmail,
          total: orders.total,
        })
        .from(orders)
        .where(eq(orders.id, resultado.orderId))
        .limit(1);

      if (!pedido?.email) return;

      const [pago] = await db
        .select({ medio: payments.medio, monto: payments.monto })
        .from(payments)
        .where(eq(payments.orderId, resultado.orderId))
        .limit(1);

      await despacharEmail({
        evento: "pago_acreditado",
        para: pedido.email,
        entidadTipo: "order",
        entidadId: resultado.orderId,
        correo: plantillas.pagoAcreditado({
          nombre: pedido.nombre.split(" ")[0],
          monto: pago?.monto ?? pedido.total,
          medio: pago?.medio ?? null,
          referencia: pedido.numero,
          esDeuda: false,
        }),
      });
      return;
    }

    if (resultado.customerId) {
      const [cliente] = await db
        .select({ nombre: customers.nombre, email: customers.email })
        .from(customers)
        .where(eq(customers.id, resultado.customerId))
        .limit(1);

      if (!cliente?.email) return;

      const [pago] = await db
        .select({ medio: payments.medio, monto: payments.monto, id: payments.id })
        .from(payments)
        .where(eq(payments.customerId, resultado.customerId))
        .limit(1);

      await despacharEmail({
        evento: "pago_acreditado",
        para: cliente.email,
        entidadTipo: "customer",
        entidadId: resultado.customerId,
        correo: plantillas.pagoAcreditado({
          nombre: cliente.nombre.split(" ")[0],
          monto: pago?.monto ?? 0,
          medio: pago?.medio ?? null,
          referencia: "Cuenta corriente",
          esDeuda: true,
        }),
      });
    }
  } catch {
    // Regla 1.
  }
}

export async function notificarFacturaEmitida(
  invoiceId: string,
  pdf?: AdjuntoEmail,
): Promise<void> {
  try {
    const [comprobante] = await db
      .select({
        numero: invoices.numero,
        tipo: invoices.tipo,
        puntoVenta: invoices.puntoVenta,
        total: invoices.total,
        cae: invoices.cae,
        clienteNombre: invoices.receptorNombre,
        customerId: invoices.customerId,
      })
      .from(invoices)
      .where(eq(invoices.id, invoiceId))
      .limit(1);

    if (!comprobante) return;

    const [cliente] = comprobante.customerId
      ? await db
          .select({ email: customers.email })
          .from(customers)
          .where(eq(customers.id, comprobante.customerId))
          .limit(1)
      : [];

    if (!cliente?.email) return;

    const etiqueta = `${comprobante.tipo.toUpperCase()} ${String(comprobante.puntoVenta).padStart(4, "0")}-${String(comprobante.numero).padStart(8, "0")}`;

    await despacharEmail({
      evento: "factura_emitida",
      para: cliente.email,
      entidadTipo: "invoice",
      entidadId: invoiceId,
      adjuntos: pdf ? [pdf] : undefined,
      correo: plantillas.facturaEmitida({
        nombre: (comprobante.clienteNombre ?? "").split(" ")[0] || "cliente",
        comprobante: etiqueta,
        total: comprobante.total,
        conCae: Boolean(comprobante.cae),
      }),
    });
  } catch {
    // Regla 1: emitir no puede fallar porque el correo no salió.
  }
}

export function formatearFechaAviso(fecha: Date | null): string {
  return fecha ? fechaHora.format(fecha) : "";
}
