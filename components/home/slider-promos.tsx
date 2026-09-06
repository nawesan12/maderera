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
 */
export function SliderDePromos({ banners }: { banners: BannerPublicado[] }) {
  const pista = useRef<HTMLDivElement>(null);
  const [actual, setActual] = useState(0);
  const [enPausa, setEnPausa] = useState(false);
  const [detenidoAMano, setDetenidoAMano] = useState(false);
  const [avance, setAvance] = useState(0);

  const varios = banners.length > 1;

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
        const siguiente = (previo + paso + banners.length) % banners.length;
        irA(siguiente);
        return siguiente;
      });
      setAvance(0);
    },
    [banners.length, irA],
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
        {banners.map((banner, i) => (
          <div
            key={banner.id}
            role="group"
            aria-roledescription="promoción"
            aria-label={`${i + 1} de ${banners.length}`}
            aria-hidden={varios && i !== actual}
            className="w-full shrink-0 snap-start"
          >
            <Banner banner={banner} alto prioridad={i === 0} />
          </div>
        ))}
      </div>

      {varios && (
        <>
          <Flecha lado="izquierda" onClick={() => mover(-1)} />
          <Flecha lado="derecha" onClick={() => mover(1)} />

          <div className="mt-3.5 flex items-center justify-center gap-2">
            {banners.map((banner, i) => (
              <button
                key={banner.id}
                type="button"
                onClick={() => {
                  setActual(i);
                  irA(i);
                  setAvance(0);
                }}
                aria-label={`Ver "${banner.titulo}"`}
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
