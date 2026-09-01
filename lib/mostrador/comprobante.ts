import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers } from "@/lib/db/schema";
import {
  autorizarComprobante,
  emitirComprobante,
  obtenerConfiguracionFiscal,
} from "@/lib/fiscal/emitir";
import { letraQueCorresponde } from "@/lib/fiscal/comprobantes";
import type { CondicionIva } from "@/lib/fiscal/comprobantes";
import type { LineaDeVenta } from "./importes";

/**
 * El comprobante de una venta de mostrador.
 *
 * **Va después de la venta y nunca adentro.** La venta ya se cobró: la plata
 * está en la caja y la mercadería se fue con el cliente. Si ARCA no contesta
 * —hoy directamente no está configurado— eso no puede deshacer nada. Lo que
 * pasa es que queda una venta sin comprobante, que es un problema que se
 * resuelve después desde Facturación; deshacer la venta sería un problema que
 * no se resuelve nunca.
 *
 * Por eso esta función no tira: devuelve qué pasó, y quien atiende ve un aviso
 * sobre una venta que igual quedó hecha.
 */

export interface PedidoDeComprobante {
  orderId: string;
  customerId: string | null;
  receptorNombre: string;
  /** CUIT tipeado en el mostrador para una factura A a alguien sin ficha. */
  cuit?: string | null;
  lineas: LineaDeVenta[];
  usuarioId: string;
}

export interface ResultadoComprobante {
  invoiceId?: string;
  /** Qué contar en pantalla: puede haber comprobante y aun así no tener CAE. */
  aviso: string;
  autorizado: boolean;
}

/**
 * Qué letra saldría, para poder decirlo en pantalla **antes** de cobrar.
 *
 * No se rotula "Factura B" a mano en ningún lado: la letra sale de quién emite
 * y quién recibe. Si mañana la maderera pasa a monotributo, todo lo que se
 * emite es C y esta pantalla lo dice sola.
 */
export async function letraQueSaldria(
  customerId: string | null,
  cuitTipeado?: string | null,
): Promise<{ letra: string; receptor: CondicionIva }> {
  const config = await obtenerConfiguracionFiscal();

  let receptor: CondicionIva = "consumidor_final";

  if (customerId) {
    const [cliente] = await db
      .select({ condicionIva: customers.condicionIva })
      .from(customers)
      .where(eq(customers.id, customerId))
      .limit(1);
    if (cliente) receptor = cliente.condicionIva as CondicionIva;
  } else if (cuitTipeado && cuitTipeado.replace(/\D/g, "").length === 11) {
    // Alguien que da CUIT en el mostrador sin tener ficha: lo más probable es
    // que quiera una A. Si no lo es, ARCA rechaza y se ve en el aviso.
    receptor = "responsable_inscripto";
  }

  return {
    letra: letraQueCorresponde(config.condicionIva as CondicionIva, receptor),
    receptor,
  };
}

export async function emitirParaLaVenta(
  pedido: PedidoDeComprobante,
): Promise<ResultadoComprobante> {
  const { receptor } = await letraQueSaldria(pedido.customerId, pedido.cuit);

  let cuit = pedido.cuit?.replace(/\D/g, "") || null;
  let domicilio: string | null = null;
  let nombre = pedido.receptorNombre;

  if (pedido.customerId) {
    const [cliente] = await db
      .select({
        nombre: customers.nombre,
        razonSocial: customers.razonSocial,
        cuit: customers.cuit,
        direccion: customers.direccion,
      })
      .from(customers)
      .where(eq(customers.id, pedido.customerId))
      .limit(1);

    if (cliente) {
      // La razón social manda sobre el nombre de fantasía: es lo que tiene que
      // decir el comprobante.
      nombre = cliente.razonSocial || cliente.nombre;
      cuit = cliente.cuit?.replace(/\D/g, "") || cuit;
      domicilio = cliente.direccion;
    }
  }

  const emision = await emitirComprobante({
    customerId: pedido.customerId,
    orderId: pedido.orderId,
    receptorNombre: nombre,
    receptorCuit: cuit,
    receptorCondicionIva: receptor,
    receptorDomicilio: domicilio,
    createdByUserId: pedido.usuarioId,
    lineas: pedido.lineas.map((l) => ({
      descripcion: l.descripcion,
      unidad: l.unidad,
      cantidad: l.cantidad,
      // Los precios del catálogo son finales con IVA incluido, que es lo que
      // esta función espera.
      precioFinalUnitario: l.precioUnitario,
    })),
  });

  if (emision.error || !emision.invoiceId) {
    return {
      aviso: `La venta quedó registrada, pero el comprobante no se pudo crear: ${emision.error ?? "error desconocido"}`,
      autorizado: false,
    };
  }

  const autorizacion = await autorizarComprobante(emision.invoiceId);

  if (autorizacion.error) {
    return {
      invoiceId: emision.invoiceId,
      aviso: `Comprobante creado, pero sin autorizar en ARCA: ${autorizacion.error}`,
      autorizado: false,
    };
  }

  return {
    invoiceId: emision.invoiceId,
    aviso: "Comprobante autorizado.",
    autorizado: true,
  };
}
