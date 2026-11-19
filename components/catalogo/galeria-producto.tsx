"use client";

import Image from "next/image";
import { useState } from "react";
import { PlacaDeProducto } from "@/components/catalogo/placa-de-producto";

/**
 * Galería de la ficha pública.
 *
 * Para comprar madera hace falta ver el material: la veta, el color real, la
 * terminación. Una sola foto chica no alcanza, y en una maderera es lo que más
 * define si alguien se decide o llama para preguntar.
 *
 * Sin «Destacado» sobre la foto (hallazgo 26): salió de la tarjeta porque lo
 * tenía un tercio del catálogo, y en la ficha quedaba una marca que la grilla
 * ya no mostraba. `featured` solo ordena.
 */
export function GaleriaProducto({
  imagenes,
  nombre,
  rubro,
  categoria,
  marca,
}: {
  imagenes: string[];
  nombre: string;
  /** Para la placa, cuando no hay foto: lo que se estampa y el tono. */
  rubro: string;
  categoria: string;
  marca?: string | null;
}) {
  const [activa, setActiva] = useState(0);

  // Sin foto, la placa del rubro (hallazgo 25): «Sin foto todavía» con un
  // ícono de imagen rota era lo primero que se veía de la ficha. Es una
  // imagen para el lector de pantalla, con el nombre del producto.
  if (imagenes.length === 0) {
    return (
      <div role="img" aria-label={nombre} className="relative aspect-[4/3] overflow-hidden rounded-2xl shadow-sm">
        <PlacaDeProducto rubro={rubro} categoria={categoria} marca={marca} tamano="ficha" />
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
