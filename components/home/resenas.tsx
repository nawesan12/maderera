import { Star } from "lucide-react";
import type { ResenaDelNegocio } from "@/lib/google/resenas";

/**
 * Lo que dicen los clientes, en la portada.
 *
 * **Por qué está.** El brief decía que quien entra por primera vez tiene que
 * sentir «confianza y trayectoria», y hasta ahora eso lo sostenían el año de
 * fundación y poco más. Una reseña con nombre y fecha hace ese trabajo mejor que
 * cualquier frase que escribamos nosotros.
 *
 * **Sin JSON-LD, a propósito.** Marcar como propias reseñas que están publicadas
 * en Google va contra sus reglas de datos estructurados, y la penalización cae
 * sobre todo el sitio. Se muestran porque son verdad y porque sirven, no para
 * sacar estrellitas en el buscador.
 */
export function ResenasDelNegocio({
  resenas,
  resumen,
}: {
  resenas: ResenaDelNegocio[];
  resumen: { promedio: number; cuantas: number } | null;
}) {
  if (resenas.length === 0) return null;

  return (
    <section className="bg-sitio-alt py-14">
      <div className="contenedor">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-[26px] font-bold tracking-[-0.03em]">
              Lo que dicen los clientes
            </h2>
            {resumen && (
              <p className="mt-1 flex items-center gap-2 text-base text-texto-2">
                <span className="flex items-center gap-0.5 text-brand-orange">
                  {Array.from({ length: 5 }, (_, i) => (
                    <Star
                      key={i}
                      className={`h-4 w-4 ${
                        i < Math.round(resumen.promedio) ? "fill-current" : ""
                      }`}
                      aria-hidden
                    />
                  ))}
                </span>
                <span className="tabular font-semibold text-foreground">
                  {resumen.promedio.toLocaleString("es-AR", {
                    minimumFractionDigits: 1,
                  })}
                </span>
                sobre {resumen.cuantas}{" "}
                {resumen.cuantas === 1 ? "opinión" : "opiniones"}
              </p>
            )}
          </div>
        </div>

        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {resenas.slice(0, 6).map((resena) => (
            <li
              key={resena.id}
              className="flex flex-col rounded-2xl border border-linea bg-card px-5 py-[18px]"
            >
              <span
                className="flex items-center gap-0.5 text-brand-orange"
                aria-label={`${resena.estrellas} de 5 estrellas`}
              >
                {Array.from({ length: resena.estrellas }, (_, i) => (
                  <Star key={i} className="h-4 w-4 fill-current" aria-hidden />
                ))}
              </span>

              <p className="mt-2.5 text-[14.5px] leading-relaxed text-texto-2">
                {resena.texto}
              </p>

              <p className="mt-auto pt-3 text-[13.5px] font-semibold">
                {resena.autor}
                <span className="ml-2 font-normal text-texto-3">
                  {resena.fecha.toLocaleDateString("es-AR", {
                    month: "long",
                    year: "numeric",
                  })}
                </span>
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
