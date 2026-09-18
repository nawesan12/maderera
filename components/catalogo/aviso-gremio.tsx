"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { Tag } from "lucide-react";
import { haySenal } from "@/lib/senal-navegador";

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
 * Esa condición la resuelve el navegador y no el servidor, a propósito: era la
 * última cosa que obligaba al catálogo a leer la sesión, y por una decisión
 * cosmética el sitio entero se armaba de nuevo en cada visita. El cartel sale
 * en el HTML —que es lo correcto para el 95 % de las visitas, que son de gente
 * sin cuenta— y se retira solo cuando hay señal de sesión. Ver
 * `lib/senal-navegador.ts`.
 */
/** La cookie no avisa cuando cambia: se lee, no se escucha. */
const sinSuscripcion = () => () => {};

export function AvisoGremio({ className = "" }: { className?: string }) {
  /*
   * `useSyncExternalStore` y no un efecto con `useState`.
   *
   * Es la forma que React tiene para esto: el valor del servidor —el segundo
   * argumento— es el que se usa al hidratar, así que el HTML coincide, y el
   * real se lee inmediatamente después sin pasar por un render intermedio con
   * el valor equivocado.
   */
  const conCuenta = useSyncExternalStore(
    sinSuscripcion,
    haySenal,
    () => false,
  );

  if (conCuenta) return null;

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
