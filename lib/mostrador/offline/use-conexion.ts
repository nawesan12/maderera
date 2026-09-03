"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * ¿Hay servidor de verdad?
 *
 * **`navigator.onLine` no alcanza y no es un detalle.** El modo de falla real
 * de una maderera no es el cable desenchufado: es el wifi asociado a un router
 * que se quedó sin internet. Ahí el navegador dice `true` y miente, y el POS
 * seguiría creyendo que puede cobrar contra el servidor.
 *
 * Lo único que prueba que hay servidor es una respuesta del servidor. Por eso
 * el latido, con un tope corto: una red mala que tarda diez segundos es, a los
 * efectos del mostrador, una red caída.
 *
 * `navigator.onLine === false` sí se cree, porque el negativo no miente: si el
 * sistema operativo dice que no hay interfaz, no hay.
 */

export interface EstadoConexion {
  enLinea: boolean;
  /** Cuándo se confirmó por última vez que había servidor. */
  ultimoContacto: Date | null;
  /** Desfasaje del reloj de esta máquina contra el servidor, en minutos. */
  desfasajeMin: number | null;
  latir: () => Promise<boolean>;
}

const CADA_MS = 20_000;
const TOPE_MS = 4_000;

/** Más de esto y la hora de las ventas offline saldría mal. */
const DESFASAJE_QUE_IMPORTA_MIN = 5;

export function useConexion(branchId: string): EstadoConexion {
  const [enLinea, setEnLinea] = useState(true);
  const [ultimoContacto, setUltimoContacto] = useState<Date | null>(null);
  const [desfasajeMin, setDesfasaje] = useState<number | null>(null);

  const latir = useCallback(async () => {
    // Salir del pulso sincrónico: si no, la primera llamada desde el efecto
    // escribe estado durante el render y dispara cascada.
    await Promise.resolve();

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setEnLinea(false);
      return false;
    }

    try {
      const respuesta = await fetch("/api/mostrador/latido", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId }),
        signal: AbortSignal.timeout(TOPE_MS),
      });

      if (!respuesta.ok) {
        // Un 401 es "no sos vos" y no "no hay red": la pantalla lo trata
        // distinto, pero para la conexión cuenta como que el servidor contestó.
        setEnLinea(respuesta.status === 401);
        return respuesta.status === 401;
      }

      const datos = await respuesta.json();
      const ahora = new Date();

      setEnLinea(true);
      setUltimoContacto(ahora);

      if (datos?.servidorAt) {
        const diferencia = Math.abs(
          new Date(datos.servidorAt).getTime() - ahora.getTime(),
        );
        const minutos = Math.round(diferencia / 60_000);
        setDesfasaje(minutos >= DESFASAJE_QUE_IMPORTA_MIN ? minutos : null);
      }

      return true;
    } catch {
      setEnLinea(false);
      return false;
    }
  }, [branchId]);

  useEffect(() => {
    /*
     * El primer latido sale en el tick siguiente y no dentro del efecto.
     *
     * `latir` ya es asíncrona, pero el análisis estático no puede saberlo y
     * marca la llamada como escritura de estado durante el render. Salir del
     * pulso lo vuelve evidente para la regla y para quien lea esto, y el costo
     * es un cuadro de animación en el peor caso.
     */
    const primero = setTimeout(() => void latir(), 0);

    const cada = setInterval(() => void latir(), CADA_MS);
    const alVolver = () => void latir();

    window.addEventListener("online", alVolver);
    window.addEventListener("visibilitychange", alVolver);

    return () => {
      clearTimeout(primero);
      clearInterval(cada);
      window.removeEventListener("online", alVolver);
      window.removeEventListener("visibilitychange", alVolver);
    };
  }, [latir]);

  return { enLinea, ultimoContacto, desfasajeMin, latir };
}
