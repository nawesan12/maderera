import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Sparkline } from "./sparkline";

/**
 * Tarjeta de indicador del resumen.
 *
 * El número es lo único que crece: todo lo demás —etiqueta, variación, serie—
 * queda por debajo en tamaño y en peso, para que la lectura de un vistazo caiga
 * siempre en el mismo lugar de cada tarjeta.
 *
 * La variación dice contra qué se compara. Un "+12,5%" solo no significa nada si
 * no se sabe respecto de qué.
 */
export function TarjetaIndicador({
  etiqueta,
  valor,
  variacion,
  comparadoCon = "el mes pasado",
  icono: Icono,
  serie,
  colorSerie,
  pie,
  destacado = false,
}: {
  etiqueta: string;
  valor: string;
  variacion?: string;
  comparadoCon?: string;
  icono: LucideIcon;
  serie?: number[];
  colorSerie?: string;
  /** Una línea de contexto al pie: el desglose que uno busca al ver el número. */
  pie?: React.ReactNode;
  destacado?: boolean;
}) {
  const numero = variacion ? Number(variacion.replace(/[^\d.,-]/g, "").replace(",", ".")) : 0;
  const sube = variacion ? numero > 0 : false;
  const baja = variacion ? numero < 0 : false;
  const FlechaVariacion = sube ? ArrowUpRight : baja ? ArrowDownRight : Minus;

  return (
    <article className="tarjeta tarjeta-activa flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            className={`flex h-9 w-9 items-center justify-center rounded-lg ${
              destacado
                ? "bg-brand-orange/12 text-brand-orange"
                : "bg-muted text-muted-foreground"
            }`}
          >
            <Icono className="h-5 w-5" />
          </span>
          <h3 className="text-base text-muted-foreground">{etiqueta}</h3>
        </div>
      </div>

      <p className="tabular text-3xl font-semibold leading-none">{valor}</p>

      <div className="mt-auto space-y-3">
        {variacion ? (
          <p className="flex items-center gap-1 whitespace-nowrap text-sm text-muted-foreground">
            <FlechaVariacion
              className={`h-4 w-4 ${
                sube
                  ? "text-green-700"
                  : baja
                    ? "text-brand-orange"
                    : "text-muted-foreground"
              }`}
              aria-hidden="true"
            />
            <span className="tabular">{variacion}</span>
            <span>vs. {comparadoCon}</span>
          </p>
        ) : null}

        {serie && serie.length > 1 && (
          <div className="-mb-1 flex justify-end">
            <Sparkline
              valores={serie}
              color={colorSerie}
              etiqueta={etiqueta}
              ancho={176}
              alto={30}
            />
          </div>
        )}

        {pie && (
          <p className="border-t pt-3 text-sm text-muted-foreground">{pie}</p>
        )}
      </div>
    </article>
  );
}
