import { moneda } from "@/lib/formato";
import {
  presentarPrecio,
  type VistaDePrecio,
} from "@/lib/precios/vista";

/**
 * La línea chica que acompaña al precio grande.
 *
 * Qué dice depende de a quién se le muestra, y las dos formas son obligatorias
 * por motivos distintos:
 *
 * - Al **consumidor final** se le informa el neto: lo exige la ley 27.743.
 * - Al **gremio** se le informa el final, porque arriba está viendo el neto y
 *   necesita saber cuánto va a pagar.
 *
 * El número sale de la misma función que usa la facturación, así que el neto
 * que se informa acá es exactamente el que después aparece en la factura.
 *
 * `compacto` es la variante de la tarjeta del catálogo, donde el dato compite
 * por lugar con el precio. El diseño lo pedía a 8,5px; va a 10,5px, que es el
 * piso en el que un dato obligatorio se sigue leyendo. A 8,5px la línea existe
 * pero no cumple: informar es poder leerlo.
 */
export function PrecioSecundario({
  precioFinal,
  alicuota = 21,
  vista = "final",
  compacto = false,
  className = "",
}: {
  precioFinal: number | null;
  alicuota?: number;
  vista?: VistaDePrecio;
  compacto?: boolean;
  className?: string;
}) {
  if (!precioFinal || precioFinal <= 0) return null;

  const { secundario } = presentarPrecio(precioFinal, alicuota, vista);

  return (
    <p
      className={`leading-tight text-texto-3 ${
        compacto
          ? "overflow-hidden text-ellipsis whitespace-nowrap text-[10.5px]"
          : "text-xs"
      } ${className}`}
    >
      {secundario.etiqueta}:{" "}
      <span className="tabular">{moneda.format(secundario.monto)}</span>
    </p>
  );
}
