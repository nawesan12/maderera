"use client";

import { useEffect, useId, useState } from "react";
import { ImageOff, ImagePlus } from "lucide-react";

/**
 * Elegir una imagen para un formulario del panel.
 *
 * El `<input type="file">` nativo decía «Choose File · No file chosen» en
 * inglés y, con su ancho fijo, corría la página 22 px de costado a 375
 * (mes simulado, M2S4-024). Queda escondido detrás de un botón propio, y al
 * lado se ve la imagen: la que se acaba de elegir o la que ya tenía.
 *
 * Si la que ya tenía no se encuentra (un banner con una foto que se borró del
 * disco daba 404, M2S1-133), en su lugar va el ícono de imagen rota: se ve
 * que falta sin abrir el sitio.
 */
export function ElegirImagen({
  nombre,
  etiqueta,
  actual,
  forma = "ancha",
}: {
  nombre: string;
  etiqueta: string;
  /** La URL de la imagen que ya tiene, si tiene. */
  actual: string | null;
  /** «ancha» para un fondo de banner, «logo» para la marca de un banco. */
  forma?: "ancha" | "logo";
}) {
  const id = useId();
  const [elegida, setElegida] = useState<{ url: string; nombre: string } | null>(null);
  const [rota, setRota] = useState(false);

  useEffect(() => () => {
    if (elegida) URL.revokeObjectURL(elegida.url);
  }, [elegida]);

  const vista = elegida?.url ?? actual;
  const caja = forma === "logo" ? "h-12 w-28" : "h-[72px] w-full max-w-[220px]";

  return (
    <div>
      <p className="block text-base font-medium" id={`${id}-etiqueta`}>
        {etiqueta}
      </p>
      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-3">
        {vista && (!rota || elegida) ? (
          // Una vista previa local (blob:) no pasa por el optimizador de Next.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={vista}
            alt=""
            onError={() => setRota(true)}
            // Si falló antes de hidratar, el onError ya pasó y nadie lo
            // escuchó: se veía el ícono roto del navegador (mes 23). Al
            // montarla se mira si terminó de cargar sin nada.
            ref={(img) => {
              if (img && !elegida && img.complete && img.naturalWidth === 0) setRota(true);
            }}
            className={`${caja} rounded-lg bg-muted ${forma === "logo" ? "object-contain" : "object-cover"}`}
          />
        ) : actual ? (
          <span
            className={`${caja} flex items-center justify-center gap-2 rounded-lg bg-muted text-sm text-destructive`}
          >
            <ImageOff className="h-5 w-5 shrink-0" aria-hidden />
            No se encuentra
          </span>
        ) : null}
        <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border px-3.5 text-base font-medium transition-colors hover:bg-muted focus-within:ring-2 focus-within:ring-ring">
          <ImagePlus className="h-4 w-4" aria-hidden />
          {vista ? "Cambiar" : "Elegir imagen"}
          <input
            type="file"
            name={nombre}
            aria-labelledby={`${id}-etiqueta`}
            accept="image/jpeg,image/png,image/webp,image/avif"
            className="sr-only"
            onChange={(e) => {
              const archivo = e.currentTarget.files?.[0];
              setElegida(archivo ? { url: URL.createObjectURL(archivo), nombre: archivo.name } : null);
            }}
          />
        </label>
        {elegida && (
          <span className="min-w-0 max-w-full truncate text-sm text-muted-foreground">
            {elegida.nombre}
          </span>
        )}
      </div>
    </div>
  );
}
