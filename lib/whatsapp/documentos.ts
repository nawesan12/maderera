import "server-only";

import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { cuttingOrders, deliveries, invoices, orders, quotes, receipts } from "@/lib/db/schema";
import { obtenerConfiguracionFiscal } from "@/lib/fiscal/emitir";
import { numeroFormateado } from "@/lib/fiscal/comprobantes";
import { fechaCorta, moneda } from "@/lib/formato";

/**
 * Los papeles de la plataforma que se pueden mandar por WhatsApp.
 *
 * Presupuesto, factura, remito, recibo, resumen de cuenta y plano de corte: los
 * mismos PDF que se descargan del panel, armados con las mismas funciones. Se
 * generan en el momento y **se suben a Meta** (`subirMedia`) para mandarlos
 * por id: no se publican en una URL, porque el remito de un cliente no tiene
 * por qué estar en internet para que Meta lo vaya a buscar.
 *
 * Solo para el personal: quien llama ya validó que puede usar la bandeja.
 */

export const TIPOS_DE_DOCUMENTO = ["presupuesto", "comprobante", "remito", "recibo", "cuenta", "corte"] as const;
export type TipoDeDocumento = (typeof TIPOS_DE_DOCUMENTO)[number];

export const NOMBRE_DEL_DOCUMENTO: Record<TipoDeDocumento, string> = {
  presupuesto: "Presupuesto",
  comprobante: "Factura",
  remito: "Remito",
  recibo: "Recibo",
  cuenta: "Resumen de cuenta",
  corte: "Plano de corte",
};

export interface DocumentoGenerado {
  contenido: Uint8Array;
  nombre: string;
  /** «el remito R-0001-00000452», para el texto del mensaje. */
  descripcion: string;
  /** De quién es, para encontrar su conversación. */
  customerId: string | null;
  telefono: string | null;
  contacto: string | null;
}

export function esTipoDeDocumento(valor: unknown): valor is TipoDeDocumento {
  return TIPOS_DE_DOCUMENTO.includes(valor as TipoDeDocumento);
}

const UUID = /^[0-9a-f-]{36}$/i;

/** Arma el PDF. Null si no existe. */
export async function documentoPdf(doc: { tipo: TipoDeDocumento; id: string }): Promise<DocumentoGenerado | null> {
  if (!UUID.test(doc.id)) return null;
  const emisor = await obtenerConfiguracionFiscal();

  switch (doc.tipo) {
    case "presupuesto": {
      const { consultarPresupuesto } = await import("@/lib/dal/admin/ventas");
      const { datosParaTransferir } = await import("@/lib/dal/pagos");
      const { presupuestoPdf } = await import("@/lib/pdf/presupuesto");
      const p = await consultarPresupuesto(doc.id);
      if (!p) return null;
      const pdf = await presupuestoPdf(p, emisor, await datosParaTransferir());
      return {
        contenido: new Uint8Array(pdf),
        nombre: `${p.numero}.pdf`,
        descripcion: `el presupuesto ${p.numero}`,
        customerId: p.customerId ?? null,
        telefono: (p as { contactoTelefono?: string | null }).contactoTelefono ?? null,
        contacto: (p as { contactoNombre?: string | null }).contactoNombre ?? null,
      };
    }

    case "comprobante": {
      const { obtenerComprobante } = await import("@/lib/dal/admin/facturacion");
      const { comprobantePdf } = await import("@/lib/pdf/comprobante");
      const c = await obtenerComprobante(doc.id);
      if (!c) return null;
      const pdf = await comprobantePdf(c, emisor);
      const numero = numeroFormateado(c.puntoVenta, c.numero).replace(/\s/g, "");
      return {
        contenido: new Uint8Array(pdf),
        nombre: `${c.tipo.toUpperCase()}-${numero}.pdf`,
        descripcion: `la factura ${numero}`,
        customerId: (c as { customerId?: string | null }).customerId ?? null,
        telefono: null,
        contacto: null,
      };
    }

    case "remito": {
      const { remitoCompleto } = await import("@/lib/dal/admin/entregas");
      const { remitoPdf } = await import("@/lib/pdf/remito");
      const r = await remitoCompleto(doc.id);
      if (!r) return null;
      const pdf = await remitoPdf(r, emisor);
      return {
        contenido: new Uint8Array(pdf),
        nombre: `${r.numero}.pdf`,
        descripcion: `el remito ${r.numero}`,
        customerId: r.customerId,
        telefono: null,
        contacto: null,
      };
    }

    case "recibo": {
      const { reciboCompleto } = await import("@/lib/dal/recibos");
      const { reciboPdf } = await import("@/lib/pdf/recibo");
      const r = await reciboCompleto(doc.id);
      if (!r) return null;
      const pdf = await reciboPdf(r, emisor);
      return {
        contenido: new Uint8Array(pdf),
        nombre: `recibo-${r.numero}.pdf`,
        descripcion: `el recibo ${r.numero}`,
        customerId: r.cliente?.id ?? null,
        telefono: null,
        contacto: null,
      };
    }

    case "cuenta": {
      const { resumenDeCuenta } = await import("@/lib/dal/admin/resumen-cuenta");
      const { resumenDeCuentaPdf } = await import("@/lib/pdf/resumen-cuenta");
      const resumen = await resumenDeCuenta(doc.id);
      if (!resumen) return null;
      const pdf = await resumenDeCuentaPdf(resumen, emisor);
      return {
        contenido: new Uint8Array(pdf),
        nombre: `cuenta-${fechaCorta.format(new Date()).replace(/\//g, "-")}.pdf`,
        descripcion: "el resumen de tu cuenta corriente",
        customerId: doc.id,
        telefono: null,
        contacto: null,
      };
    }

    case "corte": {
      const { hojaDelCorte } = await import("@/lib/dal/admin/cortes");
      const { nombreDeLaMitad } = await import("@/lib/cortes/placa");
      const { cortePdf } = await import("@/lib/pdf/corte");
      // El mismo plano que la descarga del panel (`/api/cortes/[id]/pdf`): lo
      // arma Go con el disco y el motor del trabajo.
      const datos = await hojaDelCorte(doc.id);
      if (!datos) return null;
      const { corte, plano } = datos;
      const pdf = await cortePdf(
        {
          numero: corte.numero,
          cliente: corte.cliente,
          material: corte.material,
          cantoDescripcion: corte.cantoDescripcion,
          deQueSale: nombreDeLaMitad(corte.medida.mitad),
          createdAt: corte.createdAt,
          metrosCanto: datos.metrosCanto,
          superficieSierra: datos.superficies.reduce((t, x) => t + x, 0),
        },
        plano,
        emisor,
      );
      return {
        contenido: new Uint8Array(pdf),
        nombre: `corte-${corte.numero}.pdf`,
        descripcion: `el plano de corte ${corte.numero}`,
        customerId: (corte as { customerId?: string | null }).customerId ?? null,
        telefono: null,
        contacto: null,
      };
    }
  }
}

export interface DocumentoListado {
  tipo: TipoDeDocumento;
  id: string;
  titulo: string;
  detalle: string;
  /** Cómo se lo nombra en el mensaje: «el remito R-0001-00000452». */
  descripcion: string;
  fecha: Date | null;
}

/**
 * Los papeles recientes de un cliente, para elegir cuál mandar desde la
 * conversación. Cinco de cada uno: lo que se manda por WhatsApp es casi
 * siempre lo último.
 */
export async function documentosDelCliente(customerId: string): Promise<DocumentoListado[]> {
  const [presupuestos, comprobantes, remitos, recibos, cortes] = await Promise.all([
    db
      .select({ id: quotes.id, numero: quotes.numero, total: quotes.total, fecha: quotes.createdAt })
      .from(quotes)
      .where(eq(quotes.customerId, customerId))
      .orderBy(desc(quotes.createdAt))
      .limit(5),
    db
      .select({
        id: invoices.id,
        tipo: invoices.tipo,
        puntoVenta: invoices.puntoVenta,
        numero: invoices.numero,
        total: invoices.total,
        fecha: invoices.createdAt,
      })
      .from(invoices)
      .where(and(eq(invoices.customerId, customerId), ne(invoices.estado, "borrador")))
      .orderBy(desc(invoices.createdAt))
      .limit(5),
    db
      .select({ id: deliveries.id, numero: deliveries.numero, pedido: orders.numero, fecha: deliveries.createdAt })
      .from(deliveries)
      .innerJoin(orders, eq(orders.id, deliveries.orderId))
      .where(eq(orders.customerId, customerId))
      .orderBy(desc(deliveries.createdAt))
      .limit(5),
    db
      .select({ id: receipts.id, numero: receipts.numero, total: receipts.total, fecha: receipts.createdAt })
      .from(receipts)
      .where(and(eq(receipts.customerId, customerId), inArray(receipts.estado, ["emitido"])))
      .orderBy(desc(receipts.createdAt))
      .limit(5),
    db
      .select({ id: cuttingOrders.id, numero: cuttingOrders.numero, fecha: cuttingOrders.createdAt })
      .from(cuttingOrders)
      .where(eq(cuttingOrders.customerId, customerId))
      .orderBy(desc(cuttingOrders.createdAt))
      .limit(5),
  ]);

  return [
    { tipo: "cuenta" as const, id: customerId, titulo: "Resumen de cuenta", detalle: "Movimientos y saldo al día de hoy", descripcion: "el resumen de tu cuenta corriente", fecha: null },
    ...presupuestos.map((p) => ({
      tipo: "presupuesto" as const,
      id: p.id,
      titulo: `Presupuesto ${p.numero}`,
      descripcion: `el presupuesto ${p.numero}`,
      detalle: moneda.format(Number(p.total)),
      fecha: p.fecha,
    })),
    ...comprobantes.map((c) => ({
      tipo: "comprobante" as const,
      id: c.id,
      titulo: `Factura ${c.tipo.replace("factura_", "").toUpperCase()} ${numeroFormateado(c.puntoVenta, c.numero)}`,
      descripcion: `la factura ${numeroFormateado(c.puntoVenta, c.numero)}`,
      detalle: moneda.format(Number(c.total)),
      fecha: c.fecha,
    })),
    ...remitos.map((r) => ({
      tipo: "remito" as const,
      id: r.id,
      titulo: `Remito ${r.numero}`,
      descripcion: `el remito ${r.numero}`,
      detalle: `Pedido ${r.pedido}`,
      fecha: r.fecha,
    })),
    ...recibos.map((r) => ({
      tipo: "recibo" as const,
      id: r.id,
      titulo: `Recibo ${r.numero}`,
      descripcion: `el recibo ${r.numero}`,
      detalle: moneda.format(Number(r.total)),
      fecha: r.fecha,
    })),
    ...cortes.map((c) => ({
      tipo: "corte" as const,
      id: c.id,
      titulo: `Corte ${c.numero}`,
      descripcion: `el plano de corte ${c.numero}`,
      detalle: "Plano de corte",
      fecha: c.fecha,
    })),
  ];
}
