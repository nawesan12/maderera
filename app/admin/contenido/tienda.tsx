"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Store } from "lucide-react";
import { toast } from "sonner";
import { Confirmar } from "@/components/admin/confirmar";
import type { Tienda } from "@/lib/tienda";
import { cambiarInterruptor } from "./actions";

type Clave = "tienda_activa" | "stock_visible";

const INTERRUPTORES: {
  clave: Clave;
  campo: keyof Tienda;
  titulo: string;
  /** Lo que cambia para quien visita el sitio, dicho antes de apretar. */
  alEncender: string;
  alApagar: string;
}[] = [
  {
    clave: "tienda_activa",
    campo: "activa",
    titulo: "Tienda online",
    alEncender: "Los precios y el carrito quedan a la vista de todos.",
    alApagar: "El sitio deja de mostrar precios y de vender.",
  },
  {
    clave: "stock_visible",
    campo: "stockVisible",
    titulo: "Disponibilidad en el sitio",
    alEncender: "Con el stock sin cargar, el sitio va a decir «sin stock» en todo.",
    alApagar: "El sitio deja de mostrar si hay stock.",
  },
];

/**
 * Los dos interruptores de la tienda: lo primero de Contenido porque cambian
 * qué ve todo el mundo. La primera entrega va con los dos apagados.
 */
export function InterruptoresDeTienda({ tienda }: { tienda: Tienda }) {
  const router = useRouter();
  const [pendiente, empezar] = useTransition();
  const [preguntando, setPreguntando] = useState<(typeof INTERRUPTORES)[number] | null>(null);

  function cambiar(clave: Clave, encender: boolean) {
    empezar(async () => {
      const r = await cambiarInterruptor(clave, encender);
      if (r.error) toast.error(r.error);
      else if (r.ok) toast.success(r.ok);
      setPreguntando(null);
      router.refresh();
    });
  }

  const encendido = preguntando ? tienda[preguntando.campo] : false;

  return (
    <section className="tarjeta p-5">
      <h2 className="flex items-center gap-2 text-base font-medium">
        <Store className="h-5 w-5 text-muted-foreground" />
        Qué muestra el sitio
      </h2>
      <ul className="mt-4 divide-y divide-linea-tenue">
        {INTERRUPTORES.map((i) => {
          const prendido = tienda[i.campo];
          return (
            <li key={i.clave} className="flex flex-wrap items-center gap-4 py-3.5 first:pt-0 last:pb-0">
              <div className="min-w-[16rem] flex-1">
                <p className="flex flex-wrap items-center gap-2 text-base font-medium">
                  {i.titulo}
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-sm font-medium ${
                      prendido ? "bg-brand-green/15 text-brand-green" : "bg-hundida text-muted-foreground"
                    }`}
                  >
                    {prendido ? "Encendida" : "Apagada"}
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreguntando(i)}
                disabled={pendiente}
                className="inline-flex h-10 items-center gap-2 rounded-lg border px-4 text-base font-medium transition-colors hover:bg-muted disabled:opacity-60"
              >
                {prendido ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                {prendido ? "Apagar" : "Encender"}
              </button>
            </li>
          );
        })}
      </ul>

      {preguntando && (
        <Confirmar
          abierto
          alCerrar={() => setPreguntando(null)}
          titulo={`${encendido ? "Apagar" : "Encender"}: ${preguntando.titulo.toLowerCase()}`}
          detalle={encendido ? preguntando.alApagar : preguntando.alEncender}
          confirmar={encendido ? "Apagar" : "Encender"}
          pendiente={pendiente}
          alConfirmar={() => cambiar(preguntando.clave, !encendido)}
        />
      )}
    </section>
  );
}
