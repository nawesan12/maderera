"use client";

import { useEffect, useRef, useState } from "react";
import { RotateCcw, RotateCw } from "lucide-react";
import type {
  PiezaColocada,
  PiezaFijada,
  PlacaDelPlano,
  PlanoDeCorte,
} from "@/lib/cortes/tipos";

/**
 * Qué hace un pointerup sobre el dibujo de una placa.
 *
 * - Con una pieza agarrada: si se soltó en su placa es un toque y la marca;
 *   en otra, la manda ahí.
 * - Sin agarrada y con una marcada: tocar el dibujo de otra placa la manda
 *   ahí, y tocar un hueco de la suya la desmarca.
 *
 * Mandada, la pieza se desmarca. Antes quedaba marcada para siempre, y
 * cualquier toque posterior en otra placa —su título, un hueco, el borde al
 * apuntar— la mudaba y la dejaba fijada a mano sin que nadie lo pidiera
 * (comité de T4). Por eso, además, el título de la placa ya no recibe el
 * toque: solo el dibujo.
 */
export function alSoltarEnPlaca(e: {
  numero: number;
  /** La placa de donde salió la pieza agarrada, si hay una. */
  agarradaEn: number | null;
  /** La placa de la pieza marcada, si hay una. */
  elegidaEn: number | null;
}): "marcar" | "mandarAgarrada" | "mandarElegida" | "desmarcar" | "nada" {
  if (e.agarradaEn !== null) return e.agarradaEn === e.numero ? "marcar" : "mandarAgarrada";
  if (e.elegidaEn !== null) return e.elegidaEn === e.numero ? "desmarcar" : "mandarElegida";
  return "nada";
}

/**
 * El plano, con el mouse.
 *
 * El cálculo acomoda, y quien mira la placa corrige. Es como trabajan los
 * programas del rubro: optimizan solos y dejan meter mano, porque el operario
 * sabe cosas que el cálculo no —que esa puerta tiene que salir de la placa
 * nueva y no de la que tiene el borde golpeado—.
 *
 * **Se arrastra una pieza a una placa, no a un punto.** Es deliberado y es la
 * diferencia entre un plano ejecutable y un dibujo: soltar piezas en
 * coordenadas libres arma patrones con forma de molinete, y una seccionadora
 * corta de borde a borde —no sabe hacer una L—. La placa la elige la persona;
 * el milímetro exacto lo resuelve el cálculo, que además no se equivoca con el
 * ancho de sierra.
 *
 * Se puede girar una pieza con doble clic, salvo que la veta lo prohíba, y
 * siempre se puede volver al acomodo automático. Tocar una pieza la marca, y
 * la marcada muestra un botón de girar de 44 px —el doble clic no existe en
 * una pantalla táctil, y nadie lo adivina—; con el teclado, Tab llega a cada
 * pieza, Enter la marca y R la gira.
 *
 * **Va con eventos de puntero y no con el arrastre del navegador.** El arrastre
 * de HTML no está definido sobre elementos de SVG y en la práctica funciona
 * distinto en cada navegador. Con puntero, además, sirven las dos formas de
 * hacerlo —arrastrar de una placa a otra, o tocar la pieza y después la placa—,
 * y la segunda es la que va a usar quien no tiene buen pulso con el mouse.
 */
export function PlanoEditable({
  plano,
  fijadas,
  onFijadas,
  sencillo = false,
  girable = () => true,
}: {
  plano: PlanoDeCorte;
  fijadas: PiezaFijada[];
  onFijadas: (f: PiezaFijada[]) => void;
  /**
   * Para el mostrador: sin el porcentaje, sin las pasadas y sin la frase de
   * cómo se usa. Son números y palabras de taller, y del otro lado del
   * mostrador hay un cliente mirando la pantalla (T4, hallazgo 44).
   */
  sencillo?: boolean;
  /** Si la pieza (por su índice en el despiece) se puede girar: con veta, no. */
  girable?: (indice: number) => boolean;
}) {
  const [agarrada, setAgarrada] = useState<PiezaColocada | null>(null);
  const [encima, setEncima] = useState<number | null>(null);
  /** La pieza tocada: la que muestra el botón de girar. */
  const [elegida, setElegida] = useState<string | null>(null);

  // Si se suelta fuera de una placa, no pasa nada: la pieza se queda donde
  // estaba. Sin esto quedaría agarrada para siempre.
  useEffect(() => {
    if (!agarrada) return;
    const soltar = () => setAgarrada(null);
    window.addEventListener("pointerup", soltar);
    return () => window.removeEventListener("pointerup", soltar);
  }, [agarrada]);

  const clave = (p: { indice: number; unidad: number }) =>
    `${p.indice}/${p.unidad}`;
  const movidas = new Set(fijadas.map(clave));

  function mandarA(pieza: PiezaColocada, placa: number) {
    const otras = fijadas.filter((f) => clave(f) !== clave(pieza));
    onFijadas([...otras, { indice: pieza.indice, unidad: pieza.unidad, placa }]);
  }

  function girar(pieza: PiezaColocada, placa: number) {
    if (!girable(pieza.indice)) return;
    const otras = fijadas.filter((f) => clave(f) !== clave(pieza));
    onFijadas([
      ...otras,
      {
        indice: pieza.indice,
        unidad: pieza.unidad,
        placa,
        girada: !pieza.girada,
      },
    ]);
  }

  function soltarUna(pieza: PiezaColocada) {
    onFijadas(fijadas.filter((f) => clave(f) !== clave(pieza)));
  }

  /** En qué placa está la pieza de esta clave, y la pieza. */
  function dondeEsta(c: string): { pieza: PiezaColocada; placa: number } | null {
    for (const pl of plano.placas) {
      const pieza = pl.piezas.find((x) => clave(x) === c);
      if (pieza) return { pieza, placa: pl.numero };
    }
    return null;
  }

  /*
   * Soltar sobre el dibujo de una placa (la regla, con su prueba, en
   * `alSoltarEnPlaca`). Soltada en la misma placa de donde salió no es una
   * mudanza: es un toque, y marca la pieza. Antes cada clic la «movía» a su
   * propia placa y la dejaba fijada a mano sin que nadie lo pidiera.
   */
  function soltarEn(numero: number) {
    const origen = agarrada ? dondeEsta(clave(agarrada)) : null;
    const marcada = !agarrada && elegida ? dondeEsta(elegida) : null;
    const que = alSoltarEnPlaca({
      numero,
      agarradaEn: agarrada ? (origen?.placa ?? -1) : null,
      elegidaEn: marcada?.placa ?? null,
    });
    if (que === "marcar" && agarrada) setElegida(clave(agarrada));
    else if (que === "mandarAgarrada" && agarrada) {
      mandarA(agarrada, numero);
      setElegida(null);
    } else if (que === "mandarElegida" && marcada) {
      mandarA(marcada.pieza, numero);
      setElegida(null);
    } else if (que === "desmarcar") setElegida(null);
    setAgarrada(null);
  }

  // Un toque fuera del plano desmarca la pieza: marcada para siempre, el
  // próximo toque en otra placa la mudaba.
  const raiz = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!elegida) return;
    function afuera(e: PointerEvent) {
      if (raiz.current && !raiz.current.contains(e.target as Node)) setElegida(null);
    }
    document.addEventListener("pointerdown", afuera);
    return () => document.removeEventListener("pointerdown", afuera);
  }, [elegida]);

  return (
    <div
      ref={raiz}
      className="space-y-3"
      onKeyDown={(e) => {
        // Esc desmarca, y no cierra el diálogo del corte con la pieza marcada.
        if (e.key === "Escape" && elegida) {
          e.preventDefault();
          e.stopPropagation();
          setElegida(null);
        }
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        {!sencillo && (
          <p className="text-base text-muted-foreground">
            Arrastrá una pieza a otra placa para mandarla ahí. Doble clic la gira.
          </p>
        )}
        {fijadas.length > 0 && (
          <button
            type="button"
            onClick={() => onFijadas([])}
            className="inline-flex h-11 items-center gap-2 rounded-lg border border-linea px-3.5 text-base font-medium transition-colors hover:bg-hundida"
          >
            <RotateCcw className="h-4 w-4" />
            Volver al automático
          </button>
        )}
      </div>

      {plano.fijadasDescartadas.length > 0 && (
        <p className="estado-espera rounded-lg bg-[var(--estado-fondo)] px-4 py-3 text-base">
          {plano.fijadasDescartadas.length === 1
            ? "Una pieza que habías movido no entraba donde la mandaste"
            : `${plano.fijadasDescartadas.length} piezas que habías movido no entraban donde las mandaste`}
          , así que volvieron al acomodo automático. No se perdió ninguna.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {plano.placas.map((placa) => (
          <figure
            key={placa.numero}
            className="m-0 space-y-1.5"
            onPointerEnter={() => agarrada && setEncima(placa.numero)}
            onPointerLeave={() => setEncima(null)}
          >
            <figcaption className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-base font-medium">
                Placa {placa.numero}
              </span>
              <span
                className={`inline-flex items-center rounded-full bg-[var(--estado-fondo)] px-2.5 py-0.5 text-sm font-medium text-[var(--estado-tinta)] ${
                  placa.seVendeEntera ? "estado-marca" : "estado-ok"
                }`}
              >
                {placa.seVendeEntera ? "Se vende entera" : "Se cobra el corte"}
              </span>
              <span className="tabular w-full text-sm text-muted-foreground">
                {sencillo ? (
                  `${placa.piezas.length} ${placa.piezas.length === 1 ? "pieza" : "piezas"}`
                ) : (
                  <>
                    {Math.round(placa.aprovechado * 100)}% · {placa.piezas.length}{" "}
                    {placa.piezas.length === 1 ? "pieza" : "piezas"} ·{" "}
                    {placa.cortes.length}{" "}
                    {placa.cortes.length === 1 ? "pasada" : "pasadas"}
                  </>
                )}
              </span>
            </figcaption>

            <Dibujo
              placa={placa}
              plano={plano}
              resaltada={agarrada !== null && encima === placa.numero}
              agarrada={agarrada}
              movidas={movidas}
              claveDe={clave}
              elegida={elegida}
              girable={girable}
              onAgarrar={setAgarrada}
              onElegir={(p) => setElegida(clave(p))}
              onGirar={(p) => girar(p, placa.numero)}
              onSoltarUna={soltarUna}
              onSoltarAca={() => {
                setEncima(null);
                soltarEn(placa.numero);
              }}
            />
          </figure>
        ))}
      </div>
    </div>
  );
}

function Dibujo({
  placa,
  plano,
  resaltada,
  agarrada,
  movidas,
  claveDe,
  elegida,
  girable,
  onAgarrar,
  onElegir,
  onGirar,
  onSoltarUna,
  onSoltarAca,
}: {
  placa: PlacaDelPlano;
  plano: PlanoDeCorte;
  resaltada: boolean;
  agarrada: PiezaColocada | null;
  movidas: Set<string>;
  claveDe: (p: { indice: number; unidad: number }) => string;
  elegida: string | null;
  girable: (indice: number) => boolean;
  onAgarrar: (p: PiezaColocada) => void;
  onElegir: (p: PiezaColocada) => void;
  onGirar: (p: PiezaColocada) => void;
  onSoltarUna: (p: PiezaColocada) => void;
  /** Un pointerup sobre el dibujo (no sobre el título de la placa). */
  onSoltarAca: () => void;
}) {
  const { placaLargo, placaAncho } = plano;
  // El viewBox arranca en −4 y suma 8: de milímetros de placa a porcentaje
  // del dibujo, para poner el botón de girar (HTML) encima de la pieza (SVG).
  const pctX = (mm: number) => `${((mm + 4) / (placaLargo + 8)) * 100}%`;
  const pctY = (mm: number) => `${((mm + 4) / (placaAncho + 8)) * 100}%`;
  const marcada = placa.piezas.find((p) => claveDe(p) === elegida);

  return (
    <div className="relative" onPointerUp={onSoltarAca}>
    <svg
      viewBox={`-4 -4 ${placaLargo + 8} ${placaAncho + 8}`}
      /* `select-none`: sin esto, arrastrar una pieza va seleccionando los
         textos de las otras y la placa queda pintada de azul. */
      className={`block h-auto w-full select-none rounded border transition-colors ${
        resaltada ? "border-brand-orange bg-brand-orange/5" : "border-linea"
      }`}
      role="group"
      aria-label={`Placa ${placa.numero}: ${placa.piezas.length} piezas, ${Math.round(
        placa.aprovechado * 100,
      )} por ciento aprovechado${
        placa.seVendeEntera ? ", se vende entera" : ", se cobra el corte"
      }`}
    >
      <rect
        x={0}
        y={0}
        width={placaLargo}
        height={placaAncho}
        className="fill-hundida"
        stroke="currentColor"
        strokeWidth={6}
        opacity={0.9}
      />

      {placa.piezas.map((p, i) => {
        const medida = `${p.ancho}×${p.alto}`;
        // Angosta y alta, la medida va parada: acostada corría de una pieza a
        // la otra («350×900350×900», H194). Un dígito ocupa ~0,6 del cuerpo.
        const parada = p.alto > p.ancho * 1.4;
        const cuerpo = Math.min(
          92,
          parada ? p.ancho * 0.55 : p.alto * 0.38,
          ((parada ? p.alto : p.ancho) * 0.85) / (medida.length * 0.6),
        );
        const aMano = movidas.has(claveDe(p));

        return (
          <g
            key={i}
            onPointerDown={() => onAgarrar(p)}
            onDoubleClick={() => onGirar(p)}
            tabIndex={0}
            role="button"
            aria-pressed={claveDe(p) === elegida}
            aria-label={`Pieza ${p.largoOriginal} × ${p.anchoOriginal} mm${p.etiqueta ? `, ${p.etiqueta}` : ""}`}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onElegir(p);
              } else if ((e.key === "r" || e.key === "R") && !e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault();
                onGirar(p);
              }
            }}
            // Con el teclado, la pieza enfocada es la marcada: se ve el borde
            // grueso y R la gira. (Un `g` de SVG no dibuja el contorno del foco.)
            onFocus={() => onElegir(p)}
            className="cursor-grab outline-none active:cursor-grabbing"
            opacity={
              agarrada &&
              agarrada.indice === p.indice &&
              agarrada.unidad === p.unidad
                ? 0.45
                : 1
            }
          >
            <title>
              {`${p.largoOriginal} × ${p.anchoOriginal} mm${
                p.etiqueta ? ` · ${p.etiqueta}` : ""
              }${p.girada ? " · girada" : ""}${
                aMano ? " · movida a mano" : ""
              } — arrastrala a otra placa, doble clic para girarla`}
            </title>
            <rect
              x={p.x}
              y={p.y}
              width={p.ancho}
              height={p.alto}
              className={claveDe(p) === elegida ? "fill-card text-accion" : "fill-card"}
              stroke="currentColor"
              strokeWidth={claveDe(p) === elegida ? 14 : aMano ? 9 : 5}
              strokeDasharray={aMano ? "34 20" : undefined}
            />
            {cuerpo >= 44 && (
              <text
                x={p.x + p.ancho / 2}
                y={p.y + p.alto / 2 + cuerpo * 0.35}
                fontSize={cuerpo}
                textAnchor="middle"
                fill="currentColor"
                opacity={0.75}
                pointerEvents="none"
                transform={parada ? `rotate(-90 ${p.x + p.ancho / 2} ${p.y + p.alto / 2})` : undefined}
              >
                {medida}
              </text>
            )}
            {/* Devolver una sola pieza al automático, sin perder las otras. */}
            {aMano && p.ancho > 300 && p.alto > 220 && (
              <g
                onClick={(e) => {
                  e.stopPropagation();
                  onSoltarUna(p);
                }}
                className="cursor-pointer"
              >
                <title>Devolver esta pieza al acomodo automático</title>
                <circle
                  cx={p.x + p.ancho - 70}
                  cy={p.y + 70}
                  r={52}
                  className="fill-card"
                  stroke="currentColor"
                  strokeWidth={5}
                />
                <Flecha x={p.x + p.ancho - 70} y={p.y + 70} />
              </g>
            )}
          </g>
        );
      })}

      {placa.recortes.map((r, i) => (
        <rect
          key={`r${i}`}
          x={r.x}
          y={r.y}
          width={r.ancho}
          height={r.alto}
          fill="none"
          stroke="currentColor"
          strokeWidth={4}
          strokeDasharray="26 18"
          opacity={0.35}
          pointerEvents="none"
        />
      ))}
    </svg>
      {/* El botón de girar, solo en la pieza marcada: en todas, el plano se
          llena de ruido. Es HTML encima del dibujo y no parte del SVG para
          que mida 44 px de verdad a cualquier escala, y queda fuera del
          arrastre: tocarlo no agarra la pieza. */}
      {marcada && girable(marcada.indice) && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          // Ni el pointerup: llegaría al dibujo como «tocar un hueco» y
          // desmarcaría la pieza antes del clic.
          onPointerUp={(e) => e.stopPropagation()}
          onClick={() => onGirar(marcada)}
          aria-label="Girar la pieza"
          style={{ left: pctX(marcada.x + marcada.ancho), top: pctY(marcada.y) }}
          className="absolute flex h-11 w-11 -translate-x-full items-center justify-center rounded-full border border-linea bg-card text-foreground shadow-md transition-colors hover:bg-hundida"
        >
          <RotateCw className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}

/**
 * La flechita de "devolver al automático".
 *
 * Dibujada con `path` y no con el ícono de la librería: adentro de este SVG las
 * medidas son milímetros de placa, y un componente que trae su propio `<svg>`
 * de 24 px se vería como un punto.
 */
function Flecha({ x, y }: { x: number; y: number }) {
  return (
    <path
      d={`M ${x + 14} ${y - 16} a 20 20 0 1 0 -20 20 M ${x - 6} ${y - 16} l -12 4 l 4 -14`}
      fill="none"
      stroke="currentColor"
      strokeWidth={7}
      strokeLinecap="round"
      strokeLinejoin="round"
      pointerEvents="none"
    />
  );
}
