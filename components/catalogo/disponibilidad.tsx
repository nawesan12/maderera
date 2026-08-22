import type { StockLevel } from "@/lib/stock-level";
import { combinedStockLevel } from "@/lib/stock-level";

/**
 * Disponibilidad de un producto para quien compra.
 *
 * Deliberadamente no dice en qué sucursal hay: al cliente le importa si puede
 * comprarlo, no cómo está repartida la mercadería entre los depósitos. Eso es
 * un dato interno y ocupaba dos líneas de la tarjeta para no responder nada.
 *
 * Dónde retirarlo se resuelve en el checkout, que es cuando la sucursal
 * empieza a importar.
 */
export function Disponibilidad({
  central,
  aserradero,
  compacto = false,
}: {
  central: StockLevel;
  aserradero: StockLevel;
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
      texto: "Quedan pocas",
      color: "text-brand-orange",
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
