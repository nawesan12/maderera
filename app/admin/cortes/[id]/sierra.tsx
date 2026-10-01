"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { cambiarAnchoDeSierra } from "../actions";

/**
 * El disco del trabajo, editable mientras no pasó por la máquina.
 *
 * Al cambiarlo el servidor rehace el plano y guarda las placas y las pasadas
 * nuevas; la pantalla se refresca con el plano redibujado. Enter guarda.
 */
export function SierraDelTrabajo({
  id,
  anchoSierra,
  editable,
}: {
  id: string;
  anchoSierra: number;
  editable: boolean;
}) {
  const router = useRouter();
  const [texto, setTexto] = useState(String(anchoSierra).replace(".", ","));
  const [pendiente, empezar] = useTransition();
  const cambio = texto.replace(",", ".") !== String(anchoSierra);

  if (!editable) {
    return (
      <span>
        {` · la sierra se llevó ${String(anchoSierra).replace(".", ",")} mm por corte`}
      </span>
    );
  }

  function guardar() {
    empezar(async () => {
      const r = await cambiarAnchoDeSierra(id, texto);
      if (r.error) toast.error(r.error);
      else {
        toast.success(r.ok);
        router.refresh();
      }
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        guardar();
      }}
      className="mt-1.5 inline-flex flex-wrap items-center gap-2"
    >
      <span>La sierra se lleva</span>
      <input
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        inputMode="decimal"
        data-enter="enviar"
        aria-label="Ancho de la sierra de este trabajo, en milímetros"
        className="tabular h-9 w-20 rounded-lg border bg-background px-2.5 text-right text-base text-foreground"
      />
      <span>mm por corte</span>
      {cambio && (
        <button
          type="submit"
          disabled={pendiente}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
        >
          {pendiente && <Loader2 className="h-4 w-4 animate-spin" />}
          Rehacer el plano
        </button>
      )}
    </form>
  );
}
