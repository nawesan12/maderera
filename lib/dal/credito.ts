import "server-only";

import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { accountMovements, customers } from "@/lib/db/schema";
import { calcularAging } from "@/lib/cuenta-corriente/aging";

/**
 * Si a este cliente se le puede seguir cargando a cuenta corriente.
 *
 * Existe porque el control estaba **solo en el carrito del sitio**. El
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
  /**
   * El cliente no tiene crédito y lo que se le ofrece es su saldo a favor.
   * La pantalla lo nombra así y no «cuenta corriente».
   */
  soloSaldoAFavor?: boolean;
}

/**
 * A partir de cuántos días vence una deuda, cuando la ficha no dice otra cosa.
 *
 * El brief decía que el plazo «depende del cliente» y no lo fijaba, así que
 * durante un tiempo esto fue el plazo de todos. **Ahora es solo el valor por
 * omisión**: cada ficha tiene su `diasCredito`, porque la constructora a la que
 * se le dan 60 días y el que paga a 15 no pueden tener el mismo corte.
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
      diasCredito: customers.diasCredito,
      cuentaBloqueada: customers.cuentaBloqueada,
      motivoBloqueo: customers.motivoBloqueo,
    })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);

  if (!cliente) {
    return { ...vacio, motivo: "No se encontró la ficha del cliente." };
  }

  const limiteCredito = Number(cliente.limiteCredito);

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

  if (limiteCredito <= 0) {
    /*
     * Sin cuenta corriente, pero con plata a favor.
     *
     * De la clienta (30/9/2026): pagar «con dinero en cuenta». Un cliente sin
     * crédito que tiene saldo a favor —una nota de crédito, un pago de más—
     * puede usarlo para comprar hasta ese importe: la compra se carga a la
     * cuenta y el saldo la absorbe. Más allá de eso no hay crédito que
     * autorizar, así que no es autorizable.
     */
    const aFavor = Math.max(-saldo, 0);
    if (aFavor > 0 && !cliente.cuentaBloqueada) {
      const alcanza = monto <= aFavor + 0.005;
      return {
        ...vacio,
        saldo,
        disponible: aFavor,
        soloSaldoAFavor: true,
        puede: alcanza,
        motivo: alcanza
          ? null
          : `Tiene ${aFavor.toLocaleString("es-AR", { style: "currency", currency: "ARS" })} a favor y no alcanza: el resto, con otro medio.`,
      };
    }
    return {
      ...vacio,
      saldo,
      motivo: "Este cliente no tiene cuenta corriente habilitada.",
    };
  }
  const { diasDeLaMasVieja } = calcularAging(paraAging);
  const disponible = Math.max(limiteCredito - saldo, 0);

  const base = {
    saldo,
    limiteCredito,
    disponible,
    diasDeLaMasVieja,
    autorizable: true,
  };

  /*
   * El bloqueo puesto a mano.
   *
   * Va **antes** que todo lo demás y no es autorizable: alguien decidió cortarle
   * la cuenta a este cliente, y que el mostrador lo pueda saltear con un botón
   * vaciaría la decisión. Se levanta desde la ficha, que es donde se tomó.
   */
  if (cliente.cuentaBloqueada) {
    return {
      ...base,
      puede: false,
      autorizable: false,
      motivo: cliente.motivoBloqueo
        ? `Cuenta corriente bloqueada: ${cliente.motivoBloqueo}`
        : "La cuenta corriente está bloqueada.",
    };
  }

  if (cliente.estado === "moroso") {
    return {
      ...base,
      puede: false,
      motivo: "La cuenta está marcada como morosa.",
    };
  }

  // Deuda vencida: es el bloqueo que pide el brief y el que hasta ahora no
  // existía en ningún lado. El informe de antigüedad ya calculaba esto y solo
  // se mostraba. El plazo sale de la ficha de este cliente.
  const plazo = cliente.diasCredito || DIAS_PARA_VENCER;

  if (diasDeLaMasVieja !== null && diasDeLaMasVieja > plazo) {
    return {
      ...base,
      puede: false,
      motivo: `Tiene deuda de hace ${diasDeLaMasVieja} días, más de los ${plazo} de plazo.`,
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
