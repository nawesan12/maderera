import type { StockLevel } from "@/lib/stock-level";

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
 */
export function NivelStock({
  sucursal,
  cantidad,
  minimo,
  nivel,
  unidad,
}: {
  sucursal: string;
  cantidad: number;
  minimo: number;
  nivel: StockLevel;
  unidad?: string;
}) {
  const tope = Math.max(minimo * 3, 1);
  const porcentaje = Math.min((cantidad / tope) * 100, 100);

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
          {cantidad}
        </span>
      </div>

      <div
        className="mt-1 h-2 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`${sucursal}: ${cantidad} ${unidad ?? "unidades"}, mínimo ${minimo}. ${texto}.`}
      >
        <div
          className={`h-full rounded-full transition-[width] ${color}`}
          style={{ width: `${Math.max(porcentaje, cantidad > 0 ? 4 : 0)}%` }}
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
          <span className="tabular text-muted-foreground">mín. {minimo}</span>
        )}
      </p>
    </div>
  );
}
