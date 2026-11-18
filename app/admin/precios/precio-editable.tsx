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
  rotulo,
  tactil = false,
}: {
  variantId: string;
  priceListId: string;
  valor: string;
  /** De qué lista es («Lista», «Profesional»): va en lo que lee el lector de pantalla. */
  rotulo?: string;
  /**
   * En el teléfono se toca con el dedo: 44 px de alto como mínimo, o se
   * abre el precio de al lado. Un precio mal cargado es plata perdida.
   */
  tactil?: boolean;
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

  const alto = tactil ? "min-h-11 py-2" : "py-1";
  const de = rotulo ? ` de ${rotulo.toLowerCase()}` : "";

  if (!editando) {
    return (
      <button
        onClick={() => {
          setTexto(valor);
          setEditando(true);
        }}
        className={`tabular w-full whitespace-nowrap rounded-md px-2 ${alto} text-right text-base transition-colors hover:bg-muted`}
        aria-label={`Editar precio${de}, actualmente ${formateado}`}
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
      /* Acá Enter guarda el precio y cierra la edición: no tiene que avanzar
         al campo siguiente como en el resto del panel. Ver
         `components/admin/enter-avanza.tsx`. */
      data-enter="enviar"
      className={`tabular w-full rounded-md border border-brand-orange bg-card px-2 ${alto} text-right text-base outline-none`}
      aria-label={`Nuevo precio${de}`}
    />
  );
}
