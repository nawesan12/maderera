import "server-only";

import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { paymentEvents, payments } from "@/lib/db/schema";
import { acreditarPago } from "./acreditar";
import { proveedorPorNombre } from "./index";
import type { NombreProveedorPago } from "./tipos";

/**
 * Procesamiento de un aviso de cobro.
 *
 * Lo llaman dos lugares: la ruta `/api/pagos/webhook`, cuando avisa Mercado
 * Pago, y la pantalla de demostración. Que sea la misma función es lo que hace
 * que probar con el proveedor demo pruebe algo: el único tramo que no se
 * recorre es el HTTP de entrada.
 *
 * **Nunca lanza.** Un webhook que responde 500 hace que Mercado Pago reintente
 * durante horas; y si el 500 es por un bug nuestro, va a reintentar igual sin
 * que eso arregle nada. Se contesta 200 siempre y el problema queda escrito en
 * `payment_events.error`, que es donde alguien lo puede ir a buscar.
 */

export type ResultadoAviso =
  | "acreditado"
  | "actualizado"
  | "sin_cambios"
  | "repetido"
  | "ignorado"
  | "sin_firma"
  | "error";

export interface RespuestaAviso {
  resultado: ResultadoAviso;
  detalle?: string;
  orderId?: string | null;
  customerId?: string | null;
  /** Qué se estaba cobrando: decide qué aviso corresponde mandar. */
  tipo?: "pedido" | "deuda" | "inscripcion";
}

export async function procesarAviso(opciones: {
  proveedor: NombreProveedorPago;
  cuerpo: unknown;
  url: URL;
  /** Null cuando la verificación no aplica (proveedor de demostración). */
  firmaVerificada: boolean | null;
}): Promise<RespuestaAviso> {
  const proveedor = proveedorPorNombre(opciones.proveedor);
  if (!proveedor) {
    return { resultado: "ignorado", detalle: "Proveedor no configurado." };
  }

  const aviso = proveedor.interpretarAviso(opciones.cuerpo, opciones.url);
  if (!aviso?.pagoRemotoId) {
    return { resultado: "ignorado", detalle: "El aviso no es sobre un pago." };
  }

  // El aviso se guarda antes de hacerle caso, incluso si la firma no cierra:
  // una ráfaga de avisos con firma inválida es justamente lo que hay que poder
  // ver después.
  const [evento] = await db
    .insert(paymentEvents)
    .values({
      proveedor: opciones.proveedor === "demo" ? "demo" : "mercado_pago",
      eventoId: aviso.eventoId,
      tipo: aviso.tipo,
      cuerpo: opciones.cuerpo as object,
      firmaValida:
        opciones.firmaVerificada === null
          ? "no_aplica"
          : String(opciones.firmaVerificada),
    })
    .onConflictDoNothing()
    .returning({ id: paymentEvents.id });

  // Sin fila devuelta, el aviso ya estaba: es un reintento del proveedor y no
  // se vuelve a procesar.
  if (!evento) return { resultado: "repetido" };

  if (opciones.firmaVerificada === false) {
    await marcar(evento.id, "Firma inválida: el aviso no se procesó.");
    return { resultado: "sin_firma" };
  }

  try {
    const remoto = await proveedor.consultarPago(aviso.pagoRemotoId);

    if (!remoto) {
      await marcar(evento.id, "El proveedor no reconoce ese pago.");
      return { resultado: "ignorado" };
    }

    // Se busca por nuestra referencia y, si no vino, por el id del proveedor:
    // eso último cubre los avisos repetidos de un pago que ya se procesó.
    const [pago] = await db
      .select({ id: payments.id })
      .from(payments)
      .where(
        or(
          remoto.referencia ? eq(payments.id, remoto.referencia) : undefined,
          and(
            eq(payments.proveedorPaymentId, remoto.id),
            isNull(payments.conciliadoAt),
          ),
        ),
      )
      .limit(1);

    if (!pago) {
      await marcar(evento.id, `Sin cobro local para ${remoto.id}.`);
      return { resultado: "ignorado" };
    }

    const resultado = await acreditarPago(pago.id, remoto);
    await marcar(evento.id, resultado.motivo ?? null);

    if (!resultado.cambio) {
      return {
        resultado: "sin_cambios",
        orderId: resultado.orderId,
        customerId: resultado.customerId,
        tipo: resultado.tipo,
      };
    }

    return {
      resultado: resultado.estado === "aprobado" ? "acreditado" : "actualizado",
      detalle: resultado.estado,
      orderId: resultado.orderId,
      customerId: resultado.customerId,
      tipo: resultado.tipo,
    };
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    await marcar(evento.id, mensaje);
    console.error(
      JSON.stringify({ scope: "pagos.webhook", evento: aviso.eventoId, error: mensaje }),
    );
    return { resultado: "error", detalle: mensaje };
  }
}

async function marcar(eventoId: string, error: string | null): Promise<void> {
  await db
    .update(paymentEvents)
    .set({ procesadoAt: new Date(), error })
    .where(eq(paymentEvents.id, eventoId));
}
