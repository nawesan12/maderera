import Link from "next/link";
import { Tag } from "lucide-react";

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
 */
export function AvisoGremio() {
  return (
    <aside className="rounded-[14px] border border-linea bg-chip px-5 py-4">
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
