import "server-only";

import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { accountMovements, customers } from "@/lib/db/schema";
import { calcularAging } from "@/lib/cuenta-corriente/aging";

/**
 * Si a este cliente se le puede seguir cargando a cuenta corriente.
 *
 * Existe porque el control estaba **solo en el checkout del sitio**. El
 * mostrador pedía únicamente que hubiera un cliente elegido, y el cobro desde
 * Facturación aceptaba "cuenta corriente" sin mirar nada: los dos caminos por
 * los que entra la mayor parte de la venta de una maderera no verificaban ni
 * el límite ni la mora.
 *
 * El brief lo pide explícito: *"al vencer se bloquea la posibilidad de
 * facturación en cuenta corriente"*.
 *
 * A diferencia de `creditoDisponible()`, que mira la sesión del cliente, esta
 * recibe el `customerId` y la usa el personal.
 */

export interface EstadoDeCredito {
  puede: boolean;
  saldo: number;
  limiteCredito: number;
  disponible: number;
  /** Días de la deuda más vieja sin cancelar. `null` si no debe nada. */
  diasDeLaMasVieja: number | null;
  /** Por qué no puede. `null` cuando sí puede. */
  motivo: string | null;
  /**
   * Si un vendedor puede seguir igual, bajo su responsabilidad.
   *
   * El mostrador tiene a alguien esperando del otro lado, así que el bloqueo
   * por límite o por mora avisa fuerte pero se puede autorizar. Lo que **no**
   * se puede saltear es no tener cuenta corriente habilitada: eso no es un
   * atraso, es que el cliente nunca tuvo cuenta.
   */
  autorizable: boolean;
}

/**
 * A partir de cuántos días una deuda se considera vencida.
 *
 * El brief dice que el plazo de pago "depende del cliente" y no lo fija, así
 * que se toma el tramo que el propio informe de antigüedad ya usa como primer
 * corte: hasta 30 días está al día. Cuando el cliente defina plazos por ficha,
 * este número sale de ahí.
 */
export const DIAS_PARA_VENCER = 30;

export async function estadoDeCredito(
  customerId: string,
  monto = 0,
): Promise<EstadoDeCredito> {
  const vacio = {
    puede: false,
    saldo: 0,
    limiteCredito: 0,
    disponible: 0,
    diasDeLaMasVieja: null,
    autorizable: false,
  };

  const [cliente] = await db
    .select({
      limiteCredito: customers.limiteCredito,
      estado: customers.estado,
    })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);

  if (!cliente) {
    return { ...vacio, motivo: "No se encontró la ficha del cliente." };
  }

  const limiteCredito = Number(cliente.limiteCredito);

  if (limiteCredito <= 0) {
    return {
      ...vacio,
      motivo: "Este cliente no tiene cuenta corriente habilitada.",
    };
  }

  // Los movimientos completos y no solo la suma: la antigüedad necesita las
  // fechas para imputar los pagos contra las deudas más viejas.
  const movimientos = await db
    .select({ monto: accountMovements.monto, fecha: accountMovements.createdAt })
    .from(accountMovements)
    .where(eq(accountMovements.customerId, customerId));

  const paraAging = movimientos.map((m) => ({
    monto: Number(m.monto),
    fecha: m.fecha,
  }));

  const saldo = paraAging.reduce((suma, m) => suma + m.monto, 0);
  const { diasDeLaMasVieja } = calcularAging(paraAging);
  const disponible = Math.max(limiteCredito - saldo, 0);

  const base = {
    saldo,
    limiteCredito,
    disponible,
    diasDeLaMasVieja,
    autorizable: true,
  };

  if (cliente.estado === "moroso") {
    return {
      ...base,
      puede: false,
      motivo: "La cuenta está marcada como morosa.",
    };
  }

  // Deuda vencida: es el bloqueo que pide el brief y el que hasta ahora no
  // existía en ningún lado. El informe de antigüedad ya calculaba esto y solo
  // se mostraba.
  if (diasDeLaMasVieja !== null && diasDeLaMasVieja > DIAS_PARA_VENCER) {
    return {
      ...base,
      puede: false,
      motivo: `Tiene deuda de hace ${diasDeLaMasVieja} días, más de los ${DIAS_PARA_VENCER} de plazo.`,
    };
  }

  if (monto > 0 && saldo + monto > limiteCredito) {
    return {
      ...base,
      puede: false,
      motivo: `Supera el límite de crédito. Disponible: $${disponible.toLocaleString("es-AR")}.`,
    };
  }

  return { ...base, puede: true, motivo: null };
}

/** El saldo solo, sin traer los movimientos. */
export async function saldoDeCliente(customerId: string): Promise<number> {
  const [fila] = await db
    .select({ saldo: sql<string>`coalesce(sum(${accountMovements.monto}), 0)` })
    .from(accountMovements)
    .where(eq(accountMovements.customerId, customerId));

  return Number(fila?.saldo ?? 0);
}
