import type { Metadata } from "next";
import Link from "next/link";
import { Star } from "lucide-react";
import { productosQuePuedoResenar } from "@/lib/dal/resenas";
import { unaPorProducto } from "@/lib/cuenta/portal";
import { FormularioResena } from "./formulario";

export const metadata: Metadata = {
  title: "Mis reseñas",
  robots: { index: false, follow: false },
};

/**
 * Reseñar lo que se compró.
 *
 * La lista sale de los pedidos entregados del cliente. Si no hay ninguno, no
 * hay nada que reseñar y la pantalla lo dice en vez de mostrar un formulario
 * vacío que no se puede completar.
 */
export default async function MisResenasPage() {
  // Una tarjeta por producto, en el orden en que llegan: al publicar, la
  // tarjeta se queda en su lugar como «Enviada» (H391).
  const items = unaPorProducto(await productosQuePuedoResenar());

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[26px] font-bold tracking-[-0.02em]">Reseñas</h1>
        <p className="mt-1 text-[15px] text-texto-2">
          Contá qué te pareció lo que compraste. Publicamos las reseñas después
          de leerlas.
        </p>
      </div>

      {items.length === 0 && (
        <div className="rounded-[14px] superficie p-10 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-[14px] bg-chip">
            <Star className="h-6 w-6 text-texto-3" />
          </div>
          <h2 className="text-lg font-bold">Todavía no hay nada que reseñar</h2>
          <p className="mt-1.5 text-[15px] text-texto-2">
            Vas a poder reseñar los productos de tus pedidos cuando los recibas.
          </p>
          <Link
            href="/catalogo"
            className="mt-5 inline-block rounded-[10px] bg-accion px-5 py-2.5 text-[15px] font-semibold text-white transition-colors hover:bg-accion-hover"
          >
            Ver el catálogo
          </Link>
        </div>
      )}

      {items.length > 0 && (
        <ul className="space-y-2.5">
          {items.map((item) => (
            <li key={item.productId}>
              {item.yaResenado ? (
                <p className="flex items-center justify-between gap-3 rounded-[12px] bg-hundida px-4 py-3 text-[15px] text-texto-2">
                  <span className="min-w-0">{item.nombre}</span>
                  <span className="estado-ok shrink-0 rounded-full bg-[var(--estado-fondo)] px-2.5 py-0.5 text-sm font-medium text-[var(--estado-tinta)]">
                    Enviada
                  </span>
                </p>
              ) : (
                <FormularioResena item={item} />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
