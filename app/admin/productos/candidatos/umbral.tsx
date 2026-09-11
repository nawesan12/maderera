"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cambiarMesesSinVender } from "./actions";

/**
 * Desde cuántos meses sin venta se señala un producto.
 *
 * Es el «parámetro» que pidió la clienta. No dispara nada solo: cambia a
 * quiénes muestra esta lista, que después alguien revisa. Se guarda al
 * confirmar y no al tipear, porque cada cambio vuelve a consultar el catálogo
 * entero.
 */
export function UmbralDeBaja({ meses }: { meses: number }) {
  const router = useRouter();
  const [valor, setValor] = useState(String(meses));
  const [guardando, empezar] = useTransition();

  const cambio = Number(valor) !== meses;

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        empezar(async () => {
          const r = await cambiarMesesSinVender(Number(valor));
          if (r.error) {
            toast.error(r.error);
            setValor(String(meses));
          } else {
            toast.success(r.ok);
            router.refresh();
          }
        });
      }}
    >
      <label className="flex items-center gap-2 text-base">
        <span className="text-muted-foreground">Sin ventas hace</span>
        <input
          type="number"
          min={1}
          max={60}
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          aria-label="Meses sin ventas para señalar un producto"
          className="tabular h-11 w-20 rounded-lg border border-linea bg-card px-3 text-right text-base"
        />
        <span className="text-muted-foreground">meses</span>
      </label>

      {cambio && (
        <button
          type="submit"
          disabled={guardando}
          className="boton-accion inline-flex h-11 items-center gap-2 rounded-lg px-4 text-base font-medium disabled:opacity-60"
        >
          {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
          Aplicar
        </button>
      )}
    </form>
  );
}
