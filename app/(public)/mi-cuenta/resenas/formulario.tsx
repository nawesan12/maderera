"use client";

import { useActionState, useState } from "react";
import { AlertCircle, Check, Loader2, Star } from "lucide-react";
import type { ProductoResenable } from "@/lib/dal/resenas";
import {
  dejarResena,
  type EstadoResena,
} from "../resenas-actions";

const inicial: EstadoResena = {};

/**
 * Dejar una reseña de algo que se compró.
 *
 * Solo aparecen los productos de pedidos ya entregados: es lo que separa una
 * reseña de un formulario de comentarios. Los ya reseñados quedan a la vista en
 * gris en vez de desaparecer, porque "escribí una reseña y no está" es peor que
 * verla esperando revisión.
 */
export function FormularioResena({ item }: { item: ProductoResenable }) {
  const [estado, enviar, enviando] = useActionState(dejarResena, inicial);
  const [estrellas, setEstrellas] = useState(5);
  const [encima, setEncima] = useState(0);

  if (estado.ok) {
    return (
      <div className="rounded-[14px] border border-linea bg-card p-5">
        <p className="flex items-center gap-2 text-[15px] font-semibold">
          <Check className="h-4 w-4 text-brand-green" />
          {item.nombre}
        </p>
        <p className="mt-1 text-[15px] text-texto-2">{estado.ok}</p>
      </div>
    );
  }

  return (
    <form action={enviar} className="rounded-[14px] border border-linea bg-card p-5">
      <input type="hidden" name="productId" value={item.productId} />
      <input type="hidden" name="orderId" value={item.orderId} />
      <input type="hidden" name="estrellas" value={estrellas} />

      <p className="text-[15px] font-semibold">{item.nombre}</p>
      <p className="mt-0.5 text-sm text-texto-3">Pedido {item.numeroPedido}</p>

      <div
        className="mt-3 flex items-center gap-1"
        onMouseLeave={() => setEncima(0)}
      >
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setEstrellas(n)}
            onMouseEnter={() => setEncima(n)}
            aria-label={`${n} ${n === 1 ? "estrella" : "estrellas"}`}
            aria-pressed={estrellas === n}
            className="p-0.5"
          >
            <Star
              className={`h-6 w-6 transition-colors ${
                n <= (encima || estrellas)
                  ? "fill-brand-orange text-brand-orange"
                  : "text-texto-3"
              }`}
            />
          </button>
        ))}
      </div>

      <label htmlFor={`texto-${item.productId}`} className="sr-only">
        Qué te pareció
      </label>
      <textarea
        id={`texto-${item.productId}`}
        name="texto"
        rows={3}
        maxLength={1000}
        placeholder="¿Qué te pareció? Cómo llegó, si era lo que esperabas…"
        className="mt-3 w-full rounded-[10px] border border-linea bg-background px-3 py-2 text-[15px]"
      />

      {estado.error && (
        <p className="mt-2 flex items-start gap-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {estado.error}
        </p>
      )}

      <button
        type="submit"
        disabled={enviando}
        className="mt-3 inline-flex h-11 items-center gap-2 rounded-[10px] bg-accion px-5 text-[15px] font-semibold text-white transition-colors hover:bg-accion-hover disabled:opacity-60"
      >
        {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
        Publicar reseña
      </button>
    </form>
  );
}
