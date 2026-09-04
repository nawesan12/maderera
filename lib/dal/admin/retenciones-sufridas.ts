import "server-only";

import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  accountMovements,
  customers,
  retencionesSufridas,
} from "@/lib/db/schema";
import { requireStaffRole } from "@/lib/dal/session";

/**
 * Las retenciones que nos practicaron.
 *
 * **Bajan lo que el cliente debe.** Pagó $95 y trajo un certificado por $5: la
 * cuenta se salda en $100. Tratarlo como un descuento comercial lo sacaría del
 * crédito fiscal, que es plata que se recupera contra el impuesto —no un
 * descuento que se regaló—.
 */

export interface EntradaSufrida {
  customerId: string;
  numero: string;
  impuesto: "ganancias" | "iva" | "suss" | "iibb";
  codigoRegimen?: string | null;
  base: number;
  alicuota?: number | null;
  importe: number;
  fecha: Date;
  referencia?: string | null;
  usuarioId: string;
}

export interface ResultadoSufrida {
  ok: boolean;
  error?: string;
}

/**
 * Carga el certificado y salda la cuenta en el mismo acto.
 *
 * Las dos cosas van en una transacción: un certificado cargado que no llegó a
 * la cuenta corriente deja al cliente debiendo plata que ya entregó, y el
 * reclamo llega por teléfono con el papel en la mano.
 */
export async function cargarRetencionSufrida(
  entrada: EntradaSufrida,
): Promise<ResultadoSufrida> {
  await requireStaffRole("admin");

  if (!Number.isFinite(entrada.importe) || entrada.importe <= 0) {
    return { ok: false, error: "El importe tiene que ser mayor a cero." };
  }

  try {
    await db.transaction(async (tx) => {
      await tx.insert(retencionesSufridas).values({
        customerId: entrada.customerId,
        numero: entrada.numero.trim(),
        impuesto: entrada.impuesto,
        codigoRegimen: entrada.codigoRegimen ?? null,
        base: entrada.base.toFixed(2),
        alicuota: entrada.alicuota?.toFixed(3) ?? null,
        importe: entrada.importe.toFixed(2),
        fecha: entrada.fecha,
        referencia: entrada.referencia ?? null,
        createdByUserId: entrada.usuarioId,
      });

      /*
       * En clientes **positivo es lo que deben**, al revés que en proveedores.
       * La retención baja la deuda, así que entra en negativo, igual que un
       * pago: para el cliente es plata que ya entregó, solo que al fisco.
       */
      await tx.insert(accountMovements).values({
        customerId: entrada.customerId,
        tipo: "pago",
        monto: (-entrada.importe).toFixed(2),
        detalle: `Retención de ${entrada.impuesto} · certificado ${entrada.numero.trim()}`,
        referencia: entrada.numero.trim(),
        createdByUserId: entrada.usuarioId,
      });
    });
  } catch (error) {
    /*
     * El índice único por cliente y número. Cargar dos veces el mismo papel
     * saldaría dos veces la misma deuda y computaría dos veces el crédito.
     */
    if (String(error).includes("retenciones_sufridas_numero_idx")) {
      return {
        ok: false,
        error: "Ese certificado ya está cargado para este cliente.",
      };
    }
    throw error;
  }

  return { ok: true };
}

export async function listarRetencionesSufridas(limite = 60) {
  await requireStaffRole("admin");

  return db
    .select({
      id: retencionesSufridas.id,
      numero: retencionesSufridas.numero,
      fecha: retencionesSufridas.fecha,
      impuesto: retencionesSufridas.impuesto,
      codigoRegimen: retencionesSufridas.codigoRegimen,
      base: retencionesSufridas.base,
      alicuota: retencionesSufridas.alicuota,
      importe: retencionesSufridas.importe,
      referencia: retencionesSufridas.referencia,
      cliente: customers.nombre,
      customerId: retencionesSufridas.customerId,
      cuit: customers.cuit,
    })
    .from(retencionesSufridas)
    .innerJoin(customers, eq(customers.id, retencionesSufridas.customerId))
    .orderBy(desc(retencionesSufridas.fecha))
    .limit(limite);
}

/**
 * El crédito por retenciones sufridas de un período, por impuesto.
 *
 * Es lo que se descuenta de cada impuesto en la declaración, y por eso se
 * separa: la de Ganancias no se puede aplicar contra el IVA.
 */
export async function creditoPorRetenciones(desde: Date, hasta: Date) {
  await requireStaffRole("admin");

  return db
    .select({
      impuesto: retencionesSufridas.impuesto,
      cantidad: sql<number>`count(*)::int`,
      total: sql<string>`sum(${retencionesSufridas.importe})`,
    })
    .from(retencionesSufridas)
    .where(
      and(
        gte(retencionesSufridas.fecha, desde),
        sql`${retencionesSufridas.fecha} <= ${hasta}`,
      ),
    )
    .groupBy(retencionesSufridas.impuesto);
}
