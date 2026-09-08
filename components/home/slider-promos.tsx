"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { Banner } from "@/components/banner";
import type { BannerPublicado } from "@/lib/dal/banners";

/** Cuánto dura cada promoción en pantalla. */
const DURACION = 7000;

/**
 * El carrusel de promociones de la portada.
 *
 * **Es scroll nativo con anclaje, no una animación hecha a mano.** El
 * navegador ya sabe desplazarse con el dedo, con la rueda y con el teclado; una
 * implementación con `transform` gana un efecto y pierde las tres cosas. Las
 * flechas y los puntos solo empujan ese mismo scroll.
 *
 * **Avanza solo, y se nota cuánto falta.** La barra de progreso de cada punto
 * no es adorno: un carrusel que cambia sin aviso hace que alguien pierda de
 * vista lo que estaba leyendo. Viéndolo venir, no molesta.
 *
 * **Se detiene cuando alguien está mirando**: si el puntero está encima, si
 * algo adentro tiene el foco, si la pestaña no está visible, o si la persona
 * pidió menos animación en su sistema. Un banner que cambia justo cuando
 * alguien iba a hacer clic es de lo más molesto que puede hacer una tienda. Y
 * hay un botón para pararlo del todo, que es lo que pide la pauta de
 * accesibilidad para cualquier cosa que se mueva sola.
 *
 * Con un solo aviso no dibuja controles: sería un carrusel de uno.
 *
 * **El hero es el primer slide.** La clienta pidió que la portada abra con un
 * slider a todo el ancho, "cosa de que sea lo primero que se ve". Antes eran
 * dos bloques apilados: el hero a sangre y, más abajo y dentro del contenedor,
 * un carrusel de promociones que casi nadie llegaba a ver. Ahora la promoción
 * está donde mira la gente, y el hero sigue siendo lo primero.
 */
export function SliderDePromos({
  hero,
  banners,
}: {
  /** El hero, que entra como primer slide. */
  hero: React.ReactNode;
  banners: BannerPublicado[];
}) {
  /*
   * Una sola lista de slides: el hero y las promociones.
   *
   * Los controles cuentan sobre esta lista y no sobre `banners`, que es lo que
   * hace que los puntos, las flechas y el autoplay traten al hero como un
   * slide más en vez de como una excepción con la que hay que tener cuidado en
   * cinco lugares distintos.
   */
  const slides = [
    { clave: "hero", titulo: "Maderera Juan B. Justo", contenido: hero },
    ...banners.map((banner) => ({
      clave: banner.id,
      titulo: banner.titulo,
      contenido: <Banner banner={banner} alto />,
    })),
  ];
  const pista = useRef<HTMLDivElement>(null);
  const [actual, setActual] = useState(0);
  const [enPausa, setEnPausa] = useState(false);
  const [detenidoAMano, setDetenidoAMano] = useState(false);
  const [avance, setAvance] = useState(0);

  const varios = slides.length > 1;

  const irA = useCallback((indice: number) => {
    const contenedor = pista.current;
    if (!contenedor) return;

    const hijo = contenedor.children[indice] as HTMLElement | undefined;
    if (hijo) {
      contenedor.scrollTo({ left: hijo.offsetLeft - contenedor.offsetLeft });
    }
  }, []);

  const mover = useCallback(
    (paso: number) => {
      setActual((previo) => {
        const siguiente = (previo + paso + slides.length) % slides.length;
        irA(siguiente);
        return siguiente;
      });
      setAvance(0);
    },
    [slides.length, irA],
  );

  // Se detiene si la pestaña no está a la vista: sin esto vuelve al frente
  // seis promociones más adelante, sin que nadie haya visto ninguna.
  const [pestanaVisible, setPestanaVisible] = useState(true);
  useEffect(() => {
    const alCambiar = () => setPestanaVisible(!document.hidden);
    document.addEventListener("visibilitychange", alCambiar);
    return () => document.removeEventListener("visibilitychange", alCambiar);
  }, []);

  const corriendo =
    varios && !enPausa && !detenidoAMano && pestanaVisible;

  useEffect(() => {
    if (!corriendo) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // Un tic corto mueve la barra; al llegar al final, pasa de promoción. Un
    // solo intervalo hace las dos cosas y no pueden desincronizarse.
    const paso = 50;
    const reloj = setInterval(() => {
      setAvance((previo) => {
        const siguiente = previo + (paso / DURACION) * 100;
        if (siguiente >= 100) {
          mover(1);
          return 0;
        }
        return siguiente;
      });
    }, paso);

    return () => clearInterval(reloj);
  }, [corriendo, mover]);

  /** Qué banner quedó a la vista después de un desplazamiento con el dedo. */
  function alDesplazar() {
    const contenedor = pista.current;
    if (!contenedor) return;

    const ancho = contenedor.clientWidth;
    if (ancho === 0) return;

    const visible = Math.round(contenedor.scrollLeft / ancho);
    if (visible !== actual) {
      setActual(visible);
      setAvance(0);
    }
  }

  return (
    <section
      aria-roledescription="carrusel"
      aria-label="Promociones"
      className="relative"
      onMouseEnter={() => setEnPausa(true)}
      onMouseLeave={() => setEnPausa(false)}
      onFocusCapture={() => setEnPausa(true)}
      onBlurCapture={() => setEnPausa(false)}
      onKeyDown={(e) => {
        if (!varios) return;
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          mover(-1);
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          mover(1);
        }
      }}
    >
      <div
        ref={pista}
        onScroll={alDesplazar}
        className="flex snap-x snap-mandatory overflow-x-auto scroll-smooth [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {slides.map((slide, i) => (
          <div
            key={slide.clave}
            role="group"
            aria-roledescription="diapositiva"
            aria-label={`${i + 1} de ${slides.length}`}
            // El hero nunca se oculta a los lectores de pantalla: lleva el h1
            // de la página, y esconderlo cuando el carrusel avanza dejaría la
            // portada sin encabezado.
            aria-hidden={varios && i !== actual && slide.clave !== "hero"}
            // `[&>*]:h-full` empareja las alturas: el hero es más alto que un
            // banner, y sin esto los banners dejan una franja de fondo abajo
            // que hace saltar la página cada vez que el carrusel avanza.
            className="w-full shrink-0 snap-start [&>*]:h-full"
          >
            {slide.contenido}
          </div>
        ))}
      </div>

      {varios && (
        <>
          <Flecha lado="izquierda" onClick={() => mover(-1)} />
          <Flecha lado="derecha" onClick={() => mover(1)} />

          <div className="mt-3.5 flex items-center justify-center gap-2">
            {slides.map((slide, i) => (
              <button
                key={slide.clave}
                type="button"
                onClick={() => {
                  setActual(i);
                  irA(i);
                  setAvance(0);
                }}
                aria-label={`Ver "${slide.titulo}"`}
                aria-current={i === actual}
                className={`h-1.5 overflow-hidden rounded-full transition-all ${
                  i === actual ? "w-10 bg-linea" : "w-1.5 bg-linea hover:bg-texto-3"
                }`}
              >
                {i === actual && (
                  <span
                    className="block h-full rounded-full bg-accion"
                    // Sin transición: el ancho ya se actualiza cada 50 ms y
                    // animarlo encima lo deja siempre atrasado.
                    style={{ width: `${corriendo ? avance : 100}%` }}
                  />
                )}
              </button>
            ))}

            <button
              type="button"
              onClick={() => setDetenidoAMano((v) => !v)}
              aria-label={
                detenidoAMano ? "Reanudar las promociones" : "Detener las promociones"
              }
              className="ml-1.5 flex h-7 w-7 items-center justify-center rounded-full text-texto-3 transition-colors hover:bg-muted hover:text-foreground"
            >
              {detenidoAMano ? (
                <Play className="h-3.5 w-3.5" />
              ) : (
                <Pause className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function Flecha({
  lado,
  onClick,
}: {
  lado: "izquierda" | "derecha";
  onClick: () => void;
}) {
  const Icono = lado === "izquierda" ? ChevronLeft : ChevronRight;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={lado === "izquierda" ? "Promoción anterior" : "Promoción siguiente"}
      className={`absolute top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-md transition-colors hover:bg-white/30 sm:flex ${
        lado === "izquierda" ? "left-4" : "right-4"
      }`}
    >
      <Icono className="h-5 w-5" />
    </button>
  );
}
