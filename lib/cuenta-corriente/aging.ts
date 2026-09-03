/**
 * Antigüedad de la deuda: cuánto de lo que se debe es viejo.
 *
 * Un saldo solo dice cuánto. La antigüedad dice **desde cuándo**, que es la
 * pregunta que decide si se sigue vendiendo a cuenta o se levanta el teléfono.
 * Un cliente que debe medio millón de la semana pasada y otro que debe lo
 * mismo desde hace cuatro meses tienen el mismo saldo y no son el mismo
 * problema.
 *
 * **Cómo se imputan los pagos.** La cuenta corriente de este sistema no ata
 * cada pago a un comprobante: son movimientos con signo que se suman. Así que
 * acá se aplica la regla estándar y la que usa cualquier estudio contable
 * cuando no hay imputación explícita: **el pago cancela lo más viejo primero**.
 * Es la interpretación que favorece al cliente —su deuda envejece lo menos
 * posible— y la que evita el error contrario, que sería mostrar como vencido
 * algo que ya se pagó.
 *
 * Es una función pura y sin base de datos a propósito: decide plata, así que
 * tiene que poder probarse sin levantar nada.
 */

/** Un movimiento, reducido a lo que la antigüedad necesita. */
export interface MovimientoParaAging {
  /** Positivo debe, negativo cancela. Es el signo que ya usa la tabla. */
  monto: number;
  fecha: Date;
}

export interface TramoDeAging {
  /** Cómo se lee el tramo. */
  etiqueta: string;
  /** Desde cuántos días, inclusive. */
  desde: number;
  /** Hasta cuántos días, inclusive. `null` es "y más". */
  hasta: number | null;
  monto: number;
}

export interface Aging {
  tramos: TramoDeAging[];
  /** Lo que se debe hoy. Nunca negativo: un saldo a favor no es deuda. */
  total: number;
  /** Saldo a favor, si pagó de más. */
  aFavor: number;
  /** Días de la deuda más vieja sin cancelar. `null` si no debe nada. */
  diasDeLaMasVieja: number | null;
}

const TRAMOS: { etiqueta: string; desde: number; hasta: number | null }[] = [
  { etiqueta: "Al día", desde: 0, hasta: 30 },
  { etiqueta: "31 a 60 días", desde: 31, hasta: 60 },
  { etiqueta: "61 a 90 días", desde: 61, hasta: 90 },
  { etiqueta: "Más de 90 días", desde: 91, hasta: null },
];

const UN_DIA = 24 * 60 * 60 * 1000;

function diasEntre(desde: Date, hasta: Date): number {
  return Math.max(0, Math.floor((hasta.getTime() - desde.getTime()) / UN_DIA));
}

export function calcularAging(
  movimientos: MovimientoParaAging[],
  hoy: Date = new Date(),
): Aging {
  // Del más viejo al más nuevo: el orden es el que define qué cancela qué.
  const ordenados = [...movimientos].sort(
    (a, b) => a.fecha.getTime() - b.fecha.getTime(),
  );

  /** Deudas todavía sin cancelar, en orden de antigüedad. */
  const pendientes: { monto: number; fecha: Date }[] = [];
  let aFavor = 0;

  for (const movimiento of ordenados) {
    if (movimiento.monto > 0) {
      // Si había saldo a favor, lo primero que hace la deuda nueva es consumirlo.
      let deuda = movimiento.monto;

      if (aFavor > 0) {
        const usa = Math.min(aFavor, deuda);
        aFavor -= usa;
        deuda -= usa;
      }

      if (deuda > 0) pendientes.push({ monto: deuda, fecha: movimiento.fecha });
      continue;
    }

    // Un pago cancela desde lo más viejo.
    let pago = -movimiento.monto;

    while (pago > 0 && pendientes.length > 0) {
      const masVieja = pendientes[0];
      const cancela = Math.min(pago, masVieja.monto);

      masVieja.monto -= cancela;
      pago -= cancela;

      if (masVieja.monto <= 0.005) pendientes.shift();
    }

    // Lo que sobra quedó pagado de más.
    if (pago > 0) aFavor += pago;
  }

  const tramos: TramoDeAging[] = TRAMOS.map((t) => ({ ...t, monto: 0 }));

  for (const pendiente of pendientes) {
    const dias = diasEntre(pendiente.fecha, hoy);
    const tramo =
      tramos.find((t) => dias >= t.desde && (t.hasta === null || dias <= t.hasta)) ??
      tramos[tramos.length - 1];

    tramo.monto += pendiente.monto;
  }

  const total = pendientes.reduce((suma, p) => suma + p.monto, 0);

  return {
    tramos,
    total: redondear(total),
    aFavor: redondear(aFavor),
    diasDeLaMasVieja:
      pendientes.length > 0 ? diasEntre(pendientes[0].fecha, hoy) : null,
  };
}

/** Dos decimales, que es como se guarda la plata en la base. */
function redondear(valor: number): number {
  return Math.round(valor * 100) / 100;
}
