import type { StockLevel } from "@/lib/stock-level";

/**
 * Hay o no hay, en cada sucursal activa, sin cantidades (notas del 9/11/2026:
 * la ficha dice dónde retirarlo). Las sucursales vienen de `branches`, en su
 * orden: una nueva aparece sola (hallazgo 35). Lo usa la ficha con
 * `stock_visible` encendido.
 */
export function DisponibilidadPorSucursal({
  stock,
}: {
  stock: readonly { sucursal: string; nombre: string; nivel: StockLevel }[];
}) {
  return (
    <ul className="space-y-1.5 text-sm">
      {stock.map(({ sucursal, nombre, nivel }) => {
        const hay = nivel !== "sin-stock";
        return (
          <li key={sucursal} className="flex items-center justify-between gap-3">
            <span>{nombre}</span>
            <span className={`flex items-center gap-1.5 ${hay ? "" : "text-muted-foreground"}`}>
              <span
                className={`h-2 w-2 rounded-full ${hay ? "bg-brand-green" : "bg-muted-foreground/40"}`}
                aria-hidden="true"
              />
              {hay ? (nivel === "bajo" ? "Quedan pocas" : "Hay") : "Sin stock"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
