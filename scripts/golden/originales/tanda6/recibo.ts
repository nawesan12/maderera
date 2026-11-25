import "server-only";

import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  accountMovements,
  cashMovements,
  cashSessions,
  cheques,
  customers,
  receiptParts,
  receipts,
} from "@/lib/db/schema";
import { siguienteNumeroDeRecibo } from "./numeracion-ventas";
import { nombreDelCheque, normalizarNumeroDeCheque } from "@/lib/cheques/numero";
import {
  aCentavos,
  esCheque,
  revisarPartes,
  totalDePartes,
  type ParteDeCobro,
} from "@/lib/cobros/partes";

type Transaccion = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Un error que se puede mostrar tal cual.
 *
 * `emitirRecibo` corre adentro de la transacción de quien cobra; si algo no
 * cierra, tira esto para que la transacción entera vuelva atrás y la pantalla
 * reciba un motivo en castellano y no un error de Postgres.
 */
export class ErrorDeCobro extends Error {}

export interface Cobro {
  /** Nulo solo para el cobro de una factura a alguien sin cuenta. */
  customerId: string | null;
  /** El nombre que va en el papel. Si hay cliente y no viene, se lee de la ficha. */
  recibidoDe?: string;
  branchId?: string | null;
  origen: "panel" | "mostrador" | "portal" | "mercado_pago" | "factura";
  /** Qué se está pagando: «Cobro de Factura B 0015-00001234», «Pago a cuenta». */
  concepto?: string | null;
  partes: ParteDeCobro[];
  /** Por qué circuito va. Decide el circuito de los cheques que nacen acá. */
  circuito?: "blanco" | "negro";
  /**
   * Si el efectivo entra a la caja, y a cuál.
   *
   * El mostrador sabe su turno; el panel no siempre. Con `"buscar"` se usa la
   * única caja abierta, o la de la sucursal si hay varias; si no se puede
   * decidir, el cobro se registra igual y se devuelve el aviso.
   */
  caja?: { turnoId: string } | "buscar" | null;
  usuarioId?: string | null;
}

export interface ReciboEmitido {
  receiptId: string;
  numero: string;
  total: number;
  accountMovementId: string | null;
  /** Algo que hay que decirle a quien cobró, aunque el cobro salió bien. */
  aviso: string | null;
}

/**
 * Registra un cobro y emite su recibo.
 *
 * **Es la única forma de registrar un pago de un cliente.** Antes había cinco
 * caminos que insertaban un `pago` en la cuenta corriente —la ficha, la
 * factura, el pedido, la transferencia, Mercado Pago—, cada uno con su texto
 * libre, y ninguno dejaba un papel para darle al cliente. Ahora todos pasan
 * por acá, que hace cuatro cosas en la transacción de quien llama:
 *
 * 1. Numera el recibo (`REC-0001`, con lock).
 * 2. Crea los cheques que vienen con el cobro, o ata los que ya existían.
 * 3. Deja **un** movimiento de cuenta corriente por el total, atado al recibo.
 * 4. Si hay efectivo y se pidió, lo entra a la caja.
 *
 * Recibe la transacción y no la abre, igual que la numeración: el que cobra
 * decide qué más va en la misma transacción —la factura, el pedido, el pago
 * conciliado— y todo vale junto o nada.
 */
export async function emitirRecibo(
  tx: Transaccion,
  cobro: Cobro,
): Promise<ReciboEmitido> {
  const problema = revisarPartes(cobro.partes, cobro.circuito);
  if (problema) throw new ErrorDeCobro(problema);

  const total = totalDePartes(cobro.partes);

  let recibidoDe = cobro.recibidoDe?.trim() ?? "";
  if (cobro.customerId && !recibidoDe) {
    const [cliente] = await tx
      .select({ nombre: customers.nombre, razonSocial: customers.razonSocial })
      .from(customers)
      .where(eq(customers.id, cobro.customerId))
      .limit(1);
    if (!cliente) throw new ErrorDeCobro("No se encontró el cliente.");
    recibidoDe = cliente.razonSocial || cliente.nombre;
  }
  if (!recibidoDe) recibidoDe = "Consumidor final";

  const numero = await siguienteNumeroDeRecibo(tx);

  const [recibo] = await tx
    .insert(receipts)
    .values({
      numero,
      customerId: cobro.customerId,
      recibidoDe,
      branchId: cobro.branchId ?? null,
      total: total.toFixed(2),
      origen: cobro.origen,
      concepto: cobro.concepto ?? null,
      createdByUserId: cobro.usuarioId ?? null,
    })
    .returning({ id: receipts.id });

  const receiptId = recibo!.id;

  for (const [orden, parte] of cobro.partes.entries()) {
    const chequeId = esCheque(parte.medio)
      ? await chequeDeLaParte(tx, parte, {
          receiptId,
          customerId: cobro.customerId,
          circuito: cobro.circuito ?? "blanco",
          usuarioId: cobro.usuarioId ?? null,
        })
      : null;

    await tx.insert(receiptParts).values({
      receiptId,
      medio: parte.medio,
      importe: aCentavos(parte.importe).toFixed(2),
      chequeId,
      paymentId: parte.paymentId ?? null,
      referencia: parte.referencia?.trim() || null,
      orden,
    });
  }

  /*
   * Un solo movimiento por recibo, por el total.
   *
   * No uno por parte: la cuenta corriente dice «pagó $300.000 el 3/10, recibo
   * REC-0042» y el detalle de con qué está en el recibo. Tres renglones por un
   * mismo pago obligan a sumar de cabeza para conciliar con el cliente.
   */
  let accountMovementId: string | null = null;
  if (cobro.customerId) {
    const [movimiento] = await tx
      .insert(accountMovements)
      .values({
        customerId: cobro.customerId,
        tipo: "pago",
        monto: (-total).toFixed(2),
        detalle: cobro.concepto ? `${cobro.concepto} — recibo ${numero}` : `Recibo ${numero}`,
        referencia: numero,
        receiptId,
        createdByUserId: cobro.usuarioId ?? null,
      })
      .returning({ id: accountMovements.id });
    accountMovementId = movimiento!.id;

    await tx
      .update(receipts)
      .set({ accountMovementId })
      .where(eq(receipts.id, receiptId));
  }

  const efectivo = totalDePartes(cobro.partes.filter((p) => p.medio === "efectivo"));
  const aviso =
    efectivo > 0 && cobro.caja
      ? await efectivoALaCaja(tx, {
          caja: cobro.caja,
          branchId: cobro.branchId ?? null,
          monto: efectivo,
          motivo: `Recibo ${numero} — ${recibidoDe}`,
          usuarioId: cobro.usuarioId ?? null,
        })
      : null;

  return { receiptId, numero, total, accountMovementId, aviso };
}

/**
 * El cheque de una parte: lo crea, o ata el que ya existía.
 *
 * El duplicado se busca acá antes de insertar, aunque el índice único también
 * lo frena: el índice daría un error de Postgres y esto da un motivo que dice
 * qué cheque es.
 */
async function chequeDeLaParte(
  tx: Transaccion,
  parte: ParteDeCobro,
  contexto: {
    receiptId: string;
    customerId: string | null;
    circuito: "blanco" | "negro";
    usuarioId: string | null;
  },
): Promise<string> {
  if (parte.chequeId) {
    const [existente] = await tx
      .select({ id: cheques.id, estado: cheques.estado, importe: cheques.importe })
      .from(cheques)
      .where(eq(cheques.id, parte.chequeId))
      .limit(1);

    if (!existente) throw new ErrorDeCobro("Ese cheque ya no está.");
    // Uno informado llega acá al aceptarlo; uno de la cartera, si se lo vuelve a
    // usar —de un cliente que lo dejó a cuenta—. Cualquier otro estado ya no
    // es plata disponible.
    if (existente.estado !== "informado" && existente.estado !== "cartera") {
      throw new ErrorDeCobro("Ese cheque ya no está en cartera.");
    }
    if (Math.abs(Number(existente.importe) - parte.importe) > 0.005) {
      throw new ErrorDeCobro("El importe de la parte no coincide con el del cheque.");
    }

    await tx
      .update(cheques)
      .set({ estado: "cartera", receiptId: contexto.receiptId, updatedAt: new Date() })
      .where(eq(cheques.id, existente.id));
    return existente.id;
  }

  const nuevo = parte.cheque!;
  return registrarChequeRecibido(tx, {
    tipo: parte.medio === "echeq" ? "echeq" : "fisico",
    numero: nuevo.numero,
    banco: nuevo.banco,
    librador: nuevo.librador ?? null,
    emision: nuevo.emision ?? null,
    fechaPago: nuevo.fechaPago,
    importe: parte.importe,
    customerId: contexto.customerId,
    circuito: contexto.circuito,
    receiptId: contexto.receiptId,
    usuarioId: contexto.usuarioId,
  });
}

/**
 * Un cheque que entra a la cartera: lo crea, después de mirar que no esté ya.
 *
 * Lo usan el recibo y la venta del mostrador. El duplicado se busca antes de
 * insertar aunque el índice único también lo frena: el índice daría un error
 * de Postgres y esto da un motivo que dice qué cheque es.
 */
export async function registrarChequeRecibido(
  tx: Transaccion,
  datos: {
    tipo: "fisico" | "echeq";
    numero: string;
    banco: string;
    librador?: string | null;
    emision?: Date | null;
    fechaPago: Date;
    importe: number;
    customerId: string | null;
    circuito?: "blanco" | "negro";
    receiptId?: string | null;
    orderPaymentId?: string | null;
    usuarioId?: string | null;
  },
): Promise<string> {
  const numero = normalizarNumeroDeCheque(datos.numero);
  const banco = datos.banco.trim();

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
      `${nombreDelCheque({ tipo: datos.tipo, banco, numero })} ya está cargado. Buscalo en la cartera.`,
    );
  }

  const [creado] = await tx
    .insert(cheques)
    .values({
      sentido: "recibido",
      tipo: datos.tipo,
      numero,
      banco,
      librador: datos.librador?.trim() || null,
      emision: datos.emision ?? null,
      fechaPago: datos.fechaPago,
      importe: aCentavos(datos.importe).toFixed(2),
      estado: "cartera",
      customerId: datos.customerId,
      circuito: datos.circuito ?? "blanco",
      receiptId: datos.receiptId ?? null,
      orderPaymentId: datos.orderPaymentId ?? null,
      createdByUserId: datos.usuarioId ?? null,
    })
    .returning({ id: cheques.id });

  return creado!.id;
}

/**
 * El efectivo de un cobro entra a la caja.
 *
 * Es lo mismo que hacía el cobro de una factura, ahora para todos: un cliente
 * que viene a pagar la cuenta en efectivo es plata que está en el cajón, y si
 * no entra al arqueo el cierre del turno da faltante de algo que sobró.
 */
async function efectivoALaCaja(
  tx: Transaccion,
  {
    caja,
    branchId,
    monto,
    motivo,
    usuarioId,
  }: {
    caja: { turnoId: string } | "buscar";
    branchId: string | null;
    monto: number;
    motivo: string;
    usuarioId: string | null;
  },
): Promise<string | null> {
  let turnoId: string | null = caja === "buscar" ? null : caja.turnoId;

  if (!turnoId) {
    const turnos = await tx
      .select({ id: cashSessions.id, branchId: cashSessions.branchId })
      .from(cashSessions)
      .where(eq(cashSessions.estado, "abierta"));

    const elegido =
      turnos.find((t) => branchId && t.branchId === branchId) ??
      (turnos.length === 1 ? turnos[0] : undefined);

    if (!elegido) {
      return turnos.length === 0
        ? "No hay ninguna caja abierta, así que el efectivo no entró al arqueo."
        : "Hay varias cajas abiertas y no se pudo saber a cuál entra el efectivo: registralo a mano desde el mostrador.";
    }
    turnoId = elegido.id;
  }

  await tx.insert(cashMovements).values({
    sessionId: turnoId,
    tipo: "ingreso",
    monto: monto.toFixed(2),
    motivo,
    creadoPor: usuarioId,
  });

  return null;
}

/**
 * Anula un recibo.
 *
 * No lo borra: un recibo es un papel que el cliente tiene en la mano. Se marca
 * anulado con su motivo, y la cuenta recibe un asiento que revierte el pago.
 * Los cheques del recibo que todavía están en la cartera se anulan con él;
 * uno ya depositado o endosado no se toca —ese ya salió, y si vuelve, vuelve
 * como rechazo—.
 *
 * El efectivo que entró a la caja **no** se saca solo: si se anula un recibo
 * en efectivo es porque la plata no estaba, y eso lo resuelve quien cuenta la
 * caja con un retiro explicado.
 */
export async function anularRecibo(
  tx: Transaccion,
  {
    receiptId,
    motivo,
    usuarioId,
  }: { receiptId: string; motivo: string; usuarioId: string | null },
): Promise<{ numero: string; customerId: string | null }> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${receiptId}))`);

  const [recibo] = await tx
    .select()
    .from(receipts)
    .where(eq(receipts.id, receiptId))
    .limit(1);

  if (!recibo) throw new ErrorDeCobro("Ese recibo no está.");
  if (recibo.estado === "anulado") throw new ErrorDeCobro("Ese recibo ya estaba anulado.");

  const partes = await tx
    .select({ chequeId: receiptParts.chequeId })
    .from(receiptParts)
    .where(eq(receiptParts.receiptId, receiptId));

  for (const { chequeId } of partes) {
    if (!chequeId) continue;
    const [cheque] = await tx
      .select({ estado: cheques.estado })
      .from(cheques)
      .where(eq(cheques.id, chequeId))
      .limit(1);
    if (cheque && cheque.estado !== "cartera") {
      throw new ErrorDeCobro(
        "Un cheque de este recibo ya salió de la cartera: si el banco lo rechaza, se marca desde la cartera de cheques y la deuda vuelve sola.",
      );
    }
    await tx
      .update(cheques)
      .set({ estado: "anulado", updatedAt: new Date() })
      .where(eq(cheques.id, chequeId));
  }

  let anulacionMovementId: string | null = null;
  if (recibo.customerId) {
    const [movimiento] = await tx
      .insert(accountMovements)
      .values({
        customerId: recibo.customerId,
        tipo: "ajuste",
        monto: Number(recibo.total).toFixed(2),
        detalle: `Anulación del recibo ${recibo.numero}: ${motivo}`,
        referencia: recibo.numero,
        receiptId,
        createdByUserId: usuarioId,
      })
      .returning({ id: accountMovements.id });
    anulacionMovementId = movimiento!.id;
  }

  await tx
    .update(receipts)
    .set({
      estado: "anulado",
      motivoAnulacion: motivo,
      anuladoAt: new Date(),
      anuladoPorUserId: usuarioId,
      anulacionMovementId,
    })
    .where(eq(receipts.id, receiptId));

  return { numero: recibo.numero, customerId: recibo.customerId };
}
