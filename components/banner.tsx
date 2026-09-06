import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { BannerPublicado } from "@/lib/dal/banners";

/**
 * Un aviso de promoción.
 *
 * **Dos tamaños, un solo diseño.** `alto` es el del carrusel de la portada:
 * ocupa lo que ocupa una promoción en una tienda, con la tipografía a escala.
 * `compacto` es la franja del catálogo, donde el protagonista tiene que seguir
 * siendo la grilla de productos.
 *
 * **El fondo sin foto no es un rectángulo naranja.** Es un degradado de marca
 * con la textura de grano que ya usa el resto del sitio: el equipo va a cargar
 * la mayoría de los avisos sin imagen —desde el celular, apurados— y ese caso
 * tiene que verse bien, no “aceptable”.
 *
 * **Con foto, el velo va en degradado y no parejo.** Un velo uniforme apaga la
 * foto entera; el degradado oscurece donde está el texto y deja la imagen
 * respirar del otro lado, que es como se ve una promoción de tienda de verdad.
 */
export function Banner({
  banner,
  alto = false,
  prioridad = false,
}: {
  banner: BannerPublicado;
  /** El tamaño del carrusel de la portada. */
  alto?: boolean;
  /** Solo para el primero del carrusel: es imagen visible al cargar. */
  prioridad?: boolean;
}) {
  const contenido = (
    <>
      {banner.imagenUrl ? (
        <>
          <Image
            src={banner.imagenUrl}
            alt=""
            fill
            sizes="(max-width: 1024px) 100vw, 1200px"
            className="object-cover transition-transform duration-700 group-hover/banner:scale-[1.03]"
            priority={prioridad}
          />
          {/* De izquierda a derecha: la columna del texto queda legible y la
              foto se ve del otro lado. En vertical el degradado va de abajo,
              que es donde el texto cae en un teléfono. */}
          <span
            aria-hidden
            className="absolute inset-0 bg-[linear-gradient(to_top,rgb(28_25_22_/_0.92)_0%,rgb(28_25_22_/_0.55)_55%,rgb(28_25_22_/_0.25)_100%)] sm:bg-[linear-gradient(to_right,rgb(28_25_22_/_0.92)_0%,rgb(28_25_22_/_0.7)_45%,rgb(28_25_22_/_0.15)_100%)]"
          />
        </>
      ) : (
        <>
          <span
            aria-hidden
            className="absolute inset-0 bg-[linear-gradient(115deg,oklch(0.42_0.07_58)_0%,oklch(0.52_0.13_45)_45%,oklch(0.68_0.19_48)_100%)]"
          />
          {/* La misma trama diagonal de marca que usan las secciones. */}
          <span aria-hidden className="stripe-pattern absolute inset-0 opacity-70" />
        </>
      )}

      {/* El grano va arriba de todo: es lo que saca el aspecto de bloque de
          color plano, que es lo que hace que un banner parezca sin terminar. */}
      <span aria-hidden className="grain-overlay absolute inset-0" />

      <span
        className={`relative flex flex-col items-start justify-end gap-3 ${
          alto
            // En pantalla grande deja lugar a las flechas del carrusel: sin
            // ese margen, la de la izquierda queda encima del título.
            ? "min-h-[300px] px-7 py-8 sm:min-h-[340px] sm:px-20 sm:py-10 lg:min-h-[380px]"
            : "px-6 py-6 sm:px-8"
        }`}
      >
        {banner.etiqueta && (
          <span className="inline-flex items-center rounded-full bg-white/15 px-3 py-1 text-[12px] font-semibold uppercase tracking-[0.09em] text-white backdrop-blur-sm">
            {banner.etiqueta}
          </span>
        )}

        <span className="max-w-[560px]">
          <span
            className={`block font-bold leading-[1.08] tracking-[-0.02em] text-white ${
              alto ? "text-[28px] sm:text-[38px] lg:text-[44px]" : "text-[20px] sm:text-[23px]"
            }`}
          >
            {banner.titulo}
          </span>

          {banner.bajada && (
            <span
              className={`mt-2 block leading-snug text-white/85 ${
                alto ? "text-[15.5px] sm:text-[17px]" : "text-[14.5px]"
              }`}
            >
              {banner.bajada}
            </span>
          )}
        </span>

        {banner.enlace && (
          <span
            className={`mt-1 inline-flex shrink-0 items-center gap-2 rounded-[10px] bg-white font-semibold text-[#2c2621] transition-transform group-hover/banner:translate-x-0.5 ${
              alto ? "h-12 px-6 text-[15.5px]" : "h-10 px-5 text-[14.5px]"
            }`}
          >
            {banner.textoEnlace || "Ver más"}
            <ArrowRight className="h-4 w-4" />
          </span>
        )}
      </span>
    </>
  );

  const clases =
    "group/banner relative block overflow-hidden rounded-[16px] bg-[#2c2621] isolate";

  if (!banner.enlace) return <div className={clases}>{contenido}</div>;

  return (
    <Link href={banner.enlace} className={clases}>
      {contenido}
    </Link>
  );
}

/**
 * La franja de arriba de todo.
 *
 * Es una línea sola y a propósito: va sobre el encabezado de **todas** las
 * páginas, así que cualquier cosa más alta empuja el catálogo fuera de la
 * pantalla en un teléfono. Si hay varios avisos cargados se muestra el
 * primero; apilarlos convertiría el encabezado en una cartelera.
 */
export function FranjaDeAviso({ banner }: { banner: BannerPublicado }) {
  const texto = (
    <>
      {banner.etiqueta && (
        <span className="mr-2 rounded-full bg-white/20 px-2 py-0.5 text-[11.5px] font-bold uppercase tracking-[0.06em]">
          {banner.etiqueta}
        </span>
      )}
      {banner.titulo}
      {banner.enlace && (
        <span className="ml-2 inline-flex items-center gap-1 font-semibold underline underline-offset-2">
          {banner.textoEnlace || "Ver"}
          <ArrowRight className="h-3.5 w-3.5" />
        </span>
      )}
    </>
  );

  const clases =
    "block bg-[linear-gradient(90deg,oklch(0.52_0.13_45)_0%,oklch(0.68_0.19_48)_100%)] px-4 py-2 text-center text-[13.5px] leading-snug text-white";

  if (!banner.enlace) return <div className={clases}>{texto}</div>;

  return (
    <Link href={banner.enlace} className={`${clases} transition-opacity hover:opacity-90`}>
      {texto}
    </Link>
  );
}
