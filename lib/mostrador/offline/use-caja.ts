"use client";

import { useCallback, useEffect, useState } from "react";
import { borrar, borrarVarios, guardarMeta, leerMeta, leerTodo, vaciar } from "./db";

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
  /**
   * `proximoNumero`, si viene, es el que dice el servidor: el siguiente al
   * último provisorio que subió con ese código, desde cualquier PC.
   */
  vincular: (caja: CajaDelServidor) => Promise<void>;
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

/** Lo que devuelve Go al vincular. */
export type CajaDelServidor = Omit<CajaVinculada, "proximoNumero"> & { proximoNumero?: number };

/**
 * El próximo número al volver a vincular `codigo`: el de la caja que ya tenía
 * esta máquina, o el que quedó guardado al desvincularla, o 1. Desvincular y
 * volver a vincular la misma caja no puede reiniciar la numeración.
 *
 * Tampoco vincularla en **otra** PC: el contador de esta máquina no sabe lo
 * que numeró la anterior, y su primera venta sin conexión salía CAJA1-001, un
 * número que ya existía (el papel repetido y la venta que no se podía subir).
 * Por eso cuenta también `servidor`, el siguiente al último provisorio de ese
 * código que ya está en la base.
 */
export function proximoAlVincular(
  codigo: string,
  previa: Pick<CajaVinculada, "codigo" | "proximoNumero"> | null,
  contadores: Contadores | null,
  servidor?: number | null,
): number {
  const guardado = contadores?.[codigo] ?? 1;
  const actual = previa && previa.codigo === codigo ? previa.proximoNumero : 1;
  const delServidor = typeof servidor === "number" && Number.isFinite(servidor) ? Math.floor(servidor) : 1;
  return Math.max(1, guardado, actual, delServidor);
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
    async ({ proximoNumero: delServidor, ...datos }: CajaDelServidor) => {
      /*
       * Al vincular se arranca en 1, salvo que esta máquina ya tuviera un
       * contador: re-vincular no puede reiniciar la numeración, o dos ventas
       * de días distintos terminarían con el mismo papel.
       */
      const previa = await leerMeta<CajaVinculada>("caja");
      const contadores = await leerMeta<Contadores>("contadores");
      const proximoNumero = proximoAlVincular(datos.codigo, previa, contadores, delServidor);

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
    await limpiarDatosDeLaCaja();
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

/**
 * Lo que una PC que deja de ser terminal no tiene por qué guardar (comité
 * del 25/11, Ley 25.326): el padrón de clientes con CUIT y teléfono, los
 * precios, los tickets y las ventas ya confirmadas de la cola. Quedaban en el
 * IndexedDB y se leían sin sesión. Se conservan los contadores (la
 * numeración no se reinicia) y lo que todavía no subió (Go no deja
 * desvincular con ventas pendientes, pero si una quedara, es plata). Sin la
 * marca del catálogo, la próxima copia es completa.
 */
export async function limpiarDatosDeLaCaja(): Promise<void> {
  try {
    await Promise.all([vaciar("clientes"), vaciar("tickets"), vaciar("precios")]);
    const cola = await leerTodo<{ clave: string; estado: string }>("cola");
    await borrarVarios(
      "cola",
      cola.filter((f) => f.estado === "confirmada").map((f) => f.clave),
    );
    await borrar("meta", "catalogo");
  } catch {
    // Sin almacén local (modo privado), no hay nada que limpiar.
  }
}
