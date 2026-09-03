import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  costHistory,
  goodsReceiptItems,
  goodsReceipts,
  inventory,
  inventoryMovements,
  supplierMovements,
  variantCosts,
} from "@/lib/db/schema";
import { claveDeLock } from "@/lib/inventario/locks";
import { agregarIva } from "@/lib/fiscal/impuestos";
import { mezclarCosto, prorratearGastos } from "./costo";

/**
 * Confirmar una recepción: la mercadería entra y el costo se mueve.
 *
 * Son dos cosas distintas que pasan juntas —el stock es físico, el costo es
 * plata— y por eso van en **una sola transacción**. Una recepción que sumó
 * stock sin mover el costo deja mercadería valorizada a cero, y el margen de
 * todo lo que se venda después sale inflado hasta que alguien lo note.
 *
 * **Es irreversible por diseño.** Anular después baja la cantidad y no toca el
 * costo: deshacer la mezcla exigiría recalcular toda la historia posterior, y
 * esa historia ya se usó para poner precios. Por eso confirmar es explícito y
 * el borrador no toca nada.
 */

export interface ResultadoRecepcion {
  ok: true;
  /** Cuántas líneas movieron costo. */
  lineas: number;
  /** Neto total de la recepción, gastos incluidos. */
  neto: number;
}

export interface FalloRecepcion {
  ok: false;
  error: string;
}

export async function confirmarRecepcion(
  receiptId: string,
  usuarioId: string,
): Promise<ResultadoRecepcion | FalloRecepcion> {
  return db.transaction(async (tx) => {
    const [recepcion] = await tx
      .select()
      .from(goodsReceipts)
      .where(eq(goodsReceipts.id, receiptId))
      .limit(1)
      .for("update");

    if (!recepcion) return { ok: false as const, error: "Esa recepción no existe." };

    // Confirmar dos veces duplicaría el stock y **corrompería el costo
    // promedio**, que no se puede revertir. El `for update` de arriba serializa
    // los dos clics; este chequeo decide.
    if (recepcion.estado !== "borrador") {
      return {
        ok: false as const,
        error:
          recepcion.estado === "confirmada"
            ? "Esta recepción ya estaba confirmada."
            : "Esta recepción está anulada.",
      };
    }

    const items = await tx
      .select()
      .from(goodsReceiptItems)
      .where(eq(goodsReceiptItems.receiptId, receiptId))
      .orderBy(goodsReceiptItems.orden);

    if (items.length === 0) {
      return { ok: false as const, error: "La recepción no tiene ninguna línea." };
    }

    /*
     * El flete se reparte antes de tocar nada: el costo que se promedia es el
     * de la mercadería puesta en el depósito, no el de la factura sola.
     */
    const conGastos = prorratearGastos(
      /*
       * Solo los campos que hacen falta. Pasar la fila entera traería
       * `costoConGastos` de la base —que todavía es nulo— y chocaría con el que
       * el prorrateo calcula.
       */
      items.map((i) => ({
        id: i.id,
        variantId: i.variantId,
        alicuotaIva: i.alicuotaIva,
        cantidad: Number(i.cantidad),
        costoUnitario: Number(i.costoUnitario),
      })),
      Number(recepcion.gastos),
    );

    let neto = Number(recepcion.gastos);

    for (const linea of conGastos) {
      neto += linea.cantidad * linea.costoUnitario;

      /*
       * El lock por variante y sucursal, el mismo que usan las reservas y el
       * ajuste manual. Sin él, dos recepciones simultáneas de la misma variante
       * leen el mismo costo previo y la segunda pisa a la primera: se pierde
       * una mezcla entera, no un centavo.
       */
      await tx.execute(
        sql`select pg_advisory_xact_lock(${claveDeLock(linea.variantId, recepcion.branchId)})`,
      );

      const [previo] = await tx
        .select({
          id: variantCosts.id,
          cantidadBase: variantCosts.cantidadBase,
          costoPromedio: variantCosts.costoPromedio,
        })
        .from(variantCosts)
        .where(eq(variantCosts.variantId, linea.variantId))
        .limit(1);

      const estadoPrevio = {
        cantidadBase: Number(previo?.cantidadBase ?? 0),
        costoPromedio: Number(previo?.costoPromedio ?? 0),
      };

      const nuevo = mezclarCosto(estadoPrevio, {
        cantidad: linea.cantidad,
        costoUnitario: linea.costoConGastos,
      });

      if (previo) {
        await tx
          .update(variantCosts)
          .set({
            cantidadBase: nuevo.cantidadBase.toFixed(4),
            costoPromedio: nuevo.costoPromedio.toFixed(4),
          })
          .where(eq(variantCosts.id, previo.id));
      } else {
        await tx.insert(variantCosts).values({
          variantId: linea.variantId,
          cantidadBase: nuevo.cantidadBase.toFixed(4),
          costoPromedio: nuevo.costoPromedio.toFixed(4),
        });
      }

      await tx.insert(costHistory).values({
        variantId: linea.variantId,
        costoAnterior: estadoPrevio.costoPromedio.toFixed(4),
        costoNuevo: nuevo.costoPromedio.toFixed(4),
        cantidadAnterior: estadoPrevio.cantidadBase.toFixed(4),
        cantidadNueva: nuevo.cantidadBase.toFixed(4),
        documentoTipo: "recepcion",
        documentoId: receiptId,
        motivo: recepcion.numeroRemito
          ? `Remito ${recepcion.numeroRemito}`
          : "Recepción de mercadería",
        createdByUserId: usuarioId,
      });

      // La cuenta queda escrita en la línea: es lo que permite auditar esta
      // recepción dentro de ocho meses sin rehacer la historia posterior.
      await tx
        .update(goodsReceiptItems)
        .set({
          costoConGastos: linea.costoConGastos.toFixed(4),
          cantidadAnterior: estadoPrevio.cantidadBase.toFixed(4),
          costoAnterior: estadoPrevio.costoPromedio.toFixed(4),
          costoResultante: nuevo.costoPromedio.toFixed(4),
        })
        .where(eq(goodsReceiptItems.id, linea.id));

      /*
       * El stock entra con **upsert**.
       *
       * `devolverAlStock` hace update, y sirve porque devuelve algo que ya
       * había salido de ahí. Una recepción puede traer un SKU que nunca estuvo
       * en esa sucursal: sin fila que actualizar, el update no hace nada y la
       * mercadería entra al depósito sin entrar al sistema.
       */
      const unidades = Math.round(linea.cantidad);
      if (unidades > 0) {
        await tx
          .insert(inventory)
          .values({
            variantId: linea.variantId,
            branchId: recepcion.branchId,
            qty: unidades,
          })
          .onConflictDoUpdate({
            target: [inventory.variantId, inventory.branchId],
            set: {
              qty: sql`${inventory.qty} + ${unidades}`,
              updatedAt: new Date(),
            },
          });

        await tx.insert(inventoryMovements).values({
          variantId: linea.variantId,
          branchId: recepcion.branchId,
          type: "ingreso",
          qty: unidades,
          note: recepcion.numeroRemito
            ? `Remito ${recepcion.numeroRemito}`
            : "Recepción de mercadería",
          documentoTipo: "recepcion",
          documentoId: receiptId,
          createdByUserId: usuarioId,
        });
      }
    }

    await tx
      .update(goodsReceipts)
      .set({
        estado: "confirmada",
        confirmadaAt: new Date(),
        confirmadaPor: usuarioId,
      })
      .where(eq(goodsReceipts.id, receiptId));

    /*
     * La deuda con el proveedor sube por el total **con IVA**: es lo que hay
     * que pagarle. El costo que se promedió es el neto, que es otra cosa y por
     * eso se calcula aparte. Cruzar los dos es de donde salen los márgenes
     * inflados un 21 %.
     */
    const conIva = conGastos.reduce(
      (t, l) =>
        t + agregarIva(l.cantidad * l.costoConGastos, Number(l.alicuotaIva)),
      0,
    );

    await tx.insert(supplierMovements).values({
      supplierId: recepcion.supplierId,
      tipo: "factura",
      monto: conIva.toFixed(2),
      referencia: recepcion.numeroRemito,
      detalle: "Recepción de mercadería",
      createdByUserId: usuarioId,
    });

    return { ok: true as const, lineas: conGastos.length, neto };
  });
}

/**
 * Anula una recepción.
 *
 * **Saca el stock y no toca el costo**, y eso es a propósito: revertir la
 * mezcla ponderada exigiría recalcular todas las recepciones posteriores de esa
 * variante, y esos costos ya se usaron para decidir precios. El costo queda
 * como quedó y se corrige, si hace falta, con una corrección explícita que deja
 * su rastro en el historial.
 */
export async function anularRecepcion(
  receiptId: string,
  usuarioId: string,
  motivo: string,
): Promise<ResultadoRecepcion | FalloRecepcion> {
  return db.transaction(async (tx) => {
    const [recepcion] = await tx
      .select()
      .from(goodsReceipts)
      .where(eq(goodsReceipts.id, receiptId))
      .limit(1)
      .for("update");

    if (!recepcion) return { ok: false as const, error: "Esa recepción no existe." };
    if (recepcion.estado === "anulada") {
      return { ok: false as const, error: "Ya estaba anulada." };
    }

    const items = await tx
      .select()
      .from(goodsReceiptItems)
      .where(eq(goodsReceiptItems.receiptId, receiptId));

    if (recepcion.estado === "confirmada") {
      for (const linea of items) {
        const unidades = Math.round(Number(linea.cantidad));
        if (unidades <= 0) continue;

        await tx.execute(
          sql`select pg_advisory_xact_lock(${claveDeLock(linea.variantId, recepcion.branchId)})`,
        );

        await tx
          .update(inventory)
          .set({
            qty: sql`${inventory.qty} - ${unidades}`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(inventory.variantId, linea.variantId),
              eq(inventory.branchId, recepcion.branchId),
            ),
          );

        await tx.insert(inventoryMovements).values({
          variantId: linea.variantId,
          branchId: recepcion.branchId,
          type: "ajuste",
          qty: -unidades,
          note: `Anulación de recepción: ${motivo}`,
          documentoTipo: "recepcion",
          documentoId: receiptId,
          createdByUserId: usuarioId,
        });
      }

      // La deuda vuelve atrás con una nota de crédito, que es como se anota de
      // verdad: borrar el movimiento original dejaría la cuenta sin explicación.
      const [{ total }] = await tx
        .select({
          total: sql<string>`coalesce(sum(${supplierMovements.monto}), 0)`,
        })
        .from(supplierMovements)
        .where(
          and(
            eq(supplierMovements.supplierId, recepcion.supplierId),
            eq(supplierMovements.referencia, recepcion.numeroRemito ?? ""),
            eq(supplierMovements.tipo, "factura"),
          ),
        );

      if (Number(total) > 0) {
        await tx.insert(supplierMovements).values({
          supplierId: recepcion.supplierId,
          tipo: "nota_credito",
          monto: (-Number(total)).toFixed(2),
          referencia: recepcion.numeroRemito,
          detalle: `Anulación de recepción: ${motivo}`,
          createdByUserId: usuarioId,
        });
      }
    }

    await tx
      .update(goodsReceipts)
      .set({
        estado: "anulada",
        notas: [recepcion.notas, `Anulada: ${motivo}`].filter(Boolean).join(" · "),
      })
      .where(eq(goodsReceipts.id, receiptId));

    return { ok: true as const, lineas: items.length, neto: 0 };
  });
}
