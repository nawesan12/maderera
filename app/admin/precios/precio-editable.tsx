"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { editarPrecio } from "./actions";

/**
 * Precio editable en la propia tabla.
 *
 * Se edita donde se lee: abrir una ficha para cambiar un número, cuando hay
 * cuarenta por revisar, es lo que hace que nadie mantenga la lista al día.
 * Enter guarda, Escape cancela.
 */
export function PrecioEditable({
  variantId,
  priceListId,
  valor,
}: {
  variantId: string;
  priceListId: string;
  valor: string;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(valor);
  const [guardando, startTransition] = useTransition();

  const formateado = new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(Number(valor));

  function guardar() {
    const limpio = texto.replace(/\./g, "").replace(",", ".");

    if (Number(limpio) === Number(valor)) {
      setEditando(false);
      return;
    }

    if (!Number.isFinite(Number(limpio)) || Number(limpio) < 0) {
      toast.error("Ese precio no es válido.");
      setTexto(valor);
      setEditando(false);
      return;
    }

    startTransition(async () => {
      const datos = new FormData();
      datos.set("variantId", variantId);
      datos.set("priceListId", priceListId);
      datos.set("precio", limpio);

      const resultado = await editarPrecio({}, datos);

      if (resultado.error) {
        toast.error(resultado.error);
        setTexto(valor);
      } else {
        toast.success(resultado.ok ?? "Precio actualizado.");
        router.refresh();
      }
      setEditando(false);
    });
  }

  if (!editando) {
    return (
      <button
        onClick={() => {
          setTexto(valor);
          setEditando(true);
        }}
        className="tabular w-full rounded-md px-2 py-1 text-right text-base transition-colors hover:bg-muted"
        aria-label={`Editar precio, actualmente ${formateado}`}
      >
        {Number(valor) > 0 ? formateado : "—"}
      </button>
    );
  }

  return (
    <input
      autoFocus
      value={texto}
      disabled={guardando}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={guardar}
      onKeyDown={(e) => {
        if (e.key === "Enter") guardar();
        if (e.key === "Escape") {
          setTexto(valor);
          setEditando(false);
        }
      }}
      inputMode="decimal"
      className="tabular w-full rounded-md border border-brand-orange bg-card px-2 py-1 text-right text-base outline-none"
      aria-label="Nuevo precio"
    />
  );
}
