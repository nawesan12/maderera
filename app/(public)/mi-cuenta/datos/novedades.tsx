"use client";

import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { Megaphone } from "lucide-react";
import { cambiarNovedades } from "../actions";

/** El interruptor de las novedades por correo, en Mis datos. */
export function NovedadesPorCorreo({ recibe }: { recibe: boolean }) {
  const [valor, setValor] = useOptimistic(recibe);
  const [, empezar] = useTransition();

  function cambiar() {
    empezar(async () => {
      setValor(!valor);
      const r = await cambiarNovedades(!valor);
      if (r.error) toast.error(r.error);
      else toast.success(r.ok);
    });
  }

  return (
    <section className="flex items-start gap-3 rounded-xl border px-4 py-4">
      <Megaphone className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">Novedades y promociones por correo</p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Listas de precios nuevas, cuotas y eventos, cada tanto. Los avisos de tus pedidos y
          tus recibos te llegan igual.
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={valor}
        aria-label="Recibir novedades por correo"
        onClick={cambiar}
        className={`relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition-colors ${valor ? "bg-brand-orange" : "bg-hundida"}`}
      >
        <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-[left] ${valor ? "left-6" : "left-1"}`} />
      </button>
    </section>
  );
}
