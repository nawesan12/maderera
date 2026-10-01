import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { cheques, customers } from "@/lib/db/schema";
import * as plantillas from "@/lib/email/plantillas";
import { despacharEmail } from "@/lib/notificaciones/avisos";
import { reciboCompleto } from "@/lib/dal/recibos";
import { obtenerConfiguracionFiscal } from "@/lib/fiscal/emitir";
import { reciboPdf } from "@/lib/pdf/recibo";
import { NOMBRE_DEL_MEDIO } from "@/lib/cobros/partes";
import { nombreDelCheque } from "@/lib/cheques/numero";

/**
 * Los avisos de cobros: el recibo y el cheque rechazado.
 *
 * Siguen las reglas de `avisos.ts`: nunca frenan la operación —se llaman
 * después del commit y no lanzan— y todo queda en la bitácora de avisos.
 */

/** Le manda al cliente el recibo, con el PDF adjunto. */
export async function notificarRecibo(receiptId: string): Promise<void> {
  try {
    const recibo = await reciboCompleto(receiptId);
    if (!recibo?.cliente || recibo.estado !== "emitido") return;

    const [cliente] = await db
      .select({ nombre: customers.nombre, email: customers.email })
      .from(customers)
      .where(eq(customers.id, recibo.cliente.id))
      .limit(1);
    if (!cliente?.email) return;

    const pdf = await reciboPdf(recibo, await obtenerConfiguracionFiscal());
    const medios = [...new Set(recibo.partes.map((p) => NOMBRE_DEL_MEDIO[p.medio]))].join(", ");

    await despacharEmail({
      evento: "recibo_emitido",
      para: cliente.email,
      entidadTipo: "receipt",
      entidadId: receiptId,
      correo: plantillas.reciboEmitido({
        nombre: cliente.nombre.split(" ")[0] ?? cliente.nombre,
        numero: recibo.numero,
        total: recibo.total,
        medios,
        saldo: recibo.saldoDespues,
      }),
      adjuntos: [
        { nombre: `recibo-${recibo.numero}.pdf`, contenido: pdf, tipo: "application/pdf" },
      ],
    });
  } catch {
    // Regla 1 de `avisos.ts`: un correo que no sale no deshace un cobro.
  }
}

/** Le avisa al cliente que un cheque suyo no se tomó o lo rechazó el banco. */
export async function notificarChequeRechazado(
  chequeId: string,
  porElBanco: boolean,
): Promise<void> {
  try {
    const [fila] = await db
      .select({
        tipo: cheques.tipo,
        numero: cheques.numero,
        banco: cheques.banco,
        importe: cheques.importe,
        motivo: cheques.motivoRechazo,
        nombre: customers.nombre,
        email: customers.email,
      })
      .from(cheques)
      .innerJoin(customers, eq(customers.id, cheques.customerId))
      .where(eq(cheques.id, chequeId))
      .limit(1);
    if (!fila?.email) return;

    await despacharEmail({
      evento: "cheque_rechazado",
      para: fila.email,
      entidadTipo: "cheque",
      entidadId: chequeId,
      correo: plantillas.chequeRechazado({
        nombre: fila.nombre.split(" ")[0] ?? fila.nombre,
        cheque: nombreDelCheque(fila),
        importe: fila.importe,
        motivo: fila.motivo,
        porElBanco,
      }),
    });
  } catch {
    // Regla 1.
  }
}
