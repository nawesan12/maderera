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
 *
 * `compacto` es la variante de la tarjeta del catálogo, donde el dato compite
 * por lugar con el precio. El diseño lo pedía a 8,5px; va a 10,5px, que es el
 * piso en el que un dato obligatorio se sigue leyendo. A 8,5px la línea existe
 * pero no cumple: informar es poder leerlo.
 */
export function PrecioSinImpuestos({
  precioFinal,
  alicuota = 21,
  compacto = false,
  className = "",
}: {
  precioFinal: number | null;
  alicuota?: number;
  compacto?: boolean;
  className?: string;
}) {
  if (!precioFinal || precioFinal <= 0) return null;

  const neto = sinImpuestosNacionales(precioFinal, alicuota);

  return (
    <p
      className={`leading-tight text-texto-3 ${
        compacto
          ? "overflow-hidden text-ellipsis whitespace-nowrap text-[10.5px]"
          : "text-xs"
      } ${className}`}
    >
      Sin impuestos nacionales:{" "}
      <span className="tabular">{moneda.format(neto)}</span>
    </p>
  );
}
