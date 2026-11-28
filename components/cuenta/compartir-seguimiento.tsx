"use client";

import { useState } from "react";
import { Check, Share2 } from "lucide-react";

/**
 * El enlace de seguimiento del pedido, para mandárselo a quien retira o
 * recibe en la obra (mes simulado, M2S1-109): solo venía en el correo de la
 * compra. Con el menú de compartir del teléfono, o copiado si no hay.
 */
export function CompartirSeguimiento({ numero, token }: { numero: string; token: string }) {
  const [copiado, setCopiado] = useState(false);

  async function compartir() {
    const url = `${window.location.origin}/pedido/${encodeURIComponent(numero)}?t=${encodeURIComponent(token)}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: `Pedido ${numero}`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Cancelado o sin permiso: no hay nada que avisar.
    }
  }

  return (
    <button
      type="button"
      onClick={compartir}
      className="inline-flex h-11 items-center gap-2 rounded-lg border bg-card px-4 text-base font-medium transition-colors hover:bg-hundida"
    >
      {copiado ? <Check className="h-4 w-4 text-brand-green" /> : <Share2 className="h-4 w-4" />}
      {copiado ? "Enlace copiado" : "Compartir seguimiento"}
    </button>
  );
}
