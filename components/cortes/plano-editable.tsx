"use client";

import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import type {
  PiezaColocada,
  PiezaFijada,
  PlacaDelPlano,
  PlanoDeCorte,
} from "@/lib/cortes/plano";

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
 * siempre se puede volver al acomodo automático.
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
}: {
  plano: PlanoDeCorte;
  fijadas: PiezaFijada[];
  onFijadas: (f: PiezaFijada[]) => void;
}) {
  const [agarrada, setAgarrada] = useState<PiezaColocada | null>(null);
  const [encima, setEncima] = useState<number | null>(null);

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

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-base text-muted-foreground">
          Arrastrá una pieza a otra placa para mandarla ahí. Doble clic la gira.
        </p>
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
            onPointerUp={() => {
              setEncima(null);
              if (agarrada) mandarA(agarrada, placa.numero);
              setAgarrada(null);
            }}
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
                {Math.round(placa.aprovechado * 100)}% · {placa.piezas.length}{" "}
                {placa.piezas.length === 1 ? "pieza" : "piezas"} ·{" "}
                {placa.cortes.length}{" "}
                {placa.cortes.length === 1 ? "pasada" : "pasadas"}
              </span>
            </figcaption>

            <Dibujo
              placa={placa}
              plano={plano}
              resaltada={agarrada !== null && encima === placa.numero}
              agarrada={agarrada}
              movidas={movidas}
              claveDe={clave}
              onAgarrar={setAgarrada}
              onGirar={(p) => girar(p, placa.numero)}
              onSoltarUna={soltarUna}
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
  onAgarrar,
  onGirar,
  onSoltarUna,
}: {
  placa: PlacaDelPlano;
  plano: PlanoDeCorte;
  resaltada: boolean;
  agarrada: PiezaColocada | null;
  movidas: Set<string>;
  claveDe: (p: { indice: number; unidad: number }) => string;
  onAgarrar: (p: PiezaColocada) => void;
  onGirar: (p: PiezaColocada) => void;
  onSoltarUna: (p: PiezaColocada) => void;
}) {
  const { placaLargo, placaAncho } = plano;

  return (
    <svg
      viewBox={`-4 -4 ${placaLargo + 8} ${placaAncho + 8}`}
      /* `select-none`: sin esto, arrastrar una pieza va seleccionando los
         textos de las otras y la placa queda pintada de azul. */
      className={`block h-auto w-full select-none rounded border transition-colors ${
        resaltada ? "border-brand-orange bg-brand-orange/5" : "border-linea"
      }`}
      role="img"
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
        const cuerpo = Math.min(
          92,
          p.alto * 0.38,
          (p.ancho * 1.7) / medida.length,
        );
        const aMano = movidas.has(claveDe(p));

        return (
          <g
            key={i}
            onPointerDown={() => onAgarrar(p)}
            onDoubleClick={() => onGirar(p)}
            className="cursor-grab active:cursor-grabbing"
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
              className="fill-card"
              stroke="currentColor"
              strokeWidth={aMano ? 9 : 5}
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
