"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { formatearMonto } from "@/lib/formato";
import { guardarFondoBase } from "./actions";

/**
 * El cambio que tiene que quedar en el cajón de cada sucursal.
 *
 * Lo pidió la clienta: «la caja tiene que tener un monto base para empezar a
 * cobrar, siempre se les deja cambio a los mostradores, no puede quedar menos
 * que la base». Con este número cargado, el mostrador propone abrir con él,
 * **rechaza el retiro que dejaría el cajón por debajo** y avisa al cerrar si
 * mañana se arranca sin cambio.
 *
 * Cero apaga el control, que es como arranca hasta que cada sucursal fije el
 * suyo: un piso inventado sería peor que ninguno.
 */
export function FondoBase({
  branchId,
  valor,
}: {
  branchId: string;
  valor: number;
}) {
  const [texto, setTexto] = useState(valor ? String(valor) : "");
  const [guardando, empezar] = useTransition();
  const [aviso, setAviso] = useState<string | null>(null);

  const cambio = Number(texto || 0) !== valor;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        Cambio fijo
        <input
          type="number"
          min="0"
          step="0.01"
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
            setAviso(null);
          }}
          placeholder="0"
          aria-label={`Cambio fijo de la sucursal`}
          className="tabular h-10 w-32 rounded-lg border border-linea bg-background px-2.5 text-right text-base"
        />
      </label>

      {cambio && (
        <button
          type="button"
          disabled={guardando}
          onClick={() =>
            empezar(async () => {
              const r = await guardarFondoBase(branchId, Number(texto || 0));
              setAviso(r.error ?? r.ok ?? null);
            })
          }
          className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-brand-orange px-3.5 text-sm font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
        >
          {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
          Guardar
        </button>
      )}

      {aviso ? (
        <span className="text-sm text-muted-foreground">{aviso}</span>
      ) : (
        valor > 0 && (
          <span className="text-sm text-muted-foreground">
            No se puede retirar por debajo de {formatearMonto(valor)}.
          </span>
        )
      )}
    </div>
  );
}
