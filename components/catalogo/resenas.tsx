import Link from "next/link";
import { Star } from "lucide-react";
import type { ResenaPublicada, ResumenDeResenas } from "@/lib/dal/resenas";

/**
 * Las reseñas de un producto.
 *
 * Todas son de compra verificada: solo puede escribir una quien compró y
 * recibió. Se dice en la pantalla porque es la diferencia entre esto y un
 * campo de comentarios, y es lo que hace que la opinión valga algo.
 *
 * Sin reseñas la sección invita a dejar la primera en vez de mostrar un cero.
 */
export function ResenasDelProducto({
  resenas,
  resumen,
}: {
  resenas: ResenaPublicada[];
  resumen: ResumenDeResenas | null;
}) {
  return (
    <section className="mt-11">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Opiniones</h2>
          <p className="mt-0.5 text-sm text-texto-2">
            Solo de quien compró el producto y ya lo recibió.
          </p>
        </div>

        {resumen && (
          <p className="flex items-center gap-2">
            <Estrellas cantidad={resumen.promedio} />
            <span className="tabular text-[15px] font-semibold">
              {resumen.promedio.toFixed(1)}
            </span>
            <span className="text-sm text-texto-3">
              ({resumen.cantidad}{" "}
              {resumen.cantidad === 1 ? "opinión" : "opiniones"})
            </span>
          </p>
        )}
      </div>

      {resenas.length === 0 ? (
        <div className="rounded-[14px] border border-linea bg-card p-8 text-center">
          <p className="text-[15px] text-texto-2">
            Todavía nadie opinó sobre este producto.
          </p>
          <p className="mt-1 text-sm text-texto-3">
            Si ya lo compraste, contanos qué te pareció desde{" "}
            <Link
              href="/mi-cuenta/resenas"
              className="font-semibold text-acento-texto"
            >
              tu cuenta
            </Link>
            .
          </p>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {resenas.map((r) => (
            <li
              key={r.id}
              className="rounded-[14px] border border-linea bg-card p-5"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-[15px] font-semibold">{r.nombre}</span>
                <Estrellas cantidad={r.estrellas} />
              </div>
              <p className="mt-1 text-sm text-texto-3">
                Compra verificada ·{" "}
                {r.fecha.toLocaleDateString("es-AR", {
                  month: "long",
                  year: "numeric",
                })}
              </p>
              {r.texto && (
                <p className="mt-2.5 text-[15px] leading-relaxed text-texto-2">
                  {r.texto}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Estrellas({ cantidad }: { cantidad: number }) {
  return (
    <span
      className="flex items-center gap-0.5"
      aria-label={`${cantidad} de 5 estrellas`}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          aria-hidden="true"
          className={`h-4 w-4 ${
            n <= Math.round(cantidad)
              ? "fill-brand-orange text-brand-orange"
              : "text-linea"
          }`}
        />
      ))}
    </span>
  );
}
