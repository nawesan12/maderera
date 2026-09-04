import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";
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
  notaDeDebito,
  numeroFormateado,
  tipoFactura,
  type CondicionIva,
  type TipoComprobante,
} from "./comprobantes";
import { calcularTotales, redondear } from "./impuestos";
import {
  lineasDeLaNota,
  prorratearTributos,
  revisarAcreditacion,
  type CantidadAAcreditar,
} from "./notas";
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
  /** En una nota parcial: qué renglón del original corrige. */
  itemOrigenId?: string | null;
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
  /**
   * Tributos ya calculados, para las notas.
   *
   * Una nota **copia los del original prorrateados** en vez de recalcularlos
   * con la configuración de hoy: emitida después de que cambiara la alícuota de
   * percepción, se calculaba con la nueva y no cerraba contra su factura.
   */
  tributosDados?: {
    codigo: string;
    descripcion: string;
    base: number;
    alicuota: number;
    importe: number;
  }[];
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
type Transaccion = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Emite dentro de una transacción que abre **quien llama**.
 *
 * Existe por la nota de crédito. `emitirComprobante` abre su propia
 * transacción, así que la anulación no podía envolver todo: el `update` del
 * original y el asiento de cuenta corriente iban sueltos después, y si fallaba
 * el segundo quedaba una nota emitida contra una factura que seguía viva.
 *
 * `emitirComprobante` pasa a ser el envoltorio que abre la transacción, así que
 * ninguna firma pública cambia y todos los llamadores de hoy siguen igual.
 */
export async function emitirEnTransaccion(
  tx: Transaccion,
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

  if (datos.tributosDados) {
    // Copiados del original: ver `tributosDados`.
    tributos.push(...datos.tributosDados);
  } else if (config.percibeIibb && alicuotaIibb > 0) {
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
  const iva27 = totales.ivaPorAlicuota.get(27)?.importe ?? 0;

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
      iva27: iva27.toFixed(2),
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
      invoiceItemOrigenId: datos.lineas[i]?.itemOrigenId ?? null,
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

  return { invoiceId: comprobante.id };
}

/**
 * Crea un comprobante, en su propia transacción.
 *
 * Es el envoltorio de `emitirEnTransaccion` y la firma que usan todos los
 * llamadores. Un fallo se traduce a un error legible en vez de propagar la
 * excepción cruda a una pantalla.
 */
export async function emitirComprobante(
  datos: DatosEmision,
  tipoForzado?: TipoComprobante,
): Promise<ResultadoEmision> {
  try {
    return await db.transaction((tx) =>
      emitirEnTransaccion(tx, datos, tipoForzado),
    );
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
 * Emite una nota de crédito, entera o parcial.
 *
 * **Todo pasa dentro de una transacción.** Antes no: `emitirComprobante` tenía
 * la suya, y el `update` del original más el asiento de cuenta corriente iban
 * sueltos después. Si fallaba el segundo, quedaba una nota de crédito emitida
 * contra una factura que seguía viva y con la deuda intacta.
 *
 * Tres reglas que no son obvias:
 *
 * 1. **Una nota parcial no anula el original**, ni siquiera cuando la suma de
 *    las notas llega al 100 %. El estado "anulada" tiene consecuencias en el
 *    libro IVA y en la cuenta corriente, y que aparezca por sumar centavos es
 *    imposible de explicar. Anular es una decisión explícita.
 *
 * 2. **El precio unitario sale del original**, no de la cantidad parcial: ver
 *    `lineasDeLaNota`.
 *
 * 3. **Los tributos se copian prorrateados** en vez de recalcularse con la
 *    configuración de hoy: una nota emitida después de cambiar la alícuota de
 *    percepción no cerraba contra su factura.
 */
export interface OpcionesDeNota {
  /** Los renglones y cuánto de cada uno. `null` es por el total. */
  parciales?: CantidadAAcreditar[] | null;
  /** Si además hay que marcar el original como anulado. */
  anularOriginal?: boolean;
}

export async function emitirNotaDeCredito(
  invoiceId: string,
  motivo: string,
  userId?: string,
  opciones: OpcionesDeNota = {},
): Promise<ResultadoEmision> {
  const parciales = opciones.parciales ?? null;

  try {
    return await db.transaction(async (tx) => {
      /*
       * `for update` sobre el original: entre leer cuánto se acreditó y sumar
       * lo nuevo no puede colarse otra nota, o las dos leen el mismo acreditado
       * y entre las dos superan el total de la factura.
       */
      const [original] = await tx
        .select()
        .from(invoices)
        .where(eq(invoices.id, invoiceId))
        .limit(1)
        .for("update");

      if (!original) return { error: "No encontramos el comprobante." };
      if (original.estado === "anulada") {
        return { error: "Ese comprobante ya está anulado." };
      }
      if (original.estado === "borrador") {
        return { error: "Un borrador no necesita nota de crédito." };
      }

      const items = await tx
        .select()
        .from(invoiceItems)
        .where(eq(invoiceItems.invoiceId, invoiceId))
        .orderBy(invoiceItems.orden);

      let lineas;
      try {
        lineas = lineasDeLaNota(
          items.map((i) => ({
            id: i.id,
            descripcion: i.descripcion,
            unidad: i.unidad,
            cantidad: Number(i.cantidad),
            subtotal: Number(i.subtotal),
            alicuotaIva: Number(i.alicuotaIva),
          })),
          parciales,
        );
      } catch (error) {
        return {
          error:
            error instanceof Error ? error.message : "No se pudo armar la nota.",
        };
      }

      if (lineas.length === 0) {
        return { error: "No hay nada que acreditar." };
      }

      const netoDeLaNota = redondear(
        lineas.reduce((t, l) => t + l.cantidad * l.precioFinalUnitario, 0),
      );

      /*
       * La proporción sobre el total **de mercadería**, no sobre el total del
       * comprobante: los tributos se prorratean sobre la base que los generó, y
       * meterlos en su propio divisor daría una proporción menor a la real.
       */
      const baseOriginal =
        Number(original.neto) +
        Number(original.iva21) +
        Number(original.iva105) +
        Number(original.iva27) +
        Number(original.exento);

      const proporcion =
        baseOriginal > 0 ? Math.min(1, netoDeLaNota / baseOriginal) : 1;

      const tributosOriginales = await tx
        .select()
        .from(invoiceTributos)
        .where(eq(invoiceTributos.invoiceId, invoiceId));

      const tributosDados = prorratearTributos(
        tributosOriginales.map((t) => ({
          codigo: t.codigo,
          descripcion: t.descripcion,
          base: Number(t.baseImponible),
          alicuota: Number(t.alicuota),
          importe: Number(t.importe),
        })),
        proporcion,
      );

      const totalDeLaNota = redondear(
        netoDeLaNota + tributosDados.reduce((t, x) => t + x.importe, 0),
      );

      const problema = revisarAcreditacion(
        Number(original.total),
        Number(original.acreditado),
        totalDeLaNota,
      );
      if (problema) return { error: problema };

      const resultado = await emitirEnTransaccion(
        tx,
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
          tributosDados,
          lineas: lineas.map((l) => ({
            descripcion: l.descripcion,
            unidad: l.unidad,
            cantidad: l.cantidad,
            precioFinalUnitario: l.precioFinalUnitario,
            alicuota: l.alicuota,
            itemOrigenId: l.itemOrigenId,
          })),
        },
        notaDeCredito(original.tipo as TipoComprobante),
      );

      if (resultado.error) {
        // Devolver el error dentro de la transacción la deja sin efecto: la
        // nota no se emitió, así que nada de lo demás tiene que pasar.
        throw new ErrorDeEmision(resultado.error);
      }

      await tx
        .update(invoices)
        .set({
          acreditado: redondear(
            Number(original.acreditado) + totalDeLaNota,
          ).toFixed(2),
          // Anular es explícito: una parcial no lo hace ni llegando al 100 %.
          ...(opciones.anularOriginal ? { estado: "anulada" as const } : {}),
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, invoiceId));

      /*
       * La nota le devuelve al cliente lo que la factura le había cargado.
       *
       * Se anota como movimiento nuevo y no borrando el anterior, que es como
       * trabaja toda la cuenta corriente de este sistema: el error queda a la
       * vista junto con su corrección.
       *
       * Sale solo si la factura había cargado deuda, y eso pasa cuando no tiene
       * pedido detrás —ver `emitirManual`—: si la deuda la puso un pedido, la
       * devuelve la anulación del pedido y no esta.
       */
      if (original.customerId && !original.orderId) {
        const etiqueta = `${nombreComprobante(original.tipo as TipoComprobante)} ${numeroFormateado(original.puntoVenta, original.numero)}`;

        await tx.insert(accountMovements).values({
          customerId: original.customerId,
          tipo: "nota_credito",
          monto: (-totalDeLaNota).toFixed(2),
          detalle: parciales
            ? `Nota de crédito parcial sobre ${etiqueta}: ${motivo}`
            : `Anulación de ${etiqueta}: ${motivo}`,
          referencia: etiqueta,
          createdByUserId: userId ?? null,
        });
      }

      return resultado;
    });
  } catch (error) {
    if (error instanceof ErrorDeEmision) return { error: error.message };

    console.error(
      JSON.stringify({
        scope: "fiscal.nota-credito",
        evento: "error",
        detalle: error instanceof Error ? error.message : "desconocido",
      }),
    );
    return { error: "No se pudo emitir la nota de crédito." };
  }
}

/** Un error de negocio que tiene que deshacer la transacción, no explotar. */
class ErrorDeEmision extends Error {}

/**
 * Cuánto de cada renglón ya se acreditó con notas anteriores.
 *
 * Sale de `invoiceItems.invoiceItemOrigenId`, que es justamente para lo que
 * existe: sin él, dos notas parciales sobre la misma factura son dos importes
 * sueltos y no hay forma de saber qué renglón corrigió cada una.
 */
async function cantidadesYaAcreditadas(
  tx: Transaccion,
  invoiceId: string,
): Promise<Map<string, number>> {
  const filas = await tx
    .select({
      origenId: invoiceItems.invoiceItemOrigenId,
      cantidad: sql<string>`sum(${invoiceItems.cantidad})`,
    })
    .from(invoiceItems)
    .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
    .where(
      and(
        eq(invoices.comprobanteOrigenId, invoiceId),
        sql`${invoices.tipo}::text like 'nota_credito%'`,
        sql`${invoices.estado} <> 'anulada'`,
        sql`${invoiceItems.invoiceItemOrigenId} is not null`,
      ),
    )
    .groupBy(invoiceItems.invoiceItemOrigenId);

  const mapa = new Map<string, number>();
  for (const f of filas) {
    if (f.origenId) mapa.set(f.origenId, Number(f.cantidad));
  }
  return mapa;
}

/**
 * Nota de crédito por lo que falte acreditar, que además anula la factura.
 *
 * Se conserva con la misma firma de siempre porque es lo que llaman las
 * pantallas de hoy, y sobre una factura sin notas previas hace exactamente lo
 * de antes: acredita el 100 %.
 *
 * **Lo que cambia es la factura que ya tuvo una nota parcial.** Acreditar otra
 * vez el total duplicaría lo ya devuelto y el libro IVA quedaría con más
 * crédito del que el comprobante respalda. Anular acredita **lo que queda**.
 */
export async function anularConNotaDeCredito(
  invoiceId: string,
  motivo: string,
  userId?: string,
): Promise<ResultadoEmision> {
  const restante = await db.transaction(async (tx) => {
    const items = await tx
      .select({ id: invoiceItems.id, cantidad: invoiceItems.cantidad })
      .from(invoiceItems)
      .where(eq(invoiceItems.invoiceId, invoiceId));

    const acreditadas = await cantidadesYaAcreditadas(tx, invoiceId);

    // Sin notas previas se anula por el total, como siempre: `null` le dice a
    // `lineasDeLaNota` que copie los renglones enteros.
    if (acreditadas.size === 0) return null;

    return items
      .map((i) => ({
        itemId: i.id,
        cantidad: Number(i.cantidad) - (acreditadas.get(i.id) ?? 0),
      }))
      .filter((p) => p.cantidad > 0);
  });

  if (restante !== null && restante.length === 0) {
    /*
     * La factura ya está acreditada entera por notas parciales. Anularla no
     * necesita otra nota: el papel ya se corrigió del todo y lo único que falta
     * es el cambio de estado, que es una decisión de gestión.
     */
    await db
      .update(invoices)
      .set({ estado: "anulada", updatedAt: new Date() })
      .where(eq(invoices.id, invoiceId));

    return { invoiceId };
  }

  return emitirNotaDeCredito(invoiceId, motivo, userId, {
    parciales: restante,
    anularOriginal: true,
  });
}

/**
 * Nota de débito: le carga algo más al cliente sobre una factura ya emitida.
 *
 * Existía a medias —el enum la contemplaba, `notaDeDebito()` estaba escrita y
 * el código ARCA mapeado— pero **no se llamaba desde ningún lado**. Los casos
 * reales de una maderera son intereses por mora y un flete que se olvidó de
 * facturar.
 *
 * No toca `acreditado`: una nota de débito suma, no resta. Y **nunca anula el
 * original**, que sería absurdo.
 */
export async function emitirNotaDeDebito(
  invoiceId: string,
  motivo: string,
  lineas: LineaAEmitir[],
  userId?: string,
): Promise<ResultadoEmision> {
  if (lineas.length === 0) {
    return { error: "La nota de débito no tiene ningún ítem." };
  }

  try {
    return await db.transaction(async (tx) => {
      const [original] = await tx
        .select()
        .from(invoices)
        .where(eq(invoices.id, invoiceId))
        .limit(1)
        .for("update");

      if (!original) return { error: "No encontramos el comprobante." };
      if (original.estado === "borrador") {
        return { error: "Un borrador no se puede debitar." };
      }
      if (original.estado === "anulada") {
        return {
          error:
            "Ese comprobante está anulado: no se le puede cargar nada encima.",
        };
      }

      const resultado = await emitirEnTransaccion(
        tx,
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
          lineas,
        },
        notaDeDebito(original.tipo as TipoComprobante),
      );

      if (resultado.error) throw new ErrorDeEmision(resultado.error);

      const totalDebitado = redondear(
        lineas.reduce((t, l) => t + l.cantidad * l.precioFinalUnitario, 0),
      );

      await tx
        .update(invoices)
        .set({
          debitado: redondear(
            Number(original.debitado) + totalDebitado,
          ).toFixed(2),
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, invoiceId));

      if (original.customerId && !original.orderId) {
        const etiqueta = `${nombreComprobante(original.tipo as TipoComprobante)} ${numeroFormateado(original.puntoVenta, original.numero)}`;

        // Positivo: el cliente debe más. Es el espejo de la nota de crédito.
        await tx.insert(accountMovements).values({
          customerId: original.customerId,
          tipo: "nota_debito",
          monto: totalDebitado.toFixed(2),
          detalle: `Nota de débito sobre ${etiqueta}: ${motivo}`,
          referencia: etiqueta,
          createdByUserId: userId ?? null,
        });
      }

      return resultado;
    });
  } catch (error) {
    if (error instanceof ErrorDeEmision) return { error: error.message };

    console.error(
      JSON.stringify({
        scope: "fiscal.nota-debito",
        evento: "error",
        detalle: error instanceof Error ? error.message : "desconocido",
      }),
    );
    return { error: "No se pudo emitir la nota de débito." };
  }
}

/**
 * Reconstruye `invoices.acreditado` desde las notas emitidas.
 *
 * El verificador de la suma guardada, calcado de `recalcularReservado()`. Es lo
 * que permite comprobar que la columna dice la verdad sin tener que confiar en
 * que ninguna transacción falló a la mitad en dos años.
 */
export async function recalcularAcreditado(
  invoiceId: string,
): Promise<{ guardado: number; real: number }> {
  const [guardado] = await db
    .select({ acreditado: invoices.acreditado })
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);

  const [suma] = await db
    .select({ total: sql<string>`coalesce(sum(${invoices.total}), 0)` })
    .from(invoices)
    .where(
      and(
        eq(invoices.comprobanteOrigenId, invoiceId),
        sql`${invoices.tipo}::text like 'nota_credito%'`,
        sql`${invoices.estado} <> 'anulada'`,
      ),
    );

  const real = Number(suma?.total ?? 0);

  await db
    .update(invoices)
    .set({ acreditado: real.toFixed(2) })
    .where(eq(invoices.id, invoiceId));

  return { guardado: Number(guardado?.acreditado ?? 0), real };
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
