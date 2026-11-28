"use client";

import Image from "next/image";
import { useState } from "react";
import { MuestraDePlaca } from "@/components/catalogo/placa-de-producto";
import { useMedidaElegida } from "@/components/catalogo/medida-elegida";

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
  fotoDeMedida = {},
  nombre,
  categoria,
}: {
  imagenes: string[];
  /** Por id de medida, la posición de su foto en `imagenes`. */
  fotoDeMedida?: Record<string, number>;
  nombre: string;
  /** Para la placa, cuando no hay foto: el tono de la madera. */
  categoria: string;
}) {
  const [activa, setActiva] = useState(0);
  const medida = useMedidaElegida()?.id ?? null;
  const [medidaVista, setMedidaVista] = useState(medida);
  // Se ajusta al dibujar, no en un efecto: así no se pinta un cuadro con la
  // foto de la medida anterior.
  if (medida !== medidaVista) {
    setMedidaVista(medida);
    const indice = medida ? fotoDeMedida[medida] : undefined;
    if (indice !== undefined && indice < imagenes.length) setActiva(indice);
  }

  // Sin foto, la placa del rubro (hallazgo 25): «Sin foto todavía» con un
  // ícono de imagen rota era lo primero que se veía de la ficha. Es una
  // imagen para el lector de pantalla, con el nombre del producto.
  //
  // En la ficha, sin el rubro escrito (ya va arriba del nombre) y, en el
  // teléfono, un bloque bajo: la banda de media pantalla con «DECKS» bajaba
  // el nombre a la mitad de la primera pantalla (mes simulado, M2S4-055).
  if (imagenes.length === 0) {
    return (
      <div role="img" aria-label={nombre} className="relative -mx-6 h-20 overflow-hidden shadow-sm sm:mx-0 sm:rounded-2xl lg:h-auto lg:aspect-[4/3]">
        <MuestraDePlaca categoria={categoria} className="absolute inset-0" />
      </div>
    );
  }

  return (
    <div>
      <div className="relative -mx-6 aspect-[4/3] overflow-hidden bg-card sm:mx-0 sm:rounded-2xl sm:shadow-sm">
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
