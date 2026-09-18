/**
 * A quién hay que llamar primero.
 *
 * Lo pidió la clienta: «si el cliente está en 30 días de deuda que el sistema
 * indique a quién darle prioridad». Hasta ahora la lista de clientes mostraba
 * el saldo y ordenaba por nombre, así que «a quién llamo hoy» se contestaba
 * mirando cuarenta tarjetas.
 *
 * **La prioridad no es el saldo.** Deber $2.000.000 comprados ayer no es un
 * problema; deber $300.000 de hace cuatro meses sí, porque cada día que pasa la
 * plata vale menos y la posibilidad de cobrarla también. Por eso el orden sale
 * de **cuánto está vencido y desde cuándo**, no del total.
 *
 * Lógica pura y con test: es la que decide el orden en que se llama a la
 * cartera, y equivocarla significa perseguir al que compra bien y dejar
 * envejecer al que no paga.
 */

export interface DeudaParaPriorizar {
  /** Lo que debe hoy, sin contar lo que todavía no venció. */
  vencido: number;
  /** Días de la deuda más vieja sin cancelar. `null` si no debe nada. */
  diasDeLaMasVieja: number | null;
  /** El plazo que tiene este cliente. Lo que pasa de ahí está vencido. */
  diasCredito: number;
  /** Si alguien ya le cortó la cuenta a mano. */
  bloqueada: boolean;
}

export type Urgencia = "bloqueada" | "urgente" | "atrasada" | "al-dia";

export interface Prioridad {
  urgencia: Urgencia;
  /** Para ordenar: más alto, antes. No es plata, es una medida de atraso. */
  puntaje: number;
  /** Cuántos días pasó del plazo. Cero si todavía está en término. */
  diasVencida: number;
}

/**
 * Cuánto se pasó del plazo y qué tan urgente es.
 *
 * El puntaje es **la plata vencida por los días de atraso**: mil pesos de hace
 * cien días y cien mil de hace un día no son lo mismo, y cualquiera de las dos
 * mitades por separado ordena mal.
 */
export function prioridadDeCobranza(deuda: DeudaParaPriorizar): Prioridad {
  const diasVencida =
    deuda.diasDeLaMasVieja === null
      ? 0
      : Math.max(0, deuda.diasDeLaMasVieja - deuda.diasCredito);

  if (deuda.bloqueada) {
    return {
      urgencia: "bloqueada",
      // Arriba de todo: es a quien ya se le cortó la cuenta y sigue debiendo.
      puntaje: Number.MAX_SAFE_INTEGER,
      diasVencida,
    };
  }

  if (deuda.vencido <= 0 || diasVencida <= 0) {
    return { urgencia: "al-dia", puntaje: 0, diasVencida };
  }

  return {
    // Pasado el doble del plazo ya no es un atraso, es una cobranza.
    urgencia: diasVencida > deuda.diasCredito ? "urgente" : "atrasada",
    puntaje: deuda.vencido * diasVencida,
    diasVencida,
  };
}

/** Cómo se dice cada urgencia en la pantalla. */
export const ETIQUETA_URGENCIA: Record<Urgencia, string> = {
  bloqueada: "Cuenta bloqueada",
  urgente: "Llamar hoy",
  atrasada: "Atrasado",
  "al-dia": "En término",
};
