"use client";

import type { PlacaDelPlano, PlanoDeCorte } from "@/lib/cortes/tipos";

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
/** El canto de cada renglón del despiece, por índice: 0, 1 o 2 lados. */
type CantoDeLaPieza = { cantoLargo?: number | null; cantoAncho?: number | null };

export function PlanoSimple({
  plano,
  unaColumna,
  media,
  piezas,
}: {
  plano: PlanoDeCorte;
  /** El despiece, para marcar los lados con canto (M2S1-208). */
  piezas?: CantoDeLaPieza[];
  /** En la columna del armador las placas van una abajo de otra, grandes. */
  unaColumna?: boolean;
  /** Sale de media placa: cada recuadro es una media. */
  media?: boolean;
}) {
  if (plano.placas.length === 0) return null;

  return (
    <div className={`grid gap-4 ${unaColumna ? "" : "sm:grid-cols-2"}`}>
      {plano.placas.map((placa) => (
        <figure key={placa.numero} className="m-0 space-y-1.5">
          <figcaption className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-base font-medium">{media ? "Media" : "Placa"} {placa.numero}</span>
            <span className="text-sm text-muted-foreground">
              {placa.piezas.length}{" "}
              {placa.piezas.length === 1 ? "pieza" : "piezas"} ·{" "}
              {Math.round(placa.aprovechado * 100)}% aprovechado
            </span>
          </figcaption>

          <Dibujo placa={placa} plano={plano} piezas={piezas} />
        </figure>
      ))}
    </div>
  );
}

function Dibujo({
  placa,
  plano,
  piezas,
}: {
  placa: PlacaDelPlano;
  plano: PlanoDeCorte;
  piezas?: CantoDeLaPieza[];
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
        // Largo × ancho, en el orden de la planilla: el dibujo rotulaba
        // «560×720» al lado de «720 × 560» en la tabla (mes simulado, M2S1-208).
        const medida = `${p.largoOriginal}×${p.anchoOriginal}`;
        // El texto se achica hasta entrar en vez de desaparecer: una pieza
        // fina sin su medida obliga a ir a buscarla a otro lado.
        // Angosta y alta, la medida va parada: acostada se pisaba con la de
        // al lado (H194). Un dígito ocupa ~0,6 del cuerpo.
        const parada = p.alto > p.ancho * 1.4;
        const cuerpo = Math.min(
          92,
          parada ? p.ancho * 0.55 : p.alto * 0.38,
          ((parada ? p.alto : p.ancho) * 0.85) / (medida.length * 0.6),
        );
        // El nombre arriba de la medida, si entra: para que el operario
        // ubique la pieza.
        const largoDisponible = (parada ? p.alto : p.ancho) * 0.85;
        const altoDisponible = parada ? p.ancho : p.alto;
        const cuerpoNombre = p.etiqueta
          ? Math.min(cuerpo * 0.8, largoDisponible / (p.etiqueta.length * 0.55))
          : 0;
        const conNombre = cuerpoNombre >= 22 && altoDisponible >= cuerpo * 1.2 + cuerpoNombre * 1.6;
        const cx = p.x + p.ancho / 2;
        const cy = p.y + p.alto / 2;
        const giro = parada ? `rotate(-90 ${cx} ${cy})` : undefined;
        // Los lados con canto, en trazo grueso: el largo de la pieza va
        // acostado salvo que esté girada.
        const canto = piezas?.[p.indice];
        const ladosLargo = Math.min(2, Math.max(0, canto?.cantoLargo ?? 0));
        const ladosAncho = Math.min(2, Math.max(0, canto?.cantoAncho ?? 0));
        const bordes: [number, number, number, number][] = [];
        const horizontales = p.girada ? ladosAncho : ladosLargo;
        const verticales = p.girada ? ladosLargo : ladosAncho;
        if (horizontales >= 1) bordes.push([p.x, p.y, p.x + p.ancho, p.y]);
        if (horizontales >= 2) bordes.push([p.x, p.y + p.alto, p.x + p.ancho, p.y + p.alto]);
        if (verticales >= 1) bordes.push([p.x, p.y, p.x, p.y + p.alto]);
        if (verticales >= 2) bordes.push([p.x + p.ancho, p.y, p.x + p.ancho, p.y + p.alto]);

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
            {bordes.map(([x1, y1, x2, y2], j) => (
              <line key={j} x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth={22} />
            ))}
            {conNombre && (
              <text
                x={cx}
                y={cy - cuerpo * 0.35}
                fontSize={cuerpoNombre}
                textAnchor="middle"
                className="fill-muted-foreground"
                transform={giro}
              >
                {p.etiqueta}
              </text>
            )}
            {cuerpo >= 26 && (
              <text
                x={cx}
                y={conNombre ? cy + cuerpo * 0.95 : cy + cuerpo * 0.35}
                fontSize={cuerpo}
                fontWeight={600}
                textAnchor="middle"
                className="fill-foreground"
                transform={giro}
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
