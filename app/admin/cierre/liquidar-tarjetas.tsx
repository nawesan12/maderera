"use client";

import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";
import { cargarLiquidacion, type EstadoDelCierre } from "./actions";
import { formatearMontoContable } from "@/lib/formato";

/**
 * Lo cobrado con tarjeta que todavía no liquidó, y la forma de anotar la
 * liquidación cuando llega al banco (mes simulado, M2S1-058): pasa de
 * Tarjetas a acreditar al Banco, neto de la comisión.
 */
export function LiquidarTarjetas({ saldo, hoy }: { saldo: number; hoy: string }) {
  const [estado, accion, pendiente] = useActionState<EstadoDelCierre, FormData>(cargarLiquidacion, {});
  const [abierto, setAbierto] = useState(false);
  const [visto, setVisto] = useState(estado);
  if (estado !== visto) {
    setVisto(estado);
    if (!estado.error) setAbierto(false);
  }

  const campo = "tabular mt-1 h-11 w-full rounded-lg bg-hundida px-3 text-base";
  return (
    <article className="tarjeta p-4">
      <p className="text-sm text-muted-foreground">Tarjetas a acreditar</p>
      <p className="tabular mt-0.5 text-2xl font-bold">{formatearMontoContable(saldo)}</p>
      {!abierto ? (
        <button
          type="button"
          onClick={() => setAbierto(true)}
          className="mt-1 inline-flex min-h-10 items-center text-base font-medium text-acento-texto hover:underline"
        >
          Anotar liquidación
        </button>
      ) : (
        <form action={accion} className="mt-2 grid grid-cols-2 gap-2">
          <label className="col-span-2 block text-sm">
            Fecha
            <input type="date" name="fecha" required defaultValue={hoy} max={hoy} className={campo} />
          </label>
          <label className="block text-sm">
            Liquidado
            <input name="bruto" required inputMode="decimal" className={campo} />
          </label>
          <label className="block text-sm">
            Comisión
            <input name="comision" inputMode="decimal" defaultValue="0" className={campo} />
          </label>
          <div className="col-span-2 flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={pendiente}
              className="boton-accion inline-flex h-11 items-center gap-1.5 rounded-lg px-4 text-base font-medium disabled:opacity-60"
            >
              {pendiente && <Loader2 className="h-4 w-4 animate-spin" />}
              Anotar
            </button>
            <button
              type="button"
              onClick={() => setAbierto(false)}
              className="inline-flex h-11 items-center rounded-lg border border-linea px-3.5 text-base font-medium hover:bg-hundida"
            >
              Cancelar
            </button>
          </div>
          {estado.error && (
            <p role="alert" className="estado-problema col-span-2 text-sm text-[var(--estado-tinta)]">
              {estado.error}
            </p>
          )}
        </form>
      )}
    </article>
  );
}
