import "server-only";

import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  branches,
  cashMovements,
  cashSessions,
  expenses,
  suppliers,
} from "@/lib/db/schema";
import { requireStaffRole } from "@/lib/dal/session";
import { turnoQueContiene } from "@/lib/mostrador/turno";

/**
 * Los gastos del negocio.
 *
 * **Un gasto en efectivo también sale de la caja.** Si solo se anota en la
 * tabla de gastos, al cierre falta plata que nadie puede explicar; si solo se
 * anota como retiro de caja, al cierre del mes nadie puede decir cuánto se
 * gastó en fletes. Por eso, cuando el medio es efectivo, se escriben las dos
 * filas en una transacción y quedan unidas por `expenseId`.
 */

export interface EntradaDeGasto {
  fecha: Date;
  categoria: string;
  descripcion: string;
  importe: number;
  medio: "efectivo" | "transferencia" | "debito" | "credito" | "cheque";
  branchId?: string | null;
  supplierId?: string | null;
  purchaseInvoiceId?: string | null;
  notas?: string | null;
  usuarioId: string;
}

export interface ResultadoGasto {
  ok: boolean;
  error?: string;
  /** Si el gasto en efectivo no encontró turno donde caer. */
  sinCaja?: boolean;
}

export async function registrarGasto(
  entrada: EntradaDeGasto,
): Promise<ResultadoGasto> {
  await requireStaffRole("admin");

  if (!Number.isFinite(entrada.importe) || entrada.importe <= 0) {
    return { ok: false, error: "El importe tiene que ser mayor a cero." };
  }
  if (!entrada.descripcion.trim()) {
    return {
      ok: false,
      error: "Poné en qué se gastó: un gasto sin descripción no se puede revisar después.",
    };
  }

  return db.transaction(async (tx) => {
    const [gasto] = await tx
      .insert(expenses)
      .values({
        fecha: entrada.fecha,
        categoria: entrada.categoria as "otros",
        descripcion: entrada.descripcion.trim(),
        importe: entrada.importe.toFixed(2),
        medio: entrada.medio,
        branchId: entrada.branchId ?? null,
        supplierId: entrada.supplierId ?? null,
        purchaseInvoiceId: entrada.purchaseInvoiceId ?? null,
        notas: entrada.notas ?? null,
        createdByUserId: entrada.usuarioId,
      })
      .returning({ id: expenses.id });

    // Solo el efectivo toca la caja. Una transferencia sale del banco y no del
    // cajón: anotarla como salida de caja generaría un faltante inventado.
    if (entrada.medio !== "efectivo" || !entrada.branchId) {
      return { ok: true };
    }

    const turno = await turnoQueContiene(tx, entrada.branchId, entrada.fecha);

    if (!turno) {
      /*
       * El gasto queda registrado igual. La plata salió del cajón haya turno o
       * no, y rechazarlo por eso dejaría el gasto sin anotar en ningún lado,
       * que es peor: al menos así el arqueo muestra la diferencia y el gasto
       * explica de dónde vino.
       */
      return { ok: true, sinCaja: true };
    }

    await tx.insert(cashMovements).values({
      sessionId: turno.id,
      tipo: "gasto",
      // Negativo: la plata se fue. El signo va en el monto y no en el tipo,
      // como en el resto del libro, para que el esperado sea una suma sola.
      monto: (-entrada.importe).toFixed(2),
      motivo: entrada.descripcion.trim(),
      expenseId: gasto.id,
      creadoPor: entrada.usuarioId,
      createdAt: entrada.fecha,
    });

    return { ok: true };
  });
}

export async function listarGastos(limite = 60) {
  await requireStaffRole("admin");

  return db
    .select({
      id: expenses.id,
      fecha: expenses.fecha,
      categoria: expenses.categoria,
      descripcion: expenses.descripcion,
      importe: expenses.importe,
      medio: expenses.medio,
      sucursal: branches.name,
      proveedor: suppliers.nombre,
      notas: expenses.notas,
      /* Si tocó la caja: es lo que explica por qué el arqueo dio distinto. */
      enCaja: sql<boolean>`exists (
        select 1 from ${cashMovements}
        where ${cashMovements.expenseId} = ${expenses.id}
      )`,
    })
    .from(expenses)
    .leftJoin(branches, eq(branches.id, expenses.branchId))
    .leftJoin(suppliers, eq(suppliers.id, expenses.supplierId))
    .orderBy(desc(expenses.fecha))
    .limit(limite);
}

/** Cuánto se gastó por categoría en un período. */
export async function gastosPorCategoria(desde: Date, hasta: Date) {
  await requireStaffRole("admin");

  return db
    .select({
      categoria: expenses.categoria,
      cantidad: sql<number>`count(*)::int`,
      total: sql<string>`sum(${expenses.importe})`,
    })
    .from(expenses)
    .where(
      and(gte(expenses.fecha, desde), sql`${expenses.fecha} <= ${hasta}`),
    )
    .groupBy(expenses.categoria)
    .orderBy(desc(sql`sum(${expenses.importe})`));
}

/** Las sucursales donde se puede imputar un gasto en efectivo. */
export async function sucursalesParaGasto() {
  await requireStaffRole("admin");

  return db
    .select({
      id: branches.id,
      nombre: branches.name,
      turnoAbierto: cashSessions.id,
    })
    .from(branches)
    .leftJoin(
      cashSessions,
      and(
        eq(cashSessions.branchId, branches.id),
        eq(cashSessions.estado, "abierta"),
      ),
    )
    .where(eq(branches.active, true))
    .orderBy(branches.sortOrder);
}
