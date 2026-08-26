import { sinImpuestosNacionales } from "@/lib/fiscal/impuestos";
import { moneda } from "@/lib/formato";

/**
 * Precio sin impuestos nacionales, en letra chica bajo el precio final.
 *
 * La ley 27.743 obliga a informarlo en la venta a consumidores finales. El
 * número grande sigue siendo el precio final, que es el que se paga: este es un
 * dato adicional, no una segunda lista de precios.
 *
 * Sale de la misma función que usa la facturación, así que el neto que se
 * informa acá es exactamente el que después aparece en la factura.
 */
export function PrecioSinImpuestos({
  precioFinal,
  alicuota = 21,
  className = "",
}: {
  precioFinal: number | null;
  alicuota?: number;
  className?: string;
}) {
  if (!precioFinal || precioFinal <= 0) return null;

  const neto = sinImpuestosNacionales(precioFinal, alicuota);

  return (
    <p className={`text-xs leading-tight text-muted-foreground ${className}`}>
      Sin impuestos nacionales:{" "}
      <span className="tabular">{moneda.format(neto)}</span>
    </p>
  );
}
