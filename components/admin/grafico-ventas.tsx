"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

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

function Tooltipe({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  const total = payload.reduce((suma, p) => suma + p.value, 0);

  return (
    <div className="tarjeta min-w-52 p-3">
      <p className="mb-2 text-base font-medium">{label}</p>
      <ul className="space-y-1">
        {payload.map((serie) => (
          <li
            key={serie.name}
            className="flex items-center justify-between gap-4 text-base"
          >
            <span className="flex items-center gap-2 text-muted-foreground">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: serie.color }}
                aria-hidden="true"
              />
              {serie.name}
            </span>
            <span className="tabular">{moneda.format(serie.value)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center justify-between gap-4 border-t pt-2 text-base">
        <span className="text-muted-foreground">Total</span>
        <span className="tabular font-medium">{moneda.format(total)}</span>
      </div>
    </div>
  );
}

/**
 * Leyenda propia, en el mismo orden en que se dibujan las barras. La de la
 * librería las ordena por su cuenta, y una leyenda invertida obliga a traducir
 * cada color antes de leer el gráfico.
 */
function Leyenda() {
  return (
    <ul className="flex items-center justify-center gap-5">
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
  );
}

export function GraficoVentas({ datos }: { datos: Punto[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart
        data={datos}
        margin={{ top: 8, right: 8, left: 8, bottom: 0 }}
        barGap={2}
        barCategoryGap="28%"
      >
        <CartesianGrid
          vertical={false}
          stroke="var(--border)"
          strokeDasharray="0"
        />
        <XAxis
          dataKey="mes"
          tickLine={false}
          axisLine={false}
          tick={{ fill: "var(--muted-foreground)", fontSize: 14 }}
          dy={8}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tick={{ fill: "var(--muted-foreground)", fontSize: 13 }}
          tickFormatter={abreviar}
          width={64}
        />
        <Tooltip
          content={<Tooltipe />}
          cursor={{ fill: "var(--muted)", opacity: 0.5 }}
        />
        <Legend verticalAlign="bottom" height={36} content={<Leyenda />} />
        {SERIES.map((serie) => (
          <Bar
            key={serie.clave}
            dataKey={serie.clave}
            name={serie.nombre}
            fill={serie.color}
            radius={[4, 4, 0, 0]}
            maxBarSize={26}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
