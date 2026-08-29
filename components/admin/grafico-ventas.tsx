"use client";

import { useId, useState } from "react";

/**
 * Ventas por sucursal, mes a mes.
 *
 * Barras agrupadas y no apiladas: la pregunta que se hace mirando esto es cómo
 * viene una sucursal contra la otra, y apiladas solo la de abajo arranca en una
 * base común, así que la de arriba no se puede comparar entre meses.
 *
 * Un solo eje de valores. Los importes de ambas sucursales están en la misma
 * escala, así que comparten escala: dos ejes distintos harían que dos barras de
 * la misma altura significaran cosas distintas.
 *
 * **Dibujado a mano y no con una librería de gráficos.** Estaba hecho con
 * Recharts y no dibujaba nada: renderizaba los ejes sin sus textos y las barras
 * sin su contenido, sin tirar un solo error. Un gráfico que falla en silencio es
 * peor que uno que no está, porque el panel decía "$3.615.426 este mes" al lado
 * de un recuadro vacío.
 *
 * Seis meses por dos series es geometría de tres líneas. Hacerla acá la vuelve
 * determinista —no depende de medir el DOM, así que sale igual en el servidor y
 * en el navegador—, saca media tonelada de dependencia, y permite dar el dato
 * también como tabla para quien usa lector de pantalla.
 */

interface Punto {
  mes: string;
  central: number;
  aserradero: number;
}

const SERIES = [
  { clave: "central", nombre: "Casa Central", color: "var(--sucursal-central)" },
  {
    clave: "aserradero",
    nombre: "Aserradero",
    color: "var(--sucursal-aserradero)",
  },
] as const;

const moneda = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

/** En los ejes los importes van cortos: "$9,2 M" en vez de "$9.200.000". */
function abreviar(valor: number) {
  if (valor >= 1_000_000)
    return `$${(valor / 1_000_000).toLocaleString("es-AR", { maximumFractionDigits: 1 })} M`;
  if (valor >= 1_000) return `$${Math.round(valor / 1_000)} mil`;
  return `$${valor}`;
}

/* Coordenadas del dibujo. El SVG se escala solo con el ancho disponible. */
const ANCHO = 720;
const ALTO = 260;
const MARGEN = { arriba: 12, derecha: 8, abajo: 28, izquierda: 60 };
const AREA_ANCHO = ANCHO - MARGEN.izquierda - MARGEN.derecha;
const AREA_ALTO = ALTO - MARGEN.arriba - MARGEN.abajo;

/**
 * Un techo redondo por encima del máximo, para que la marca de arriba sea un
 * número que se lee. Con el máximo justo, el eje termina en "$9,17 M".
 */
function techo(maximo: number): number {
  if (maximo <= 0) return 1000;
  const magnitud = 10 ** Math.floor(Math.log10(maximo));
  return Math.ceil(maximo / (magnitud / 2)) * (magnitud / 2);
}

export function GraficoVentas({ datos }: { datos: Punto[] }) {
  const [activo, setActivo] = useState<number | null>(null);
  const idTabla = useId();

  if (datos.length === 0) {
    return (
      <p className="py-16 text-center text-base text-muted-foreground">
        Todavía no hay ventas para mostrar.
      </p>
    );
  }

  const maximo = Math.max(
    ...datos.flatMap((d) => [d.central, d.aserradero]),
    0,
  );
  const tope = techo(maximo);

  const anchoGrupo = AREA_ANCHO / datos.length;
  // 26 es el ancho de barra que ya tenía el gráfico; se achica si no entra.
  const anchoBarra = Math.min(26, (anchoGrupo * 0.62) / SERIES.length);
  const separacion = 2;
  const anchoPar = anchoBarra * SERIES.length + separacion;

  const y = (valor: number) =>
    MARGEN.arriba + AREA_ALTO - (valor / tope) * AREA_ALTO;

  const marcas = [0, 0.25, 0.5, 0.75, 1].map((f) => f * tope);
  const punto = activo !== null ? datos[activo] : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${ANCHO} ${ALTO}`}
        width="100%"
        height={ALTO}
        role="img"
        aria-labelledby={idTabla}
        className="overflow-visible"
        onMouseLeave={() => setActivo(null)}
      >
        <title id={idTabla}>
          Ventas por sucursal de los últimos {datos.length} meses. El detalle
          está en la tabla que sigue.
        </title>

        {/* Grilla y eje de valores */}
        {marcas.map((valor) => (
          <g key={valor}>
            <line
              x1={MARGEN.izquierda}
              x2={ANCHO - MARGEN.derecha}
              y1={y(valor)}
              y2={y(valor)}
              stroke="var(--border)"
            />
            <text
              x={MARGEN.izquierda - 10}
              y={y(valor)}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={13}
              fill="var(--muted-foreground)"
            >
              {abreviar(valor)}
            </text>
          </g>
        ))}

        {datos.map((d, i) => {
          const centroGrupo = MARGEN.izquierda + anchoGrupo * (i + 0.5);
          const inicio = centroGrupo - anchoPar / 2;

          return (
            <g key={d.mes}>
              {/* Zona sensible de toda la columna: apuntar a una barra de dos
                  píxeles de alto es imposible, y el mes es lo que se consulta. */}
              <rect
                x={MARGEN.izquierda + anchoGrupo * i}
                y={MARGEN.arriba}
                width={anchoGrupo}
                height={AREA_ALTO}
                fill={activo === i ? "var(--muted)" : "transparent"}
                opacity={activo === i ? 0.5 : 1}
                onMouseEnter={() => setActivo(i)}
              />

              {SERIES.map((serie, s) => {
                const valor = d[serie.clave];
                const alto = Math.max(0, MARGEN.arriba + AREA_ALTO - y(valor));

                return (
                  <rect
                    key={serie.clave}
                    x={inicio + s * (anchoBarra + separacion)}
                    y={y(valor)}
                    width={anchoBarra}
                    height={alto}
                    rx={4}
                    fill={serie.color}
                    pointerEvents="none"
                  />
                );
              })}

              <text
                x={centroGrupo}
                y={ALTO - 8}
                textAnchor="middle"
                fontSize={14}
                fill="var(--muted-foreground)"
                pointerEvents="none"
              >
                {d.mes}
              </text>
            </g>
          );
        })}
      </svg>

      {punto && (
        <div
          className="tarjeta pointer-events-none absolute top-2 min-w-52 p-3"
          style={{
            // Se corre al lado contrario cuando la columna está a la derecha,
            // para que el recuadro no se salga de la tarjeta.
            left: activo! < datos.length / 2 ? "55%" : undefined,
            right: activo! < datos.length / 2 ? undefined : "55%",
          }}
        >
          <p className="mb-2 text-base font-medium">{punto.mes}</p>
          <ul className="space-y-1">
            {SERIES.map((serie) => (
              <li
                key={serie.clave}
                className="flex items-center justify-between gap-4 text-base"
              >
                <span className="flex items-center gap-2 text-muted-foreground">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: serie.color }}
                    aria-hidden="true"
                  />
                  {serie.nombre}
                </span>
                <span className="tabular">{moneda.format(punto[serie.clave])}</span>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex items-center justify-between gap-4 border-t pt-2 text-base">
            <span className="text-muted-foreground">Total</span>
            <span className="tabular font-medium">
              {moneda.format(punto.central + punto.aserradero)}
            </span>
          </div>
        </div>
      )}

      <ul className="mt-3 flex items-center justify-center gap-5">
        {SERIES.map((serie) => (
          <li
            key={serie.clave}
            className="flex items-center gap-2 text-base text-muted-foreground"
          >
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: serie.color }}
              aria-hidden="true"
            />
            {serie.nombre}
          </li>
        ))}
      </ul>

      {/* El mismo dato como tabla, para lector de pantalla. Un gráfico con
          `role="img"` y una etiqueta solo dice de qué es; no da los números. */}
      <table className="sr-only">
        <caption>Ventas por sucursal, últimos {datos.length} meses</caption>
        <thead>
          <tr>
            <th scope="col">Mes</th>
            {SERIES.map((s) => (
              <th key={s.clave} scope="col">
                {s.nombre}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {datos.map((d) => (
            <tr key={d.mes}>
              <th scope="row">{d.mes}</th>
              {SERIES.map((s) => (
                <td key={s.clave}>{moneda.format(d[s.clave])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
