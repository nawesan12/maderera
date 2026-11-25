"use client";

import { useCallback, useEffect, useState } from "react";
import { borrar, guardarMeta, leerMeta } from "./db";

/**
 * La caja física de esta máquina y su contador de números provisorios.
 *
 * El código lo asigna el servidor al vincular; acá solo se guarda, junto con el
 * contador que se usa cuando no hay conexión.
 *
 * **El contador no se reinicia nunca.** Ni por día ni por turno: un ticket de
 * ayer y uno de hoy no pueden compartir etiqueta, porque el papel provisorio es
 * lo único que tiene el cliente para reclamar.
 */

export interface CajaVinculada {
  id: string;
  codigo: string;
  secreto: string;
  /** El próximo número a usar. Se guarda antes de imprimir, nunca después. */
  proximoNumero: number;
}

export interface EstadoCaja {
  caja: CajaVinculada | null;
  vincular: (caja: Omit<CajaVinculada, "proximoNumero">) => Promise<void>;
  /**
   * Suelta la caja de esta máquina (ya desvinculada en el servidor). Si se
   * pasa el secreto, solo la suelta si sigue siendo ese: un latido viejo no
   * puede soltar la que se vinculó después.
   */
  desvincular: (secreto?: string) => Promise<void>;
  /** Consume el número actual. Se llama **después** de guardar la venta. */
  avanzar: () => Promise<void>;
}

type Contadores = Record<string, number>;

/**
 * El próximo número al volver a vincular `codigo`: el de la caja que ya tenía
 * esta máquina, o el que quedó guardado al desvincularla, o 1. Desvincular y
 * volver a vincular la misma caja no puede reiniciar la numeración.
 */
export function proximoAlVincular(
  codigo: string,
  previa: Pick<CajaVinculada, "codigo" | "proximoNumero"> | null,
  contadores: Contadores | null,
): number {
  const guardado = contadores?.[codigo] ?? 1;
  const actual = previa && previa.codigo === codigo ? previa.proximoNumero : 1;
  return Math.max(1, guardado, actual);
}

export function useCaja(): EstadoCaja {
  const [caja, setCaja] = useState<CajaVinculada | null>(null);

  useEffect(() => {
    let vivo = true;
    void leerMeta<CajaVinculada>("caja").then((guardada) => {
      if (vivo && guardada) setCaja(guardada);
    });
    return () => {
      vivo = false;
    };
  }, []);

  const vincular = useCallback(
    async (datos: Omit<CajaVinculada, "proximoNumero">) => {
      /*
       * Al vincular se arranca en 1, salvo que esta máquina ya tuviera un
       * contador: re-vincular no puede reiniciar la numeración, o dos ventas
       * de días distintos terminarían con el mismo papel.
       */
      const previa = await leerMeta<CajaVinculada>("caja");
      const contadores = await leerMeta<Contadores>("contadores");
      const proximoNumero = proximoAlVincular(datos.codigo, previa, contadores);

      const nueva = { ...datos, proximoNumero };
      await guardarMeta("caja", nueva);
      setCaja(nueva);
    },
    [],
  );

  const desvincular = useCallback(async (secreto?: string) => {
    const actual = await leerMeta<CajaVinculada>("caja");
    if (!actual) return;
    if (secreto !== undefined && actual.secreto !== secreto) return;

    const contadores = (await leerMeta<Contadores>("contadores")) ?? {};
    contadores[actual.codigo] = Math.max(contadores[actual.codigo] ?? 1, actual.proximoNumero);
    await guardarMeta("contadores", contadores);
    await borrar("meta", "caja");
    setCaja(null);
  }, []);

  const avanzar = useCallback(async () => {
    const actual = await leerMeta<CajaVinculada>("caja");
    if (!actual) return;

    const siguiente = { ...actual, proximoNumero: actual.proximoNumero + 1 };
    await guardarMeta("caja", siguiente);
    setCaja(siguiente);
  }, []);

  return { caja, vincular, desvincular, avanzar };
}
