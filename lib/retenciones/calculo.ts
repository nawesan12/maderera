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
  /** La provincia, en los regímenes de Ingresos Brutos. Nulo en los nacionales. */
  jurisdiccion?: string | null;
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

/*
 * El cálculo (calcularRetencion) se mudó a Go con los pagos a proveedores
 * (backend/internal/compras/cuentas.go). Acá quedan la forma de un régimen y
 * los valores con los que se siembra la tabla.
 */

/**
 * Los regímenes que usa una maderera, con los valores vigentes al arranque.
 *
 * Son **valores iniciales, no la verdad**: ARCA los actualiza por resolución y
 * la ficha de la base es la que manda. Están acá para poder sembrar la tabla y
 * para que se vea qué forma tiene cada uno.
 */
export const REGIMENES_INICIALES: RegimenDeRetencion[] = [
  /*
   * **Hoy la maderera solo retiene Ingresos Brutos.**
   *
   * Lo dijo la clienta: «en pagos ya no les retienen tantos impuestos, solo
   * retienen ingresos brutos, puede cambiar a futuro, dejar en 0 los demás sin
   * borrarlos». Por eso los tres nacionales quedan con alícuota cero en vez de
   * desaparecer: el día que vuelvan a corresponder se cambia el número desde
   * /admin/arca/retenciones y el régimen ya está, con su código y su mínimo.
   *
   * Un régimen en cero no retiene nada —el cálculo multiplica por la alícuota—
   * pero sigue apareciendo en la pantalla, que es lo que permite ver que existe
   * y está apagado, en vez de que nadie sepa que alguna vez se retuvo.
   */
  {
    codigo: "IIBB-MI",
    nombre: "Ingresos Brutos · Misiones",
    impuesto: "iibb",
    jurisdiccion: "Misiones",
    alicuota: 1.5,
    alicuotaNoInscripto: 3,
    minimoNoImponible: 0,
    minimoRetencion: 0,
  },
  {
    codigo: "IIBB-BA",
    nombre: "Ingresos Brutos · Buenos Aires",
    impuesto: "iibb",
    jurisdiccion: "Buenos Aires",
    // En cero hasta que corresponda: la maderera retiene en Misiones, y esto
    // queda cargado porque el convenio multilateral lo puede exigir mañana.
    alicuota: 0,
    alicuotaNoInscripto: 0,
    minimoNoImponible: 0,
    minimoRetencion: 0,
  },
  {
    codigo: "78",
    nombre: "Ganancias · compra de bienes",
    impuesto: "ganancias",
    alicuota: 0,
    alicuotaNoInscripto: 0,
    minimoNoImponible: 224_000,
    minimoRetencion: 21_000,
  },
  {
    codigo: "94",
    nombre: "Ganancias · locaciones y servicios",
    impuesto: "ganancias",
    alicuota: 0,
    alicuotaNoInscripto: 0,
    minimoNoImponible: 67_170,
    minimoRetencion: 21_000,
  },
  {
    codigo: "499",
    nombre: "IVA · compra de bienes",
    impuesto: "iva",
    alicuota: 0,
    alicuotaNoInscripto: 0,
    minimoNoImponible: 0,
    minimoRetencion: 0,
  },
  {
    codigo: "SUSS",
    nombre: "SUSS · servicios de construcción",
    impuesto: "suss",
    alicuota: 0,
    alicuotaNoInscripto: 0,
    minimoNoImponible: 0,
    minimoRetencion: 0,
  },
];
