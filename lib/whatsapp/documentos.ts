import "server-only";

import { obtenerConfiguracionFiscal } from "@/lib/fiscal/emitir";
import { numeroFormateado } from "@/lib/fiscal/comprobantes";
import { fechaCorta } from "@/lib/formato";

/**
 * Los papeles de la plataforma que se pueden mandar por WhatsApp.
 *
 * Presupuesto, factura, remito, recibo, resumen de cuenta y plano de corte: los
 * mismos PDF que se descargan del panel, armados con las mismas funciones. Se
 * generan en el momento y **se suben a Meta** (`subirMedia`) para mandarlos
 * por id: no se publican en una URL, porque el remito de un cliente no tiene
 * por qué estar en internet para que Meta lo vaya a buscar.
 *
 * Solo para el personal: quien llama ya validó que puede usar la bandeja. La
 * lista de los papeles de un cliente la arma la API de Go; los PDF siguen acá
 * hasta la tanda 12 y viajan a Go en el pedido que los manda.
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
      // La ficha y el PDF los da Go (backend/internal/pedidos), con el
      // secreto interno: esto corre también desde la cola, sin cookie.
      const { consultarPresupuesto } = await import("@/lib/dal/admin/ventas");
      const { apiInterna } = await import("@/lib/api/servidor");
      const p = await consultarPresupuesto(doc.id);
      if (!p) return null;
      const r = await apiInterna.GET("/api/v1/presupuestos/{id}/pdf", {
        params: { path: { id: doc.id } },
        parseAs: "arrayBuffer",
      });
      if (!r.data) throw new Error(`La API respondió ${r.response.status} al PDF del presupuesto`);
      return {
        contenido: new Uint8Array(r.data),
        nombre: `${p.numero}.pdf`,
        descripcion: `el presupuesto ${p.numero}`,
        customerId: p.customerId ?? null,
        // Antes leía `contactoTelefono` y `contactoNombre`, que la ficha no
        // tiene (se llaman `telefono` y `cliente`): salían siempre null.
        telefono: p.telefono ?? null,
        contacto: p.cliente ?? null,
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
