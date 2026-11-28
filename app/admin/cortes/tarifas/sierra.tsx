"use client";

import { useActionState, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { guardarSierra, type EstadoTarifa } from "./actions";

const inicial: EstadoTarifa = {};

export function EditorDeSierra({ anchoSierraMm }: { anchoSierraMm: number }) {
  const [estado, guardar, guardando] = useActionState(guardarSierra, inicial);
  // Guardado, con el aviso de todo el panel: el renglón gris al lado del
  // botón no se veía (tercera prueba del mes).
  const inicialTexto = String(anchoSierraMm).replace(".", ",");
  const [valor, setValor] = useState(inicialTexto);
  const [base, setBase] = useState(inicialTexto);
  useEffect(() => {
    if (estado.ok) {
      toast.success(estado.ok);
      setBase(valor);
    }
    // Solo cuando llega la respuesta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <form action={guardar} className="flex flex-wrap items-end gap-3 tarjeta p-5">
      <div>
        <label htmlFor="ancho-sierra" className="block text-base font-medium">
          Ancho de sierra (mm)
        </label>
        <input
          id="ancho-sierra"
          name="anchoSierraMm"
          inputMode="decimal"
          required
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          className="tabular mt-1 h-10 w-32 rounded-lg border bg-background px-3 text-base"
        />
      </div>
      {/* Como las tarifas: el botón, solo con algo para guardar (M4-012). */}
      {valor !== base && (
        <button
          type="submit"
          disabled={guardando}
          className="boton-accion inline-flex h-10 items-center gap-2 rounded-lg px-4 text-base font-medium disabled:opacity-60"
        >
          {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
          Guardar
        </button>
      )}
      {estado.error && <p className="w-full text-base text-destructive">{estado.error}</p>}
    </form>
  );
}
