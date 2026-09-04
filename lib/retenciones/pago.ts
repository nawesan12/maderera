import "server-only";

import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  regimenesRetencion,
  retencionesPracticadas,
  supplierMovements,
  supplierPayments,
  suppliers,
} from "@/lib/db/schema";
import { calcularRetencion, type RegimenDeRetencion } from "./calculo";

/**
 * Pagarle a un proveedor, con las retenciones que correspondan.
 *
 * **La retención no es un gasto: es parte del pago.** Se le pagan $100 de
 * factura con $95 de transferencia y $5 de retención, y la deuda queda saldada
 * en $100. Por eso va **un solo** movimiento de cuenta corriente, por el total:
 * anotar la transferencia y la retención como dos movimientos bajaría la deuda
 * $105 y el proveedor terminaría figurando con saldo a favor.
 *
 * Todo en una transacción. Un pago registrado cuyas retenciones no llegaron a
 * guardarse deja certificados prometidos que no existen, y el proveedor los
 * reclama en su declaración jurada.
 */

export interface RetencionAAplicar {
  regimenId: string;
  /** La base de este pago para el régimen. Depende de cuál: neto, IVA, total. */
  base: number;
}

export interface EntradaDePago {
  supplierId: string;
  /** Lo que se le imputa a la deuda, retenciones incluidas. */
  total: number;
  medio: string;
  referencia?: string | null;
  notas?: string | null;
  fecha?: Date;
  retenciones: RetencionAAplicar[];
  usuarioId: string;
}

export interface ResultadoPago {
  ok: true;
  paymentId: string;
  /** Lo que efectivamente sale del banco. */
  neto: number;
  certificados: { numero: string; impuesto: string; importe: number }[];
}

export interface FalloPago {
  ok: false;
  error: string;
}

function aCentavos(v: number): number {
  return Math.round(v * 100) / 100;
}

export async function registrarPagoAProveedor(
  entrada: EntradaDePago,
): Promise<ResultadoPago | FalloPago> {
  if (!Number.isFinite(entrada.total) || entrada.total <= 0) {
    return { ok: false, error: "El pago tiene que ser mayor a cero." };
  }

  const fecha = entrada.fecha ?? new Date();

  return db.transaction(async (tx) => {
    const [proveedor] = await tx
      .select({ nombre: suppliers.nombre, cuit: suppliers.cuit })
      .from(suppliers)
      .where(eq(suppliers.id, entrada.supplierId))
      .limit(1);

    if (!proveedor) return { ok: false as const, error: "Ese proveedor no existe." };

    const [pago] = await tx
      .insert(supplierPayments)
      .values({
        supplierId: entrada.supplierId,
        fecha,
        total: entrada.total.toFixed(2),
        // Se corrige abajo, cuando se sepa cuánto se retuvo.
        neto: entrada.total.toFixed(2),
        medio: entrada.medio,
        referencia: entrada.referencia ?? null,
        notas: entrada.notas ?? null,
        createdByUserId: entrada.usuarioId,
      })
      .returning({ id: supplierPayments.id });

    const certificados: ResultadoPago["certificados"] = [];
    let retenido = 0;

    for (const pedida of entrada.retenciones) {
      const [fila] = await tx
        .select()
        .from(regimenesRetencion)
        .where(eq(regimenesRetencion.id, pedida.regimenId))
        .limit(1);

      if (!fila) continue;

      const regimen: RegimenDeRetencion = {
        codigo: fila.codigo,
        nombre: fila.nombre,
        impuesto: fila.impuesto,
        alicuota: Number(fila.alicuota),
        alicuotaNoInscripto: Number(fila.alicuotaNoInscripto),
        minimoNoImponible: Number(fila.minimoNoImponible),
        minimoRetencion: Number(fila.minimoRetencion),
      };

      /*
       * El acumulado del mes, que es lo que mira ARCA. **Es el error que más
       * se comete a mano**: con el mínimo no imponible, cuatro pagos chicos no
       * retienen mirados de a uno y sí retienen mirados juntos.
       */
      const inicioDeMes = new Date(fecha.getFullYear(), fecha.getMonth(), 1);

      const [acumulado] = await tx
        .select({
          base: sql<string>`coalesce(sum(${retencionesPracticadas.base}), 0)`,
          retenido: sql<string>`coalesce(sum(${retencionesPracticadas.importe}), 0)`,
        })
        .from(retencionesPracticadas)
        .where(
          and(
            eq(retencionesPracticadas.supplierId, entrada.supplierId),
            eq(retencionesPracticadas.codigoRegimen, fila.codigo),
            gte(retencionesPracticadas.fecha, inicioDeMes),
          ),
        );

      /*
       * Se toma como inscripto a quien tiene CUIT cargado. Es la aproximación
       * honesta: la constatación real es contra el padrón de ARCA, que este
       * sistema todavía no consulta, y suponer lo contrario le retendría el
       * 28 % a todo el mundo.
       */
      const resultado = calcularRetencion({
        base: pedida.base,
        acumuladoMes: Number(acumulado?.base ?? 0),
        retenidoMes: Number(acumulado?.retenido ?? 0),
        regimen,
        inscripto: Boolean(proveedor.cuit),
      });

      if (resultado.retencion <= 0) continue;

      const numero = await siguienteCertificado(tx, fila.impuesto, fecha);

      await tx.insert(retencionesPracticadas).values({
        paymentId: pago.id,
        supplierId: entrada.supplierId,
        regimenId: fila.id,
        numero,
        // Copiados del régimen, no referenciados: si mañana ARCA cambia la
        // alícuota, este certificado tiene que seguir diciendo la de hoy.
        codigoRegimen: fila.codigo,
        impuesto: fila.impuesto,
        base: pedida.base.toFixed(2),
        alicuota: resultado.alicuota.toFixed(3),
        importe: resultado.retencion.toFixed(2),
        fecha,
        createdByUserId: entrada.usuarioId,
      });

      retenido = aCentavos(retenido + resultado.retencion);
      certificados.push({
        numero,
        impuesto: fila.impuesto,
        importe: resultado.retencion,
      });
    }

    const neto = aCentavos(entrada.total - retenido);

    if (neto < 0) {
      // Retener más que el pago no es posible: significa que la base estaba
      // mal. Se aborta entero antes de dejar un pago negativo en el libro.
      throw new Error("Las retenciones superan el importe del pago.");
    }

    await tx
      .update(supplierPayments)
      .set({ neto: neto.toFixed(2) })
      .where(eq(supplierPayments.id, pago.id));

    /*
     * **Un solo movimiento, por el total.** La deuda baja por lo pagado más lo
     * retenido: el proveedor entregó su mercadería y recibió a cambio una
     * transferencia y unos certificados que valen plata contra el fisco.
     */
    await tx.insert(supplierMovements).values({
      supplierId: entrada.supplierId,
      tipo: "pago",
      monto: (-entrada.total).toFixed(2),
      referencia: entrada.referencia ?? null,
      detalle:
        retenido > 0
          ? `Pago ${entrada.medio} por $${neto.toFixed(2)} más $${retenido.toFixed(2)} de retenciones`
          : `Pago ${entrada.medio}`,
      createdByUserId: entrada.usuarioId,
    });

    return { ok: true as const, paymentId: pago.id, neto, certificados };
  });
}

/**
 * Numera el certificado.
 *
 * La serie es por impuesto y por año, que es como los pide el contador. El lock
 * lo da el índice único sobre `numero`: si dos pagos simultáneos sacan el mismo,
 * el segundo aborta y la transacción entera se deshace, que es lo correcto —un
 * certificado duplicado es un papel que dice ser otro—.
 */
async function siguienteCertificado(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  impuesto: string,
  fecha: Date,
): Promise<string> {
  const anio = fecha.getFullYear();
  const prefijo = `${impuesto.slice(0, 3).toUpperCase()}-${anio}-`;

  const [fila] = await tx
    .select({
      maximo: sql<number>`coalesce(max(nullif(regexp_replace(${retencionesPracticadas.numero}, '^.*-', ''), '')::bigint), 0)::int`,
    })
    .from(retencionesPracticadas)
    .where(sql`${retencionesPracticadas.numero} like ${prefijo + "%"}`);

  return `${prefijo}${String(Number(fila?.maximo ?? 0) + 1).padStart(6, "0")}`;
}
