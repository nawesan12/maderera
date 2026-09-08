import type { Metadata } from "next";
import Link from "next/link";
import { Star } from "lucide-react";
import { productosQuePuedoResenar } from "@/lib/dal/resenas";
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
  const items = await productosQuePuedoResenar();

  const pendientes = items.filter((i) => !i.yaResenado);
  const hechas = items.filter((i) => i.yaResenado);

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
        <div className="rounded-[14px] border border-linea bg-card p-10 text-center">
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

      {pendientes.map((item) => (
        <FormularioResena
          key={`${item.orderId}:${item.productId}`}
          item={item}
        />
      ))}

      {hechas.length > 0 && (
        <section>
          <h2 className="mb-2.5 text-[11.5px] font-bold uppercase tracking-[0.11em] text-texto-3">
            Ya reseñaste
          </h2>
          <ul className="space-y-2">
            {hechas.map((item) => (
              <li
                key={`${item.orderId}:${item.productId}`}
                className="rounded-[12px] border border-linea bg-chip px-4 py-3 text-[15px] text-texto-2"
              >
                {item.nombre}
                <span className="block text-sm text-texto-3">
                  Pedido {item.numeroPedido}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
