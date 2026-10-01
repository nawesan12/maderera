import { disponible as calcularDisponible, type StockLevel } from "@/lib/stock-level";
import { formatearCantidad, formatearLargo, piezasDeMetros } from "@/lib/unidades";

/**
 * Nivel de stock de una sucursal.
 *
 * La barra muestra la cantidad contra el mínimo de reposición, que es la
 * comparación que importa: veinte placas pueden ser mucho o poco según lo que
 * se venda de ese producto. El número solo no dice si hay que reponer; la barra
 * sí, y sin leer.
 *
 * La escala llega hasta tres veces el mínimo. Más arriba de eso ya no cambia
 * nada la decisión, y estirar la escala aplastaría justo la zona donde se
 * decide.
 *
 * **El número grande es el disponible, no el físico.** Es lo que se puede
 * vender, que es la pregunta que se hace quien mira esta pantalla. El físico
 * aparece abajo, en chico, y solo cuando hay algo reservado: si no, sería un
 * número repetido.
 */
export function NivelStock({
  sucursal,
  cantidad,
  reservado = 0,
  minimo,
  nivel,
  unidad,
  largoMm,
}: {
  sucursal: string;
  /** Físico: lo que hay en el galpón. */
  cantidad: number;
  /** Comprometido en pedidos sin retirar. */
  reservado?: number;
  minimo: number;
  nivel: StockLevel;
  unidad?: string;
  /**
   * Largo de la pieza del metro lineal. Con él, «28,8» se lee además como
   * «12 piezas de 2,40», que es lo que se encuentra al ir a contar.
   */
  largoMm?: number | null;
}) {
  const libre = calcularDisponible(cantidad, reservado);
  const enPiezas = largoMm && libre > 0 ? piezasDeMetros(libre, largoMm) : null;
  const tope = Math.max(minimo * 3, 1);
  const porcentaje = Math.min((libre / tope) * 100, 100);

  const color =
    nivel === "sin-stock"
      ? "bg-border"
      : nivel === "bajo"
        ? "bg-brand-orange"
        : nivel === "medio"
          ? "bg-amber-400"
          : "bg-green-600";

  const texto =
    nivel === "sin-stock"
      ? "Sin stock"
      : nivel === "bajo"
        ? "Hay que reponer"
        : nivel === "medio"
          ? "Va bajando"
          : "Bien";

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-muted-foreground">{sucursal}</span>
        <span
          className={`tabular text-lg font-semibold ${
            nivel === "sin-stock"
              ? "text-muted-foreground"
              : nivel === "bajo"
                ? "text-brand-orange"
                : ""
          }`}
        >
          {formatearCantidad(libre)}
        </span>
      </div>

      <div
        className="mt-1 h-2 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`${sucursal}: ${formatearCantidad(libre)} ${unidad ?? "unidades"} disponibles${reservado > 0 ? ` de ${formatearCantidad(cantidad)} en el galpón` : ""}, mínimo ${formatearCantidad(minimo)}. ${texto}.`}
      >
        <div
          className={`h-full rounded-full transition-[width] ${color}`}
          style={{ width: `${Math.max(porcentaje, libre > 0 ? 4 : 0)}%` }}
        />
      </div>

      <p className="mt-1 flex items-baseline justify-between gap-2 text-sm">
        <span
          className={
            nivel === "bajo" || nivel === "sin-stock"
              ? "text-brand-orange"
              : "text-muted-foreground"
          }
        >
          {texto}
        </span>
        {minimo > 0 && (
          <span className="tabular text-muted-foreground">
            mín. {formatearCantidad(minimo)}
          </span>
        )}
      </p>

      {enPiezas && (
        <p className="tabular mt-0.5 text-sm text-muted-foreground">
          {enPiezas.piezas} × {formatearLargo(largoMm!)}
          {enPiezas.resto > 0 ? ` + ${formatearCantidad(enPiezas.resto)} m` : ""}
        </p>
      )}

      {reservado > 0 && (
        <p className="tabular mt-0.5 text-sm text-muted-foreground">
          {formatearCantidad(cantidad)} en el galpón · {formatearCantidad(reservado)} vendido
          {reservado === 1 ? "" : "s"} sin retirar
        </p>
      )}
    </div>
  );
}
