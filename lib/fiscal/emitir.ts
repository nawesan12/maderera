import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  accountMovements,
  configuracionFiscal,
  invoiceItems,
  invoiceTributos,
  invoices,
  puntosVenta,
} from "@/lib/db/schema";
import {
  letraQueCorresponde,
  nombreComprobante,
  notaDeCredito,
  numeroFormateado,
  tipoFactura,
  type CondicionIva,
  type TipoComprobante,
} from "./comprobantes";
import { calcularTotales, redondear } from "./impuestos";
import { siguienteNumeroComprobante } from "./numeracion";
import { proveedorFiscal } from "./proveedores";

/**
 * Emisión de comprobantes.
 *
 * Acá se junta todo: se decide la letra, se calculan los importes, se toma el
 * número correlativo y se guarda. La autorización de ARCA va **después** y por
 * separado, a propósito.
 *
 * Podría parecer más prolijo pedir el CAE dentro de la misma transacción, pero
 * sería un error: una llamada a un servicio externo adentro de una transacción
 * la mantiene abierta mientras ARCA piensa, y si ARCA tarda o se cae, el
 * rollback borraría un comprobante que ARCA quizás ya autorizó. El comprobante
 * primero existe; después se lo manda a autorizar, y se puede reintentar.
 */

export interface LineaAEmitir {
  descripcion: string;
  unidad?: string;
  cantidad: number;
  /** Precio final unitario, con IVA incluido: como está en el catálogo. */
  precioFinalUnitario: number;
  alicuota?: number;
}

export interface DatosEmision {
  customerId?: string | null;
  orderId?: string | null;
  receptorNombre: string;
  receptorCuit?: string | null;
  receptorCondicionIva: CondicionIva;
  receptorDomicilio?: string | null;
  lineas: LineaAEmitir[];
  puntoVentaId?: string | null;
  fechaVencimiento?: Date | null;
  observaciones?: string | null;
  createdByUserId?: string | null;
  /** Para notas de crédito: el comprobante que se corrige. */
  comprobanteOrigenId?: string | null;
}

export interface ResultadoEmision {
  invoiceId?: string;
  error?: string;
}

/** Datos del emisor, creando la fila por defecto la primera vez. */
export async function obtenerConfiguracionFiscal() {
  const [existente] = await db.select().from(configuracionFiscal).limit(1);
  if (existente) return existente;

  const [creada] = await db.insert(configuracionFiscal).values({}).returning();
  return creada;
}

/** Punto de venta a usar: el pedido, o el primero activo. */
async function resolverPuntoVenta(puntoVentaId?: string | null) {
  if (puntoVentaId) {
    const [elegido] = await db
      .select()
      .from(puntosVenta)
      .where(eq(puntosVenta.id, puntoVentaId))
      .limit(1);
    if (elegido) return elegido;
  }

  const [primero] = await db
    .select()
    .from(puntosVenta)
    .where(eq(puntosVenta.activo, true))
    .orderBy(puntosVenta.numero)
    .limit(1);

  return primero ?? null;
}

/**
 * Crea un comprobante.
 *
 * `tipoForzado` existe para las notas de crédito, que heredan la letra del
 * comprobante que corrigen en vez de recalcularla: si el cliente cambió de
 * condición frente al IVA desde que se le facturó, la nota tiene que seguir
 * siendo de la misma letra que la factura original.
 */
export async function emitirComprobante(
  datos: DatosEmision,
  tipoForzado?: TipoComprobante,
): Promise<ResultadoEmision> {
  if (datos.lineas.length === 0) {
    return { error: "El comprobante no tiene ningún ítem." };
  }

  const config = await obtenerConfiguracionFiscal();

  if (!config.cuit) {
    return {
      error:
        "Falta cargar el CUIT de la empresa antes de poder facturar. Se configura en ARCA › Datos del emisor.",
    };
  }

  const punto = await resolverPuntoVenta(datos.puntoVentaId);

  if (!punto) {
    return {
      error:
        "No hay ningún punto de venta cargado. Se configura en ARCA › Puntos de venta.",
    };
  }

  const tipo =
    tipoForzado ??
    tipoFactura(
      letraQueCorresponde(
        config.condicionIva as CondicionIva,
        datos.receptorCondicionIva,
      ),
    );

  const totales = calcularTotales(datos.lineas);

  // Percepción de Ingresos Brutos, si la empresa es agente de percepción.
  const tributos: {
    codigo: string;
    descripcion: string;
    base: number;
    alicuota: number;
    importe: number;
  }[] = [];

  const alicuotaIibb = Number(config.alicuotaPercepcionIibb);

  if (config.percibeIibb && alicuotaIibb > 0) {
    const importePercepcion = redondear((totales.neto * alicuotaIibb) / 100);
    if (importePercepcion > 0) {
      tributos.push({
        codigo: "02",
        descripcion: "Percepción Ingresos Brutos",
        base: totales.neto,
        alicuota: alicuotaIibb,
        importe: importePercepcion,
      });
    }
  }

  const totalTributos = redondear(
    tributos.reduce((suma, t) => suma + t.importe, 0),
  );
  const total = redondear(totales.total + totalTributos);

  const iva21 = totales.ivaPorAlicuota.get(21)?.importe ?? 0;
  const iva105 = totales.ivaPorAlicuota.get(10.5)?.importe ?? 0;

  try {
    const invoiceId = await db.transaction(async (tx) => {
      const numero = await siguienteNumeroComprobante(tx, punto.numero, tipo);

      const [comprobante] = await tx
        .insert(invoices)
        .values({
          tipo,
          puntoVentaId: punto.id,
          puntoVenta: punto.numero,
          numero,
          estado: "emitida",
          customerId: datos.customerId ?? null,
          orderId: datos.orderId ?? null,
          receptorNombre: datos.receptorNombre,
          receptorCuit: datos.receptorCuit ?? null,
          receptorCondicionIva: datos.receptorCondicionIva,
          receptorDomicilio: datos.receptorDomicilio ?? null,
          neto: totales.neto.toFixed(2),
          iva21: iva21.toFixed(2),
          iva105: iva105.toFixed(2),
          exento: totales.exento.toFixed(2),
          tributos: totalTributos.toFixed(2),
          total: total.toFixed(2),
          comprobanteOrigenId: datos.comprobanteOrigenId ?? null,
          fechaVencimiento: datos.fechaVencimiento ?? null,
          observaciones: datos.observaciones ?? null,
          createdByUserId: datos.createdByUserId ?? null,
        })
        .returning({ id: invoices.id });

      await tx.insert(invoiceItems).values(
        totales.lineas.map((linea, i) => ({
          invoiceId: comprobante.id,
          descripcion: linea.descripcion,
          unidad: linea.unidad,
          cantidad: linea.cantidad.toFixed(2),
          precioUnitario: linea.precioUnitarioNeto.toFixed(4),
          alicuotaIva: linea.alicuota.toFixed(2),
          neto: linea.neto.toFixed(2),
          iva: linea.iva.toFixed(2),
          subtotal: linea.subtotal.toFixed(2),
          orden: i,
        })),
      );

      if (tributos.length > 0) {
        await tx.insert(invoiceTributos).values(
          tributos.map((t) => ({
            invoiceId: comprobante.id,
            codigo: t.codigo,
            descripcion: t.descripcion,
            baseImponible: t.base.toFixed(2),
            alicuota: t.alicuota.toFixed(2),
            importe: t.importe.toFixed(2),
          })),
        );
      }

      return comprobante.id;
    });

    return { invoiceId };
  } catch (error) {
    console.error(
      JSON.stringify({
        scope: "fiscal.emitir",
        evento: "error",
        detalle: error instanceof Error ? error.message : "desconocido",
      }),
    );
    return { error: "No se pudo emitir el comprobante. Intentá de nuevo." };
  }
}

/**
 * Manda un comprobante ya emitido a ARCA y guarda el CAE.
 *
 * Se puede llamar varias veces: si ARCA rechazó, se corrige lo que haga falta y
 * se reintenta con el mismo número. Lo que no se hace es reintentar uno ya
 * autorizado, que ARCA rechazaría por duplicado.
 */
export async function autorizarComprobante(
  invoiceId: string,
): Promise<{ ok?: string; error?: string }> {
  const [comprobante] = await db
    .select()
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);

  if (!comprobante) return { error: "No encontramos el comprobante." };
  if (comprobante.cae) return { error: "Este comprobante ya está autorizado." };
  if (comprobante.estado === "anulada") {
    return { error: "El comprobante está anulado." };
  }

  const [items, tributos] = await Promise.all([
    db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoiceId)),
    db
      .select()
      .from(invoiceTributos)
      .where(eq(invoiceTributos.invoiceId, invoiceId)),
  ]);

  // El IVA se reagrupa por alícuota desde las líneas: es como lo espera ARCA y
  // evita depender de que las columnas resumidas estén al día.
  const porAlicuota = new Map<number, { base: number; importe: number }>();

  for (const item of items) {
    const alicuota = Number(item.alicuotaIva);
    if (alicuota <= 0) continue;

    const acumulado = porAlicuota.get(alicuota) ?? { base: 0, importe: 0 };
    acumulado.base = redondear(acumulado.base + Number(item.neto));
    acumulado.importe = redondear(acumulado.importe + Number(item.iva));
    porAlicuota.set(alicuota, acumulado);
  }

  let asociado = null;

  if (comprobante.comprobanteOrigenId) {
    const [origen] = await db
      .select({
        tipo: invoices.tipo,
        puntoVenta: invoices.puntoVenta,
        numero: invoices.numero,
        fechaEmision: invoices.fechaEmision,
      })
      .from(invoices)
      .where(eq(invoices.id, comprobante.comprobanteOrigenId))
      .limit(1);

    if (origen) {
      asociado = {
        tipo: origen.tipo as TipoComprobante,
        puntoVenta: origen.puntoVenta,
        numero: origen.numero,
        fecha: origen.fechaEmision,
      };
    }
  }

  const resultado = await proveedorFiscal().autorizar({
    tipo: comprobante.tipo as TipoComprobante,
    puntoVenta: comprobante.puntoVenta,
    numero: comprobante.numero,
    fechaEmision: comprobante.fechaEmision,
    receptorCuit: comprobante.receptorCuit,
    receptorCondicionIva: comprobante.receptorCondicionIva as CondicionIva,
    neto: Number(comprobante.neto),
    exento: Number(comprobante.exento),
    iva: [...porAlicuota.entries()].map(([alicuota, valores]) => ({
      alicuota,
      base: valores.base,
      importe: valores.importe,
    })),
    tributos: tributos.map((t) => ({
      codigo: t.codigo,
      descripcion: t.descripcion,
      base: Number(t.baseImponible),
      alicuota: Number(t.alicuota),
      importe: Number(t.importe),
    })),
    total: Number(comprobante.total),
    asociado,
  });

  if (resultado.error) {
    return { error: resultado.error };
  }

  if (!resultado.autorizado) {
    await db
      .update(invoices)
      .set({
        estado: "rechazada",
        observacionesArca: resultado.observaciones ?? null,
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, invoiceId));

    return {
      error:
        resultado.observaciones ??
        "ARCA no autorizó el comprobante.",
    };
  }

  await db
    .update(invoices)
    .set({
      estado: "autorizada",
      cae: resultado.cae ?? null,
      caeVencimiento: resultado.caeVencimiento ?? null,
      observacionesArca: resultado.observaciones ?? null,
      updatedAt: new Date(),
    })
    .where(eq(invoices.id, invoiceId));

  return { ok: `Autorizado por ARCA. CAE ${resultado.cae}.` };
}

/**
 * Nota de crédito que anula una factura.
 *
 * Copia las líneas del comprobante original: una nota de crédito por el total
 * es la forma de dejar sin efecto una factura, porque las facturas emitidas no
 * se borran ni se editan.
 */
export async function anularConNotaDeCredito(
  invoiceId: string,
  motivo: string,
  userId?: string,
): Promise<ResultadoEmision> {
  const [original] = await db
    .select()
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);

  if (!original) return { error: "No encontramos el comprobante." };
  if (original.estado === "anulada") {
    return { error: "Ese comprobante ya está anulado." };
  }
  if (original.estado === "borrador") {
    return { error: "Un borrador no necesita nota de crédito." };
  }

  const items = await db
    .select()
    .from(invoiceItems)
    .where(eq(invoiceItems.invoiceId, invoiceId))
    .orderBy(invoiceItems.orden);

  const resultado = await emitirComprobante(
    {
      customerId: original.customerId,
      orderId: original.orderId,
      receptorNombre: original.receptorNombre,
      receptorCuit: original.receptorCuit,
      receptorCondicionIva: original.receptorCondicionIva as CondicionIva,
      receptorDomicilio: original.receptorDomicilio,
      puntoVentaId: original.puntoVentaId,
      comprobanteOrigenId: original.id,
      observaciones: motivo,
      createdByUserId: userId,
      lineas: items.map((item) => ({
        descripcion: item.descripcion,
        unidad: item.unidad,
        cantidad: Number(item.cantidad),
        // Se reconstruye el precio final desde el neto y su IVA, para que la
        // nota de crédito cierre exactamente contra la factura que anula.
        precioFinalUnitario:
          Number(item.cantidad) > 0
            ? redondear(Number(item.subtotal) / Number(item.cantidad))
            : 0,
        alicuota: Number(item.alicuotaIva),
      })),
    },
    notaDeCredito(original.tipo as TipoComprobante),
  );

  if (resultado.error) return resultado;

  await db
    .update(invoices)
    .set({ estado: "anulada", updatedAt: new Date() })
    .where(eq(invoices.id, invoiceId));

  /*
   * La nota de crédito le devuelve al cliente lo que la factura le había
   * cargado.
   *
   * Antes la anulación existía solo del lado fiscal: el comprobante quedaba
   * anulado y la cuenta corriente seguía mostrando la deuda de una factura que
   * ya no existía. La reversión se anota como movimiento nuevo y no borrando
   * el anterior, que es como trabaja toda la cuenta corriente de este sistema:
   * el error tiene que quedar a la vista junto con su corrección.
   *
   * El asiento sale solo si la factura había cargado deuda, y eso pasa cuando
   * no tiene pedido detrás —ver `emitirManual`—: si la deuda la había puesto
   * un pedido, la devuelve la anulación del pedido y no esta.
   */
  if (original.customerId && !original.orderId) {
    const etiqueta = `${nombreComprobante(original.tipo as TipoComprobante)} ${numeroFormateado(original.puntoVenta, original.numero)}`;

    await db.insert(accountMovements).values({
      customerId: original.customerId,
      tipo: "nota_credito",
      monto: (-Number(original.total)).toFixed(2),
      detalle: `Anulación de ${etiqueta}: ${motivo}`,
      referencia: etiqueta,
      createdByUserId: userId ?? null,
    });
  }

  return resultado;
}

/** Último comprobante emitido, para el atajo de "ver el que acabo de hacer". */
export async function ultimoComprobante() {
  const [ultimo] = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(and(eq(invoices.estado, "emitida")))
    .orderBy(desc(invoices.createdAt))
    .limit(1);

  return ultimo?.id ?? null;
}
