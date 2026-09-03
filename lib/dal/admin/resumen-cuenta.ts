import "server-only";

import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { accountMovements, customers } from "@/lib/db/schema";
import { calcularAging, type Aging } from "@/lib/cuenta-corriente/aging";

export interface MovimientoDelResumen {
  id: string;
  fecha: Date;
  tipo: string;
  detalle: string | null;
  referencia: string | null;
  monto: number;
  /** Saldo después de este movimiento. Es la columna que se sigue con el dedo. */
  saldo: number;
}

export interface ResumenDeCuenta {
  cliente: {
    id: string;
    nombre: string;
    razonSocial: string | null;
    cuit: string | null;
    direccion: string | null;
    limiteCredito: number;
  };
  movimientos: MovimientoDelResumen[];
  saldo: number;
  aging: Aging;
}

/**
 * El resumen de cuenta que se le manda al cliente.
 *
 * Trae **todos** los movimientos y no los últimos veinte como la ficha del
 * panel: un resumen que empieza en el medio no se puede seguir, porque el
 * saldo de arriba sale de la nada.
 *
 * El saldo acumulado se calcula acá y no en SQL con una ventana. Son unos
 * cientos de filas por cliente y el cálculo es una suma; hacerlo en la base
 * ataría el resumen a una consulta más difícil de leer sin ganar nada medible.
 */
export async function resumenDeCuenta(
  customerId: string,
): Promise<ResumenDeCuenta | null> {
  const [cliente] = await db
    .select({
      id: customers.id,
      nombre: customers.nombre,
      razonSocial: customers.razonSocial,
      cuit: customers.cuit,
      direccion: customers.direccion,
      limiteCredito: customers.limiteCredito,
    })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);

  if (!cliente) return null;

  const filas = await db
    .select({
      id: accountMovements.id,
      fecha: accountMovements.createdAt,
      tipo: accountMovements.tipo,
      detalle: accountMovements.detalle,
      referencia: accountMovements.referencia,
      monto: accountMovements.monto,
    })
    .from(accountMovements)
    .where(eq(accountMovements.customerId, customerId))
    .orderBy(asc(accountMovements.createdAt));

  let acumulado = 0;

  const movimientos = filas.map((f) => {
    const monto = Number(f.monto);
    acumulado += monto;

    return {
      id: f.id,
      fecha: f.fecha,
      tipo: f.tipo,
      detalle: f.detalle,
      referencia: f.referencia,
      monto,
      saldo: Math.round(acumulado * 100) / 100,
    };
  });

  return {
    cliente: {
      ...cliente,
      limiteCredito: Number(cliente.limiteCredito ?? 0),
    },
    movimientos,
    saldo: Math.round(acumulado * 100) / 100,
    aging: calcularAging(
      movimientos.map((m) => ({ monto: m.monto, fecha: m.fecha })),
    ),
  };
}
