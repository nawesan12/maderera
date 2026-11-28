"use client";

import { useState, useTransition } from "react";
import { Landmark, Loader2 } from "lucide-react";
import { formatearImporte, importeDelCampo, importeIlegible, importeParaElCampo } from "@/lib/formato";
import { depositarDeLaCajaFuerte } from "./actions";

/**
 * Lo que tiene la caja fuerte de la sucursal y el depósito en el banco.
 *
 * La caja fuerte solo sumaba lo que le llegaba de los cajones y ninguna
 * pantalla decía cuánto había (mes simulado, M3S1-005). El depósito es lo
 * único que la vacía: sale con su asiento (Banco a Caja) en el cierre.
 */
export function CajaFuerte({ branchId, saldo }: { branchId: string; saldo: number }) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState("");
  const [clave, setClave] = useState(() => crypto.randomUUID());
  const [aviso, setAviso] = useState<string | null>(null);
  const [enCurso, empezar] = useTransition();

  if (saldo <= 0 && !aviso) return null;

  const monto = importeDelCampo(texto);
  const puede = !enCurso && !importeIlegible(texto) && monto > 0 && monto <= saldo + 0.005;

  function depositar() {
    if (!puede) return;
    empezar(async () => {
      const r = await depositarDeLaCajaFuerte(branchId, monto, clave);
      setAviso(r.error ?? r.ok ?? null);
      if (!r.error) {
        setAbierto(false);
        setTexto("");
        setClave(crypto.randomUUID());
      }
    });
  }

  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="inline-flex items-baseline gap-2 text-sm text-muted-foreground">
        Caja fuerte
        <span className="tabular text-base font-semibold text-foreground">{formatearImporte(saldo)}</span>
      </span>
      {abierto ? (
        <span className="flex items-center gap-2">
          <input
            type="text"
            inputMode="decimal"
            autoFocus
            value={texto}
            aria-label="Cuánto va al banco"
            aria-invalid={importeIlegible(texto) || monto > saldo + 0.005 || undefined}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") depositar();
              if (e.key === "Escape") setAbierto(false);
            }}
            className="tabular h-10 w-32 rounded-lg border border-linea bg-background px-2.5 text-right text-base"
          />
          <button
            type="button"
            disabled={!puede}
            onClick={depositar}
            className="boton-accion inline-flex h-10 items-center gap-1.5 rounded-lg px-3.5 text-sm font-semibold disabled:opacity-50"
          >
            {enCurso && <Loader2 className="h-4 w-4 animate-spin" />}
            Depositar
          </button>
        </span>
      ) : (
        saldo > 0 && (
          <button
            type="button"
            onClick={() => {
              setTexto(importeParaElCampo(saldo));
              setAviso(null);
              setAbierto(true);
            }}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-hundida hover:text-foreground"
          >
            <Landmark className="h-4 w-4" />
            Al banco
          </button>
        )
      )}
      {aviso && <span className="text-sm text-muted-foreground">{aviso}</span>}
    </div>
  );
}
