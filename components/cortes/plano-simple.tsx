"use client";

import type { PlacaDelPlano, PlanoDeCorte } from "@/lib/cortes/plano";

/**
 * El plano, para mirar.
 *
 * Es el dibujo que ve el cliente en el sitio: las mismas placas y las mismas
 * piezas que ve el taller, sin nada que se pueda arrastrar. `PlanoEditable`
 * —el del panel y el mostrador— tiene el acomodo a mano entretejido con el
 * dibujo, y acá eso sobra: quien pide un corte desde el sitio no decide de qué
 * placa sale cada pieza.
 *
 * **Se dibuja a escala, en milímetros.** El `viewBox` son las medidas reales de
 * la placa, así que no hay ninguna conversión a mano y cada pieza se dibuja con
 * los números que ya tiene.
 *
 * **La sierra se ve.** El trazo naranja translúcido de cada corte es el ancho
 * real del disco: esos milímetros no quedan en ninguna pieza. Es lo que explica,
 * sin una sola palabra, por qué dos piezas de 900 no entran en una placa de
 * 1830.
 */
export function PlanoSimple({ plano }: { plano: PlanoDeCorte }) {
  if (plano.placas.length === 0) return null;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {plano.placas.map((placa) => (
        <figure key={placa.numero} className="m-0 space-y-1.5">
          <figcaption className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-base font-medium">Placa {placa.numero}</span>
            <span className="text-sm text-muted-foreground">
              {placa.piezas.length}{" "}
              {placa.piezas.length === 1 ? "pieza" : "piezas"} ·{" "}
              {Math.round(placa.aprovechado * 100)}% aprovechado
            </span>
          </figcaption>

          <Dibujo placa={placa} plano={plano} />
        </figure>
      ))}
    </div>
  );
}

function Dibujo({
  placa,
  plano,
}: {
  placa: PlacaDelPlano;
  plano: PlanoDeCorte;
}) {
  const { placaLargo, placaAncho } = plano;

  return (
    <svg
      viewBox={`-4 -4 ${placaLargo + 8} ${placaAncho + 8}`}
      className="block h-auto w-full rounded border border-linea"
      role="img"
      aria-label={`Placa ${placa.numero} con ${placa.piezas.length} piezas, ${Math.round(
        placa.aprovechado * 100,
      )} por ciento aprovechado`}
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
        // El texto se achica hasta entrar en vez de desaparecer: una pieza
        // fina sin su medida obliga a ir a buscarla a otro lado.
        const cuerpo = Math.min(
          92,
          p.alto * 0.38,
          (p.ancho * 1.7) / medida.length,
        );

        return (
          <g key={i}>
            <title>
              {`${p.largoOriginal} × ${p.anchoOriginal} mm${
                p.etiqueta ? ` · ${p.etiqueta}` : ""
              }${p.girada ? " · girada" : ""}`}
            </title>
            <rect
              x={p.x}
              y={p.y}
              width={p.ancho}
              height={p.alto}
              className="fill-card"
              stroke="currentColor"
              strokeWidth={4}
            />
            {cuerpo >= 26 && (
              <text
                x={p.x + p.ancho / 2}
                y={p.y + p.alto / 2 + cuerpo * 0.35}
                fontSize={cuerpo}
                fontWeight={600}
                textAnchor="middle"
                className="fill-foreground"
              >
                {medida}
              </text>
            )}
          </g>
        );
      })}

      {/* Lo que sobra entero, punteado: es lo que queda en la maderera cuando
          el corte se cobra por pasada. */}
      {placa.recortes.map((r, i) => (
        <rect
          key={`r${i}`}
          x={r.x}
          y={r.y}
          width={r.ancho}
          height={r.alto}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.35}
          strokeWidth={3}
          strokeDasharray="18 12"
        />
      ))}

      {/* Cada pasada de sierra, con el ancho real del disco. */}
      {placa.cortes.map((c, i) => (
        <line
          key={`c${i}`}
          x1={c.x1}
          y1={c.y1}
          x2={c.x2}
          y2={c.y2}
          stroke="var(--color-brand-orange, #c2410c)"
          strokeOpacity={0.5}
          strokeWidth={Math.max(plano.anchoSierra, 4)}
        />
      ))}
    </svg>
  );
}
