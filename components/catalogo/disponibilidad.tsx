import type { StockLevel } from "@/lib/stock-level";
import { combinedStockLevel } from "@/lib/stock-level";
import { formatearCantidad } from "@/lib/unidades";

/**
 * Disponibilidad de un producto para quien compra.
 *
 * Deliberadamente no dice en qué sucursal hay: al cliente le importa si puede
 * comprarlo, no cómo está repartida la mercadería entre los depósitos. Eso es
 * un dato interno y ocupaba dos líneas de la tarjeta para no responder nada.
 *
 * Dónde retirarlo se resuelve en el carrito, que es cuando la sucursal
 * empieza a importar.
 *
 * **Cuando quedan pocas, dice cuántas.** Lo pidió la clienta como promoción:
 * "quedan 3" apura a quien está decidiendo mucho más que "quedan pocas". El
 * número aparece solo en ese nivel y no en los otros dos: con stock alto no
 * promociona nada y sí le dice a la competencia cuánto hay en el galpón.
 */
export function Disponibilidad({
  central,
  aserradero,
  cantidad,
  compacto = false,
}: {
  central: StockLevel;
  aserradero: StockLevel;
  /** Unidades disponibles. Solo se muestra si quedan pocas. */
  cantidad?: number;
  compacto?: boolean;
}) {
  const nivel = combinedStockLevel([central, aserradero]);

  const estilo = {
    alto: { punto: "bg-brand-green", texto: "Disponible", color: "" },
    medio: {
      punto: "bg-amber-500",
      texto: "Últimas unidades",
      color: "text-amber-700",
    },
    bajo: {
      punto: "bg-brand-orange",
      texto:
        cantidad !== undefined && cantidad > 0
          ? `¡Quedan ${formatearCantidad(cantidad)}!`
          : "Quedan pocas",
      color: "text-acento-texto",
    },
    "sin-stock": {
      punto: "bg-muted-foreground/40",
      texto: "Sin stock",
      color: "text-muted-foreground",
    },
  }[nivel];

  return (
    <p
      className={`flex items-center gap-1.5 ${
        compacto ? "text-xs" : "text-sm"
      } ${estilo.color}`}
    >
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${estilo.punto}`}
        aria-hidden="true"
      />
      {estilo.texto}
    </p>
  );
}

/**
 * Hay o no hay, en cada sucursal, sin cantidades (notas del 9/11/2026: la
 * ficha dice dónde retirarlo). Lo usa la ficha con `stock_visible` encendido.
 */
export function DisponibilidadPorSucursal({
  central,
  aserradero,
}: {
  central: StockLevel;
  aserradero: StockLevel;
}) {
  const fila = (nombre: string, nivel: StockLevel) => {
    const hay = nivel !== "sin-stock";
    return (
      <li className="flex items-center justify-between gap-3">
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
  };
  return (
    <ul className="space-y-1.5 text-sm">
      {fila("Casa Central", central)}
      {fila("Aserradero", aserradero)}
    </ul>
  );
}
