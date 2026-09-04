/**
 * Cálculo de retenciones impositivas.
 *
 * Sin base de datos y sin `server-only`: es aritmética con reglas, y por eso se
 * puede probar. **Es la parte más normativa del sistema y la que más se
 * equivoca a mano.**
 *
 * El error clásico no está en la multiplicación: está en **mirar cada pago
 * suelto en vez del acumulado del mes**. Con el mínimo no imponible de
 * Ganancias, cuatro pagos chicos no retienen nada mirados de a uno y sí
 * retienen mirados juntos, que es como los mira ARCA. Un sistema que calcula
 * pago por pago deja de retener todo el año y el ajuste llega con intereses.
 *
 * Las alícuotas y los mínimos **son datos, no constantes de este archivo**: los
 * actualiza ARCA por resolución y quedan en la ficha del régimen para que
 * cambiarlos no sea un deploy.
 */

export interface RegimenDeRetencion {
  /** El código del régimen, que va en el certificado. */
  codigo: string;
  nombre: string;
  impuesto: "ganancias" | "iva" | "suss" | "iibb";
  /** Para quien está inscripto en el régimen. */
  alicuota: number;
  /** Agravada, para el que no lo está. */
  alicuotaNoInscripto: number;
  /**
   * Se resta del **acumulado del mes**, no de cada pago. Cero si el régimen no
   * tiene mínimo, como el de IVA.
   */
  minimoNoImponible: number;
  /** Por debajo de este importe no se retiene nada. */
  minimoRetencion: number;
}

export interface EntradaDeRetencion {
  /** La base del pago de ahora. Qué es depende del régimen: neto, IVA, total. */
  base: number;
  /** Lo ya pagado a este proveedor en el mes, por el mismo régimen. */
  acumuladoMes: number;
  /** Lo ya retenido en el mes por este régimen. */
  retenidoMes: number;
  regimen: RegimenDeRetencion;
  /** Si el proveedor está inscripto en el régimen. */
  inscripto: boolean;
}

export interface ResultadoRetencion {
  /** Sobre cuánto se calculó, ya descontado el mínimo no imponible. */
  imponible: number;
  alicuota: number;
  /** Lo que hay que retener en **este** pago. Nunca negativo. */
  retencion: number;
  /** Por qué no se retuvo, cuando la retención dio cero. */
  motivo: string | null;
}

function aCentavos(valor: number): number {
  return Math.round(valor * 100) / 100;
}

export function calcularRetencion(
  entrada: EntradaDeRetencion,
): ResultadoRetencion {
  const { regimen, inscripto } = entrada;

  const alicuota = inscripto ? regimen.alicuota : regimen.alicuotaNoInscripto;

  /*
   * Al no inscripto no se le aplica el mínimo no imponible: se le retiene sobre
   * el total y a la alícuota agravada. Aplicarle el mínimo del inscripto es de
   * los errores que ARCA reclama con intereses.
   */
  const minimo = inscripto ? regimen.minimoNoImponible : 0;

  const acumulado = Math.max(0, entrada.acumuladoMes + entrada.base);
  const imponible = aCentavos(Math.max(0, acumulado - minimo));

  if (imponible === 0) {
    return {
      imponible: 0,
      alicuota,
      retencion: 0,
      motivo:
        minimo > 0
          ? "No llega al mínimo no imponible del régimen."
          : "No hay base sobre la que retener.",
    };
  }

  /*
   * La retención se calcula sobre **todo el acumulado** y después se resta lo
   * ya retenido. Sin esa resta, el segundo pago del mes vuelve a retener sobre
   * la misma base y el proveedor cobra de menos.
   */
  const acumuladaDelMes = aCentavos((imponible * alicuota) / 100);
  const aRetener = aCentavos(acumuladaDelMes - entrada.retenidoMes);

  // Puede dar negativo si una nota de crédito bajó el acumulado por debajo de
  // lo ya retenido. No se devuelve plata: la corrección la hace el proveedor en
  // su declaración.
  if (aRetener <= 0) {
    return {
      imponible,
      alicuota,
      retencion: 0,
      motivo: "Ya se retuvo lo que correspondía este mes.",
    };
  }

  if (aRetener < regimen.minimoRetencion) {
    return {
      imponible,
      alicuota,
      retencion: 0,
      motivo: "No llega al mínimo de retención del régimen.",
    };
  }

  return { imponible, alicuota, retencion: aRetener, motivo: null };
}

/**
 * Los regímenes que usa una maderera, con los valores vigentes al arranque.
 *
 * Son **valores iniciales, no la verdad**: ARCA los actualiza por resolución y
 * la ficha de la base es la que manda. Están acá para poder sembrar la tabla y
 * para que se vea qué forma tiene cada uno.
 */
export const REGIMENES_INICIALES: RegimenDeRetencion[] = [
  {
    codigo: "78",
    nombre: "Ganancias · compra de bienes",
    impuesto: "ganancias",
    alicuota: 2,
    alicuotaNoInscripto: 28,
    minimoNoImponible: 224_000,
    minimoRetencion: 21_000,
  },
  {
    codigo: "94",
    nombre: "Ganancias · locaciones y servicios",
    impuesto: "ganancias",
    alicuota: 2,
    alicuotaNoInscripto: 28,
    minimoNoImponible: 67_170,
    minimoRetencion: 21_000,
  },
  {
    codigo: "499",
    nombre: "IVA · compra de bienes",
    impuesto: "iva",
    alicuota: 8.68,
    alicuotaNoInscripto: 10.5,
    minimoNoImponible: 0,
    minimoRetencion: 0,
  },
  {
    codigo: "SUSS",
    nombre: "SUSS · servicios de construcción",
    impuesto: "suss",
    alicuota: 1.2,
    alicuotaNoInscripto: 1.2,
    minimoNoImponible: 0,
    minimoRetencion: 0,
  },
];
