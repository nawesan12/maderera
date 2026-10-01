"use client";

import { Suspense } from "react";
import Link from "next/link";
import { Tag } from "lucide-react";
import { useEstado } from "@/lib/estado-context";

/**
 * "Si comprás por tu cuenta, entrá para ver tu precio."
 *
 * Sale de una respuesta textual del brief: *"a los clientes
 * mayoristas/gremio/constructoras debería aclarárseles que deben entrar con un
 * usuario para que les muestre su precio especial"*.
 *
 * El problema que resuelve es concreto y costaba ventas: un profesional con
 * lista propia que entra sin sesión ve el precio de público, lo compara con el
 * de otro corralón y se va. El precio diferenciado existía y funcionaba desde
 * la octava pasada, pero nada en la pantalla decía que estuviera ahí.
 *
 * **Solo se muestra a quien no inició sesión.** A alguien que ya está adentro
 * y ve su lista, este cartel le diría algo falso.
 *
 * El cartel queda en la página armada de antemano —que es lo correcto para el
 * 95 % de las visitas, de gente sin cuenta— y, para quien entró, el servidor lo
 * retira en la misma respuesta (`useEstado`). Antes lo decidía el navegador
 * mirando la señal, que se prende también con solo agregar algo al carrito:
 * a quien había agregado algo sin cuenta se le escondía justo el cartel que le
 * decía que podía tenerla.
 */
export function AvisoGremio({ className = "" }: { className?: string }) {
  return (
    <Suspense fallback={<Cartel className={className} />}>
      <CartelParaQuienMira className={className} />
    </Suspense>
  );
}

function CartelParaQuienMira({ className }: { className: string }) {
  const { sesion } = useEstado();
  if (sesion) return null;
  return <Cartel className={className} />;
}

function Cartel({ className }: { className: string }) {
  return (
    <aside
      /* El margen viene de afuera y no de un div que lo envuelva: cuando el
         cartel se retira tiene que irse también su espacio. */
      className={`rounded-[14px] border border-linea bg-chip px-5 py-4 ${className}`}
    >
      <p className="flex items-start gap-2.5 text-sm leading-[1.45] text-texto-2">
        <span className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-naranja-claro text-acento-texto">
          <Tag className="h-3.5 w-3.5" />
        </span>
        <span>
          <strong className="font-semibold text-foreground">
            ¿Comprás para tu obra o tu taller?
          </strong>{" "}
          Estos son los precios de público. Si tenés cuenta,{" "}
          <Link href="/ingresar" className="font-semibold text-acento-texto underline underline-offset-2">
            entrá
          </Link>{" "}
          para ver tu lista y tus precios sin IVA. Si todavía no la tenés,{" "}
          <Link href="/profesionales" className="font-semibold text-acento-texto underline underline-offset-2">
            pedila acá
          </Link>
          .
        </span>
      </p>
    </aside>
  );
}
