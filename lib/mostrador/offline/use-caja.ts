"use client";

import { useCallback, useEffect, useState } from "react";
import { guardarMeta, leerMeta } from "./db";

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
  /** Consume el número actual. Se llama **después** de guardar la venta. */
  avanzar: () => Promise<void>;
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
      const proximoNumero =
        previa && previa.codigo === datos.codigo ? previa.proximoNumero : 1;

      const nueva = { ...datos, proximoNumero };
      await guardarMeta("caja", nueva);
      setCaja(nueva);
    },
    [],
  );

  const avanzar = useCallback(async () => {
    const actual = await leerMeta<CajaVinculada>("caja");
    if (!actual) return;

    const siguiente = { ...actual, proximoNumero: actual.proximoNumero + 1 };
    await guardarMeta("caja", siguiente);
    setCaja(siguiente);
  }, []);

  return { caja, vincular, avanzar };
}
