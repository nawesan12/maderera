"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { avisoDeEspera, permitido } from "@/lib/limites";
import { redirect } from "next/navigation";
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { cheques, orders } from "@/lib/db/schema";
import { leerPartes } from "@/lib/cobros/leer";
import { esCheque, revisarPartes } from "@/lib/cobros/partes";
import { normalizarNumeroDeCheque } from "@/lib/cheques/numero";
import { avisarAlPanel } from "@/lib/notificaciones/push";
import { moneda } from "@/lib/formato";
import { getSession } from "@/lib/dal/session";
import { pedidoAutorizado } from "@/lib/dal/seguimiento";
import { clienteDeLaSesion } from "@/lib/dal/cuenta";
import { guardarAdjunto } from "@/lib/almacenamiento";
import {
  ErrorDeCobro,
  iniciarPagoDePedido,
  registrarTransferencia,
} from "@/lib/pagos/crear";
import { parsearImporte } from "@/lib/formato";

/**
 * Acciones de cobro del lado del cliente.
 *
 * Nada de lo que llega del navegador decide cuánta plata se cobra: el importe
 * del pedido sale de la base, y el de la deuda se valida contra el saldo real
 * calculado en el DAL. Lo único que aporta el formulario es la intención.
 */

export interface EstadoPago {
  error?: string;
  ok?: string;
}

/** Abre el checkout de un pedido y manda a la persona a pagar. */
export async function pagarPedido(
  _previo: EstadoPago,
  formData: FormData,
): Promise<EstadoPago> {
  const numero = String(formData.get("numero") ?? "");
  const token = String(formData.get("token") ?? "") || undefined;
  if (!numero) return { error: "Falta el número de pedido." };

  // El token es lo que autoriza. Sin esto, con solo probar números consecutivos
  // se abría el checkout de Mercado Pago del pedido de cualquiera, con su
  // detalle de ítems e importes adentro.
  const pedido = await pedidoAutorizado(numero, token);

  if (!pedido) return { error: "No encontramos ese pedido." };
  if (pedido.estadoPago === "pagado") return { error: "Este pedido ya está pagado." };

  const sesion = await getSession();

  let destino: string;

  try {
    const cobro = await iniciarPagoDePedido(pedido.id, sesion?.userId);
    destino = cobro.urlPago;
  } catch (error) {
    if (error instanceof ErrorDeCobro) return { error: error.message };
    console.error(error);
    return {
      error:
        "No pudimos abrir el pago. Probá de nuevo en un momento o escribinos por WhatsApp.",
    };
  }

  redirect(destino);
}

/**
 * El pago online de la deuda, apagado.
 *
 * De la clienta (30/9/2026): la cuenta corriente se paga «con cheques, y no
 * pagar online, sino con transferencia o dinero en cuenta nada más». La
 * pantalla dejó de ofrecerlo; esto queda para que un pedido armado a mano
 * contra la acción no abra un Mercado Pago que nadie pidió. El pago online de
 * **pedidos** sigue igual.
 */
export async function pagarDeuda(): Promise<EstadoPago> {
  return {
    error: "La cuenta corriente se paga con transferencia, depósito o cheque.",
  };
}

const TIPOS_COMPROBANTE = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

/**
 * Sube el comprobante de una transferencia.
 *
 * Queda en revisión, nunca acreditado: una captura de pantalla no es plata en
 * la cuenta. La concilia alguien de la casa desde `/admin/pagos` mirando el
 * extracto, y recién ahí pasa por `acreditarPago`.
 */
export async function subirComprobante(
  _previo: EstadoPago,
  formData: FormData,
): Promise<EstadoPago> {
  const numero = String(formData.get("numero") ?? "");
  const token = String(formData.get("token") ?? "") || undefined;
  const archivo = formData.get("comprobante");

  if (!(archivo instanceof File) || archivo.size === 0) {
    return { error: "Adjuntá el comprobante de la transferencia." };
  }

  if (!TIPOS_COMPROBANTE.has(archivo.type)) {
    return { error: "Subí una imagen o un PDF." };
  }

  /*
   * El freno, antes de subir nada.
   *
   * El token del pedido autoriza a subir, y está bien que así sea —el cliente
   * que compró sin cuenta también tiene que poder mandar su transferencia—,
   * pero sin límite ese mismo token es almacenamiento gratis e ilimitado: cada
   * envío son hasta 16 MB a Blob, que se pagan.
   */
  const puede = await permitido("comprobante", `pedido:${numero}`);

  if (!puede.permitido) return { error: avisoDeEspera(puede) };

  // Igual que en `pagarPedido`: sin el token, cualquiera le colgaba un
  // comprobante inventado al pedido de otro y lo dejaba esperando que alguien
  // lo diera por bueno en la conciliación. Eso mueve plata.
  const pedido = await pedidoAutorizado(numero, token);

  if (!pedido) return { error: "No encontramos ese pedido." };
  if (pedido.estadoPago === "pagado") return { error: "Este pedido ya está pagado." };

  const bytes = new Uint8Array(await archivo.arrayBuffer());
  const guardado = await guardarAdjunto(bytes, archivo.type, "comprobante");

  if (!guardado.url) {
    return { error: guardado.error ?? "No pudimos guardar el comprobante." };
  }

  await registrarTransferencia({
    orderId: pedido.id,
    customerId: pedido.customerId,
    tipo: "pedido",
    monto: Number(pedido.total),
    comprobanteUrl: guardado.url,
  });

  await db
    .update(orders)
    .set({ estadoPago: "pendiente", updatedAt: new Date() })
    .where(eq(orders.id, pedido.id));

  revalidatePath(`/pedido/${numero}`);
  revalidatePath("/admin/pagos");

  return {
    ok: "Recibimos tu comprobante. Lo verificamos y te confirmamos el pago.",
  };
}

/** Igual que la anterior, pero para cancelar deuda de cuenta corriente. */
export async function subirComprobanteDeDeuda(
  _previo: EstadoPago,
  formData: FormData,
): Promise<EstadoPago> {
  const cliente = await clienteDeLaSesion();
  if (!cliente) return { error: "Iniciá sesión para informar un pago." };

  const archivo = formData.get("comprobante");

  if (!(archivo instanceof File) || archivo.size === 0) {
    return { error: "Adjuntá el comprobante de la transferencia." };
  }

  if (!TIPOS_COMPROBANTE.has(archivo.type)) {
    return { error: "Subí una imagen o un PDF." };
  }

  const monto = parsearImporte(String(formData.get("monto") ?? ""));

  if (!Number.isFinite(monto) || monto <= 0) {
    return { error: "Ingresá el importe que pagaste." };
  }

  // Transferencia o depósito en la cuenta del banco: las dos se verifican
  // igual contra el extracto, pero el recibo tiene que decir cuál fue.
  const medio = formData.get("medio") === "deposito" ? "deposito" : "transferencia";

  // Cada comprobante son hasta 16 MB guardados: el mismo freno que en pedidos.
  const puede = await permitido("comprobante", `cliente:${cliente.id}`);
  if (!puede.permitido) return { error: avisoDeEspera(puede) };

  const bytes = new Uint8Array(await archivo.arrayBuffer());
  const guardado = await guardarAdjunto(bytes, archivo.type, "comprobante");

  if (!guardado.url) {
    return { error: guardado.error ?? "No pudimos guardar el comprobante." };
  }

  await registrarTransferencia({
    customerId: cliente.id,
    tipo: "deuda",
    monto,
    medio,
    comprobanteUrl: guardado.url,
  });

  after(() =>
    avisarAlPanel({
      titulo: `${medio === "deposito" ? "Depósito" : "Transferencia"} informada · ${cliente.nombre}`,
      cuerpo: `${moneda.format(monto)} para su cuenta corriente. Verificala en Pagos.`,
      url: "/admin/pagos",
      etiqueta: "pago_informado",
    }),
  );

  revalidatePath("/mi-cuenta/cuenta-corriente");
  revalidatePath("/mi-cuenta/movimientos");
  revalidatePath("/admin/pagos");

  return {
    ok: "Recibimos tu comprobante. Lo imputamos a tu cuenta al verificarlo y te mandamos el recibo.",
  };
}

/**
 * El cliente informa los cheques con los que paga su cuenta.
 *
 * De la clienta (30/9/2026): «que el usuario pueda pagar su cuenta corriente
 * con cheques». Cada cheque nace **informado**: está en la cartera, en una
 * banda aparte, y no mueve la cuenta. Cuando alguien de la casa lo tiene en
 * mano lo acepta —ahí se emite el recibo y baja la deuda— o lo rechaza con un
 * motivo que le llega al cliente. Un cheque que nadie vio no es un pago.
 */
export async function informarChequesDeDeuda(
  _previo: EstadoPago,
  formData: FormData,
): Promise<EstadoPago> {
  const cliente = await clienteDeLaSesion();
  if (!cliente) return { error: "Iniciá sesión para informar un pago." };

  const leidas = leerPartes(formData.get("partes"));
  if ("error" in leidas) return { error: leidas.error };

  const soloCheques = leidas.partes.every((p) => esCheque(p.medio) && p.cheque);
  if (!soloCheques) return { error: "Acá se informan cheques. Las transferencias van en la otra pestaña." };

  const problema = revisarPartes(leidas.partes);
  if (problema) return { error: problema };

  const puede = await permitido("comprobante", `cliente:${cliente.id}`);
  if (!puede.permitido) return { error: avisoDeEspera(puede) };

  try {
    await db.transaction(async (tx) => {
      for (const parte of leidas.partes) {
        const numero = normalizarNumeroDeCheque(parte.cheque!.numero);
        const banco = parte.cheque!.banco.trim();

        const [repetido] = await tx
          .select({ id: cheques.id })
          .from(cheques)
          .where(
            and(
              eq(cheques.sentido, "recibido"),
              eq(cheques.numero, numero),
              sql`lower(coalesce(${cheques.banco}, '')) = lower(${banco})`,
              ne(cheques.estado, "anulado"),
              ne(cheques.estado, "rechazado"),
            ),
          )
          .limit(1);

        if (repetido) {
          throw new ErrorDeCobro(
            `El cheque ${banco} N° ${numero} ya lo tenemos registrado. Si es otro, revisá el número.`,
          );
        }

        await tx.insert(cheques).values({
          sentido: "recibido",
          tipo: parte.medio === "echeq" ? "echeq" : "fisico",
          numero,
          banco,
          librador: parte.cheque!.librador ?? null,
          fechaPago: parte.cheque!.fechaPago,
          importe: parte.importe.toFixed(2),
          estado: "informado",
          customerId: cliente.id,
          notas: "Informado por el cliente desde Mi cuenta",
        });
      }
    });
  } catch (error) {
    if (error instanceof ErrorDeCobro) return { error: error.message };
    throw error;
  }

  const total = leidas.partes.reduce((s, p) => s + p.importe, 0);
  const cuantos = leidas.partes.length;

  after(() =>
    avisarAlPanel({
      titulo: `${cuantos === 1 ? "Cheque informado" : `${cuantos} cheques informados`} · ${cliente.nombre}`,
      cuerpo: `${moneda.format(total)} para su cuenta corriente. Aceptalos en Cheques cuando los tengas en mano.`,
      url: "/admin/cheques",
      etiqueta: "cheque_informado",
    }),
  );

  revalidatePath("/mi-cuenta/cuenta-corriente");
  revalidatePath("/mi-cuenta/movimientos");
  revalidatePath("/admin/cheques");

  return {
    ok:
      cuantos === 1
        ? "Listo, registramos tu cheque. Cuando lo recibamos te mandamos el recibo y baja tu saldo."
        : `Listo, registramos tus ${cuantos} cheques. Cuando los recibamos te mandamos el recibo y baja tu saldo.`,
  };
}
