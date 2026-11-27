"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { guardarFirma } from "./firma";

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
  /** Un latido ya; sin `false`, su respuesta manda sobre la marca. */
  latir: (directo?: boolean) => Promise<boolean>;
}

const CADA_MS = 20_000;
const TOPE_MS = 4_000;
/**
 * Un latido solo que no contesta no alcanza para decir «Sin conexión»: con el
 * servidor cargado, uno tardaba más del tope un minuto después de subir la
 * cola, y la barra y la caja volvían a «Sin conexión» con la red andando
 * (mes 23). Se reintenta enseguida y recién el segundo seguido baja la marca.
 */
const REINTENTO_MS = 3_000;

/** Más de esto y la hora de las ventas offline saldría mal. */
const DESFASAJE_QUE_IMPORTA_MIN = 5;

/** Lo que la máquina cuenta de sí misma en cada latido. */
export interface InformeDeCaja {
  caja: { id: string; secreto: string } | null;
  pendientes: number;
}

export function useConexion(
  branchId: string,
  /**
   * Se lee **en el momento de latir**, no cuando se pasa: los pendientes
   * cambian con cada venta y el latido tiene que contar los de ahora. Va por
   * ref justamente para eso, y para que cambiar de dato no reinicie el
   * intervalo cada vez que se cobra.
   */
  informe?: () => InformeDeCaja,
  /**
   * El servidor ya no reconoce la caja de esta máquina (la desvincularon):
   * recibe el secreto con que se latió, para soltar solo esa.
   */
  alPerderLaCaja?: (secreto: string) => void,
): EstadoConexion {
  const [enLinea, setEnLinea] = useState(true);
  const [ultimoContacto, setUltimoContacto] = useState<Date | null>(null);
  const [desfasajeMin, setDesfasaje] = useState<number | null>(null);

  const informeRef = useRef(informe);
  const perderRef = useRef(alPerderLaCaja);
  useEffect(() => {
    informeRef.current = informe;
    perderRef.current = alPerderLaCaja;
  }, [informe, alPerderLaCaja]);

  /*
   * Un latido: true si el servidor contestó. Solo escribe lo que trae la
   * respuesta; bajar la marca lo decide `latir`.
   */
  const unLatido = useCallback(async (): Promise<boolean> => {
    try {
      const informe = informeRef.current?.();
      const respuesta = await fetch("/api/mostrador/latido", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId, ...informe }),
        signal: AbortSignal.timeout(TOPE_MS),
      });

      if (!respuesta.ok) {
        // Un 401 es "no sos vos" y no "no hay red": la pantalla lo trata
        // distinto, pero para la conexión cuenta como que el servidor contestó.
        if (respuesta.status !== 401) return false;
        setEnLinea(true);
        return true;
      }

      const datos = await respuesta.json();
      const ahora = new Date();

      setEnLinea(true);
      setUltimoContacto(ahora);
      // La firma de esta sesión para las ventas que se encolen sin conexión.
      guardarFirma(datos?.firmaCola);
      if (datos?.cajaVigente === false && informe?.caja) {
        perderRef.current?.(informe.caja.secreto);
      }

      if (datos?.servidorAt) {
        const diferencia = Math.abs(
          new Date(datos.servidorAt).getTime() - ahora.getTime(),
        );
        const minutos = Math.round(diferencia / 60_000);
        setDesfasaje(minutos >= DESFASAJE_QUE_IMPORTA_MIN ? minutos : null);
      }

      return true;
    } catch {
      return false;
    }
  }, [branchId]);

  /*
   * `directo`: lo pidió la pantalla (una venta que no salió) y la respuesta
   * de este latido manda. El del reloj, antes de bajar la marca, espera un
   * momento y prueba otra vez.
   */
  const latir = useCallback(
    async (directo = true): Promise<boolean> => {
      // Salir del pulso sincrónico: si no, la primera llamada desde el efecto
      // escribe estado durante el render y dispara cascada.
      await Promise.resolve();

      // El negativo del sistema no miente: no se espera otro.
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        setEnLinea(false);
        return false;
      }
      if (await unLatido()) return true;
      if (!directo) {
        await new Promise((listo) => setTimeout(listo, REINTENTO_MS));
        if (await unLatido()) return true;
      }
      setEnLinea(false);
      return false;
    },
    [unLatido],
  );

  useEffect(() => {
    /*
     * El primer latido sale en el tick siguiente y no dentro del efecto.
     *
     * `latir` ya es asíncrona, pero el análisis estático no puede saberlo y
     * marca la llamada como escritura de estado durante el render. Salir del
     * pulso lo vuelve evidente para la regla y para quien lea esto, y el costo
     * es un cuadro de animación en el peor caso.
     */
    const primero = setTimeout(() => void latir(false), 0);

    const cada = setInterval(() => void latir(false), CADA_MS);
    const alVolver = () => void latir(false);

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
