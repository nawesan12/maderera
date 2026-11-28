"use client";

import { useState } from "react";
import { cargarSaldoDelBanco } from "@/app/admin/banco-actions";
import { CampoImporte } from "@/components/admin/campo-importe";
import { useAccionDeDialogo } from "@/components/admin/usar-accion";
import { importeIlegible } from "@/lib/formato";

/**
 * El saldo del banco, desde la misma tarjeta «Plata hoy» (mes simulado,
 * M2S1-027): el primer día el banco arrancaba en cero y no había dónde
 * decirle cuánto había. Plegado es un renglón que se toca; abierto, el
 * importe y Guardar en la misma línea.
 *
 * Va encima del enlace que cubre la tarjeta (`relative z-10`): sin eso, el
 * toque abría la caja.
 */
export function SaldoDelBanco({ cargado }: { cargado: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const [monto, setMonto] = useState("");
  const [, accion, guardando] = useAccionDeDialogo(cargarSaldoDelBanco, {}, () => {
    setAbierto(false);
    setMonto("");
  });

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="relative z-10 min-h-11 text-left text-base underline decoration-current/30 underline-offset-4 hover:decoration-current"
      >
        {cargado ? "Corregir el saldo del banco" : "Cargar el saldo del banco"}
      </button>
    );
  }
  return (
    <form action={accion} className="relative z-10 flex flex-wrap items-center gap-2 pt-1">
      <label className="sr-only" htmlFor="saldo-del-banco">
        Saldo del banco
      </label>
      <span className="relative min-w-0 flex-1 basis-40">
        <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-texto-3">
          $
        </span>
        <CampoImporte
          id="saldo-del-banco"
          name="monto"
          valor={monto}
          alCambiar={setMonto}
          autoFocus
          placeholder="Saldo del banco"
          className="tabular h-11 w-full rounded-lg bg-hundida pl-7 pr-3 text-base text-foreground"
          onKeyDown={(e) => {
            if (e.key === "Escape") setAbierto(false);
          }}
        />
      </span>
      <button
        type="submit"
        disabled={guardando || !monto.trim() || importeIlegible(monto)}
        className="boton-accion inline-flex h-11 shrink-0 items-center rounded-lg px-4 text-base font-medium"
      >
        {guardando ? "Guardando…" : "Guardar"}
      </button>
    </form>
  );
}
