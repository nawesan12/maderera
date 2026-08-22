/**
 * Sparkline de una serie.
 *
 * Va solo donde existe una serie real detrás. Un sparkline inventado para
 * rellenar una tarjeta miente sobre la forma del dato, que es justo lo que la
 * gente lee de un gráfico sin ejes.
 *
 * Sin ejes ni grilla a propósito: acompaña al número, no lo reemplaza. Para leer
 * valores exactos está el gráfico de abajo.
 */
export function Sparkline({
  valores,
  color = "var(--sucursal-central)",
  etiqueta,
  ancho = 132,
  alto = 34,
}: {
  valores: number[];
  color?: string;
  etiqueta: string;
  ancho?: number;
  alto?: number;
}) {
  if (valores.length < 2) return null;

  const max = Math.max(...valores);
  const min = Math.min(...valores);
  const rango = max - min || 1;
  const margen = 3;

  const punto = (valor: number, i: number) => {
    const x = (i / (valores.length - 1)) * (ancho - margen * 2) + margen;
    const y =
      alto - margen - ((valor - min) / rango) * (alto - margen * 2);
    return [x, y] as const;
  };

  const puntos = valores.map(punto);
  const linea = puntos.map(([x, y]) => `${x},${y}`).join(" ");
  const area = `${margen},${alto} ${linea} ${ancho - margen},${alto}`;
  const [ultimoX, ultimoY] = puntos[puntos.length - 1];
  const id = `spark-${etiqueta.replace(/\s+/g, "-").toLowerCase()}`;

  return (
    <svg
      width={ancho}
      height={alto}
      viewBox={`0 0 ${ancho} ${alto}`}
      role="img"
      aria-label={`${etiqueta}: evolución de los últimos ${valores.length} meses`}
      className="overflow-visible"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.16" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${id})`} />
      <polyline
        points={linea}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* El último valor es el que se está mirando, así que se ancla con un
          punto y un anillo del color de la superficie para que no se funda con
          la línea. */}
      <circle cx={ultimoX} cy={ultimoY} r="3.5" fill={color} />
      <circle
        cx={ultimoX}
        cy={ultimoY}
        r="3.5"
        fill="none"
        stroke="var(--card)"
        strokeWidth="2"
      />
    </svg>
  );
}
