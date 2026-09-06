import { desagregar, redondear } from "@/lib/fiscal/impuestos";

/**
 * Cómo se presenta un precio, según a quién se le muestra.
 *
 * Lógica pura y sin base de datos: quién es el que mira lo resuelve
 * `vistaDePrecio()` en el DAL, y acá solo se decide qué número va grande y qué
 * número va chico.
 *
 * **La regla que no se puede romper:** el precio guardado es siempre el final,
 * con IVA incluido, y es el que se cobra y el que se factura. Esta función no
 * cambia ningún importe: parte el mismo número en dos formas de mostrarlo. Si
 * alguna vez el neto que sale de acá terminara en un carrito o en una factura,
 * cada venta a un profesional saldría un 21 % barata.
 */
export type VistaDePrecio = "final" | "neto";

export interface PrecioPresentado {
  /** El número grande. */
  principal: number;
  /** Lo que va pegado al número grande: "+ IVA", o nada. */
  sufijo: string;
  /** El número chico de abajo, ya con su etiqueta. */
  secundario: { etiqueta: string; monto: number };
}

export function presentarPrecio(
  precioFinal: number,
  alicuota: number,
  vista: VistaDePrecio,
): PrecioPresentado {
  const { neto } = desagregar(precioFinal, alicuota);

  if (vista === "neto") {
    return {
      principal: neto,
      sufijo: "+ IVA",
      secundario: { etiqueta: "Final con IVA", monto: redondear(precioFinal) },
    };
  }

  return {
    principal: redondear(precioFinal),
    sufijo: "",
    // Ley 27.743: al consumidor final hay que informarle el neto junto al
    // precio que paga.
    secundario: { etiqueta: "Sin impuestos nacionales", monto: neto },
  };
}

/**
 * El precio tachado de una oferta, en la misma vista que el principal.
 *
 * Sin esto, una oferta vista por un profesional mostraría el neto nuevo
 * tachado contra el final viejo: un descuento que parece del 21 % más de lo
 * que es.
 */
export function presentarComparado(
  precioAnterior: number,
  alicuota: number,
  vista: VistaDePrecio,
): number {
  if (vista === "neto") return desagregar(precioAnterior, alicuota).neto;
  return redondear(precioAnterior);
}
