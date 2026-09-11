import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Sparkline } from "./sparkline";
import { AnimatedCounter } from "@/components/animated-counter";

export interface SegmentoIndicador {
  /** Qué es esta parte del total. */
  titulo: string;
  valor: number;
  /** Color de la porción y de su punto en la leyenda. */
  color: string;
}

/**
 * Tarjeta de indicador del resumen.
 *
 * El número es lo único que crece: todo lo demás —etiqueta, variación, serie,
 * desglose— queda por debajo en tamaño y en peso, para que la lectura de un
 * vistazo caiga siempre en el mismo lugar de cada tarjeta.
 *
 * La variación dice contra qué se compara. Un "+12,5%" solo no significa nada si
 * no se sabe respecto de qué.
 *
 * **Con `href`, la tarjeta entera es un enlace.** Un indicador contesta una
 * pregunta y enseguida provoca la siguiente: "14 presupuestos abiertos" ya
 * viene con "¿cuáles?" pegado atrás. Sin enlace había que leer el número, ir
 * al menú, entrar a la pantalla y volver a filtrar hasta reencontrar esos
 * catorce. Va al listado **ya acotado a lo que el número cuenta**, no a la
 * sección: si la tarjeta dice 14, la pantalla que se abre tiene que mostrar 14.
 *
 * El desglose responde la pregunta que sigue al número. "8 clientes" no dice
 * nada; "8 clientes, 3 con pedido en curso" sí. Va como barra y como leyenda:
 * la barra se escanea, la leyenda se lee, y ninguna de las dos depende de
 * distinguir colores para entenderse.
 */
export function TarjetaIndicador({
  etiqueta,
  valor,
  valorNumerico,
  formatoValor,
  variacion,
  comparadoCon = "el mes pasado",
  icono: Icono,
  serie,
  colorSerie,
  segmentos,
  pie,
  href,
  destacado = false,
}: {
  etiqueta: string;
  valor: string;
  /** Si viene, el número cuenta desde cero al entrar en pantalla. */
  valorNumerico?: number;
  /** Cómo se escribe el número mientras cuenta. Por omisión, entero. */
  formatoValor?: "moneda";
  variacion?: string;
  comparadoCon?: string;
  icono: LucideIcon;
  serie?: number[];
  colorSerie?: string;
  segmentos?: SegmentoIndicador[];
  /** Una línea de contexto al pie: el desglose que uno busca al ver el número. */
  pie?: React.ReactNode;
  /** El listado que muestra exactamente lo que este número cuenta. */
  href?: string;
  destacado?: boolean;
}) {
  const numero = variacion ? Number(variacion.replace(/[^\d.,-]/g, "").replace(",", ".")) : 0;
  const sube = variacion ? numero > 0 : false;
  const baja = variacion ? numero < 0 : false;
  const FlechaVariacion = sube ? ArrowUpRight : baja ? ArrowDownRight : Minus;

  const totalSegmentos = segmentos?.reduce((s, x) => s + x.valor, 0) ?? 0;

  const cuerpo = (
    <>
      <div className="flex items-center justify-between gap-2.5">
        <h3 className="text-[13px] font-semibold uppercase tracking-[0.07em] text-texto-2">
          {etiqueta}
        </h3>
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
            destacado
              ? "bg-brand-orange/12 text-acento-texto"
              : "bg-hundida text-texto-2"
          }`}
        >
          <Icono className="h-5 w-5" />
        </span>
      </div>

      <p className="tabular mt-3.5 text-[30px] font-semibold leading-none tracking-[-0.03em]">
        {valorNumerico !== undefined ? (
          <AnimatedCounter
            target={valorNumerico}
            duration={0.9}
            formato={formatoValor}
          />
        ) : (
          valor
        )}
      </p>

      {variacion && (
        <p className="mt-2 flex items-center gap-1 whitespace-nowrap text-[13px] text-texto-2">
          <FlechaVariacion
            className={`h-4 w-4 ${
              sube
                ? "text-saldo-favor"
                : baja
                  ? "text-acento-texto"
                  : "text-texto-3"
            }`}
            aria-hidden="true"
          />
          <span className="tabular">{variacion}</span>
          <span>vs. {comparadoCon}</span>
        </p>
      )}

      {serie && serie.length > 1 && (
        <div className="mt-3.5">
          <Sparkline
            valores={serie}
            color={colorSerie}
            etiqueta={etiqueta}
            ancho={220}
            alto={42}
          />
        </div>
      )}

      {segmentos && totalSegmentos > 0 && (
        <div className="mt-4">
          <div className="flex h-2 gap-[3px]" aria-hidden="true">
            {segmentos.map((s) => (
              <span
                key={s.titulo}
                className="rounded-full"
                style={{
                  width: `${(s.valor / totalSegmentos) * 100}%`,
                  backgroundColor: s.color,
                }}
              />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
            {segmentos.map((s) => (
              <span
                key={s.titulo}
                className="flex items-center gap-1.5 text-[12.5px] text-texto-2"
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: s.color }}
                  aria-hidden="true"
                />
                <span className="tabular">{s.valor}</span> {s.titulo}
              </span>
            ))}
          </div>
        </div>
      )}

      {pie && (
        <p className="mt-auto border-t border-linea-suave pt-3 text-[13px] text-texto-2">
          {pie}
        </p>
      )}
    </>
  );

  const clases = `tarjeta tarjeta-activa flex flex-col p-5${
    href
      ? " transition-colors hover:border-brand-orange/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
      : ""
  }`;

  /*
   * El enlace envuelve la tarjeta entera y no solo el número: el área clickeable
   * tiene que ser la que el ojo ya identificó como "una cosa". Un enlace del
   * tamaño del número obliga a apuntar, y el panel lo usa gente que no quiere
   * apuntar.
   */
  if (href) {
    return (
      <Link href={href} className={clases}>
        {cuerpo}
      </Link>
    );
  }

  return <article className={clases}>{cuerpo}</article>;
}
