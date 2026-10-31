"use client";

import Image from "next/image";
import { useState } from "react";
import { ImageOff } from "lucide-react";

/**
 * Galería de la ficha pública.
 *
 * Para comprar madera hace falta ver el material: la veta, el color real, la
 * terminación. Una sola foto chica no alcanza, y en una maderera es lo que más
 * define si alguien se decide o llama para preguntar.
 */
export function GaleriaProducto({
  imagenes,
  nombre,
  destacado = false,
}: {
  imagenes: string[];
  nombre: string;
  destacado?: boolean;
}) {
  const [activa, setActiva] = useState(0);

  if (imagenes.length === 0) {
    return (
      <div className="flex aspect-[4/3] items-center justify-center rounded-2xl bg-brand-wood-light/30">
        <span className="flex flex-col items-center gap-2 text-muted-foreground">
          <ImageOff className="h-8 w-8" />
          <span className="text-sm">Sin foto todavía</span>
        </span>
      </div>
    );
  }

  return (
    <div>
      <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-card shadow-sm">
        <Image
          src={imagenes[activa]}
          alt={`${nombre}${activa > 0 ? ` — foto ${activa + 1}` : ""}`}
          fill
          // Es lo más grande de la ficha y lo que Lighthouse mide como LCP.
          // `preload` la anuncia en el `<head>` y `fetchPriority` la pone
          // adelante de los scripts; con el `priority` de antes (deprecado en
          // Next 16) salía el preload pero no la prioridad.
          preload
          fetchPriority="high"
          loading="eager"
          className="object-cover"
          sizes="(max-width: 1024px) 100vw, 50vw"
        />
        {destacado && (
          <span className="absolute left-4 top-4 rounded-full bg-accion px-3 py-1 text-xs font-bold uppercase tracking-wider text-white">
            Destacado
          </span>
        )}
      </div>

      {imagenes.length > 1 && (
        <ul className="mt-3 flex gap-2.5 overflow-x-auto pb-1">
          {imagenes.map((url, i) => (
            <li key={url}>
              <button
                onClick={() => setActiva(i)}
                aria-label={`Ver foto ${i + 1} de ${imagenes.length}`}
                aria-current={i === activa}
                className={`relative block h-20 w-20 shrink-0 overflow-hidden rounded-lg transition-all ${
                  i === activa
                    ? "ring-2 ring-brand-orange ring-offset-2"
                    : "opacity-70 hover:opacity-100"
                }`}
              >
                <Image
                  src={url}
                  alt=""
                  fill
                  className="object-cover"
                  sizes="80px"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
