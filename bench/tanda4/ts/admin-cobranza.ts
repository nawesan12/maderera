import "server-only";

import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { accountMovements } from "@/lib/db/schema";
import { calcularAging } from "@/lib/cuenta-corriente/aging";
import {
  prioridadDeCobranza,
  type Prioridad,
} from "@/lib/cuenta-corriente/prioridad";

/**
 * La cartera a cobrar, ordenada por a quién llamar primero.
 *
 * **Por qué en memoria y no en SQL.** La antigüedad de una deuda no es una
 * resta de fechas: es imputar cada pago contra las deudas más viejas y ver qué
 * queda, que es lo que hace `calcularAging` y está probado. Escribirlo como
 * consulta significaría tener esa regla en dos lugares, y el día que cambie
 * —porque el contador diga otra cosa— uno de los dos va a quedar atrás.
 *
 * Se traen los movimientos de los clientes con saldo en **una sola consulta** y
 * se agrupan acá. Con la cartera de una maderera de barrio son unos miles de
 * renglones; el día que sean cientos de miles, esto se convierte en una vista
 * materializada y la regla sigue viviendo en el mismo lugar.
 */
export interface DeudaDeCliente {
  customerId: string;
  /** Lo que ya venció, según el plazo de este cliente. */
  vencido: number;
  diasDeLaMasVieja: number | null;
  prioridad: Prioridad;
}

export async function deudaPorCliente(
  clientes: { id: string; diasCredito: number; cuentaBloqueada: boolean }[],
  hoy: Date = new Date(),
): Promise<Map<string, DeudaDeCliente>> {
  const porCliente = new Map<string, DeudaDeCliente>();

  if (clientes.length === 0) return porCliente;

  const movimientos = await db
    .select({
      customerId: accountMovements.customerId,
      monto: accountMovements.monto,
      fecha: accountMovements.createdAt,
    })
    .from(accountMovements)
    .where(
      inArray(
        accountMovements.customerId,
        clientes.map((c) => c.id),
      ),
    );

  const agrupados = new Map<string, { monto: number; fecha: Date }[]>();

  for (const m of movimientos) {
    if (!m.customerId) continue;
    const lista = agrupados.get(m.customerId) ?? [];
    lista.push({ monto: Number(m.monto), fecha: m.fecha });
    agrupados.set(m.customerId, lista);
  }

  for (const cliente of clientes) {
    const aging = calcularAging(agrupados.get(cliente.id) ?? [], hoy);

    /*
     * Lo vencido según **el plazo de este cliente**, no el tramo fijo del
     * informe de antigüedad: los tramos son de 30, 60 y 90 días y el plazo
     * puede ser 15 o 60. Se suma lo que está en tramos más viejos que su plazo.
     */
    const vencido = aging.tramos
      .filter((t) => t.desde > cliente.diasCredito)
      .reduce((total, t) => total + t.monto, 0);

    porCliente.set(cliente.id, {
      customerId: cliente.id,
      vencido,
      diasDeLaMasVieja: aging.diasDeLaMasVieja,
      prioridad: prioridadDeCobranza({
        vencido,
        diasDeLaMasVieja: aging.diasDeLaMasVieja,
        diasCredito: cliente.diasCredito,
        bloqueada: cliente.cuentaBloqueada,
      }),
    });
  }

  return porCliente;
}
