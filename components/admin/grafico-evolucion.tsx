"use client";

import { useState } from "react";

/**
 * Lo vendido mes a mes.
 *
 * **Es lo único que la tabla de abajo no puede contestar.** Ella dice qué se
 * vendió y cuánto dejó; esto dice si el mes viene mejor o peor que los
 * anteriores, y eso en una tabla se lee sumando de cabeza.
 *
 * Decisiones, y por qué:
 *
 * - **Una sola serie, un solo color.** No hay identidad que distinguir: es una
 *   magnitud en el tiempo. Sin leyenda —el título ya dice qué es— y con el
 *   valor escrito solo donde hace falta: el máximo y el último, que son los dos
 *   números que se buscan.
 * - **Barras y no línea.** Los meses son períodos cerrados, no una medición
 *   continua: la línea invitaría a leer «el 15 de marzo» entre dos puntos.
 * - **Dibujado a mano, sin librería.** Igual que `grafico-ventas.tsx`: la que
 *   había fallaba en silencio y dejaba un recuadro vacío al lado de un número.
 *   Doce barras son geometría de tres líneas, y hacerlo acá además permite dar
 *   el mismo dato como tabla para quien usa lector de pantalla.
 */

export interface PuntoMensual {
  clave: string;
  etiqueta: string;
  total: number;
}

const moneda = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

/** En el eje los importes van cortos: "$9,2 M" en vez de "$9.200.000". */
function abreviar(valor: number): string {
  if (valor >= 1_000_000)
    return `$${(valor / 1_000_000).toLocaleString("es-AR", { maximumFractionDigits: 1 })} M`;
  if (valor >= 1_000) return `$${Math.round(valor / 1_000)} mil`;
  return `$${Math.round(valor)}`;
}

const ANCHO = 720;
const ALTO = 230;
const MARGEN = { arriba: 22, derecha: 8, abajo: 26, izquierda: 62 };
const AREA_ANCHO = ANCHO - MARGEN.izquierda - MARGEN.derecha;
const AREA_ALTO = ALTO - MARGEN.arriba - MARGEN.abajo;

/** Un techo redondo, para que la marca de arriba sea un número que se lee. */
function techo(maximo: number): number {
  if (maximo <= 0) return 1000;
  const magnitud = 10 ** Math.floor(Math.log10(maximo));
  return Math.ceil(maximo / magnitud) * magnitud;
}

export function GraficoDeEvolucion({ meses }: { meses: PuntoMensual[] }) {
  const [encima, setEncima] = useState<string | null>(null);

  if (meses.length === 0) return null;

  const maximo = Math.max(...meses.map((m) => m.total));
  const tope = techo(maximo);

  // Tres marcas: cero, la mitad y el techo. Más líneas es ruido sobre doce
  // barras.
  const marcas = [0, tope / 2, tope];

  const paso = AREA_ANCHO / meses.length;
  // El 2px de aire entre barras vecinas sale del ancho, no de un borde: un
  // borde del color de la superficie se ve mal en modo oscuro.
  const anchoBarra = Math.min(46, paso * 0.62);

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${ANCHO} ${ALTO}`}
        className="block h-auto w-full"
        role="img"
        aria-label={`Ventas por mes. Máximo ${moneda.format(maximo)}.`}
      >
        {marcas.map((marca) => {
          const y = MARGEN.arriba + AREA_ALTO - (marca / tope) * AREA_ALTO;
          return (
            <g key={marca}>
              <line
                x1={MARGEN.izquierda}
                y1={y}
                x2={ANCHO - MARGEN.derecha}
                y2={y}
                stroke="currentColor"
                strokeOpacity={marca === 0 ? 0.25 : 0.1}
                strokeWidth={1}
              />
              <text
                x={MARGEN.izquierda - 8}
                y={y + 4}
                textAnchor="end"
                fontSize={11}
                className="fill-current opacity-55"
              >
                {abreviar(marca)}
              </text>
            </g>
          );
        })}

        {meses.map((mes, i) => {
          const alto = tope > 0 ? (mes.total / tope) * AREA_ALTO : 0;
          const x = MARGEN.izquierda + i * paso + (paso - anchoBarra) / 2;
          const y = MARGEN.arriba + AREA_ALTO - alto;
          // El valor se escribe solo donde se busca: el mes más alto y el
          // último. Un número sobre cada barra es una tabla mal dibujada.
          const destacado = mes.total === maximo || i === meses.length - 1;

          return (
            <g
              key={mes.clave}
              onPointerEnter={() => setEncima(mes.clave)}
              onPointerLeave={() => setEncima(null)}
            >
              <title>{`${mes.etiqueta}: ${moneda.format(mes.total)}`}</title>
              {/* El área de contacto es toda la columna, no solo la barra:
                  con una barra de dos píxeles no se puede apuntar. */}
              <rect
                x={MARGEN.izquierda + i * paso}
                y={MARGEN.arriba}
                width={paso}
                height={AREA_ALTO}
                fill="transparent"
              />
              <rect
                x={x}
                y={y}
                width={anchoBarra}
                height={Math.max(alto, mes.total > 0 ? 2 : 0)}
                rx={4}
                fill="var(--color-brand-orange)"
                opacity={encima === null || encima === mes.clave ? 1 : 0.45}
              />
              {(destacado || encima === mes.clave) && mes.total > 0 && (
                <text
                  x={x + anchoBarra / 2}
                  y={y - 7}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={600}
                  className="fill-current"
                >
                  {abreviar(mes.total)}
                </text>
              )}
              <text
                x={x + anchoBarra / 2}
                y={ALTO - 8}
                textAnchor="middle"
                fontSize={11}
                className="fill-current opacity-55"
              >
                {mes.etiqueta}
              </text>
            </g>
          );
        })}
      </svg>

      {/* El mismo dato, legible con lector de pantalla y copiable. */}
      <details className="mt-2">
        <summary className="cursor-pointer text-sm text-muted-foreground">
          Ver los números
        </summary>
        <table className="mt-2 w-full text-base">
          <thead>
            <tr className="text-left text-sm text-muted-foreground">
              <th className="py-1 font-medium">Mes</th>
              <th className="py-1 text-right font-medium">Vendido</th>
            </tr>
          </thead>
          <tbody>
            {meses.map((mes) => (
              <tr key={mes.clave} className="border-t border-linea-suave">
                <td className="py-1">{mes.etiqueta}</td>
                <td className="tabular py-1 text-right">
                  {moneda.format(mes.total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
