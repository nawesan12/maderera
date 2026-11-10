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
  encendido: string;
  apagado: string;
  /** Lo que cambia para quien visita el sitio, dicho antes de apretar. */
  alEncender: string;
  alApagar: string;
}[] = [
  {
    clave: "tienda_activa",
    campo: "activa",
    titulo: "Tienda online",
    encendido: "Los precios se ven en el sitio y se puede comprar y pedir presupuesto con el carrito.",
    apagado:
      "El sitio muestra el catálogo sin precios. Cada producto y cada corte se consultan por WhatsApp.",
    alEncender:
      "Los precios, el carrito y la compra quedan a la vista de todo el que entre al sitio. Revisá antes que los precios estén cargados. Se puede volver a apagar.",
    alApagar:
      "El sitio deja de mostrar precios y nadie puede comprar ni armar un carrito. Los pedidos que ya entraron no cambian. Se puede volver a encender.",
  },
  {
    clave: "stock_visible",
    campo: "stockVisible",
    titulo: "Disponibilidad en el sitio",
    encendido: "Cada producto dice si hay en Casa Central o en el Aserradero, y se puede filtrar por stock.",
    apagado: "El sitio no dice si hay o no hay. Conviene dejarlo así hasta tener el stock cargado.",
    alEncender:
      "El sitio va a mostrar si hay stock de cada medida. Si el stock no está cargado, va a decir «sin stock» en todo. Se puede volver a apagar.",
    alApagar: "El sitio deja de mostrar la disponibilidad y el filtro por stock. Se puede volver a encender.",
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
      <p className="mt-0.5 text-base text-muted-foreground">
        Lo que el sitio muestra mientras se termina de cargar el inventario.
      </p>

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
                <p className="mt-0.5 text-base text-muted-foreground">{prendido ? i.encendido : i.apagado}</p>
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
