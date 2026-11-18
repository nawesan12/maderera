/**
 * Lo que la página de profesionales promete, según el interruptor de la
 * tienda (hallazgo 28 del comité, 18/11/2026).
 *
 * Con la tienda apagada nadie ve precios, ni de público ni de lista: «Precios
 * de gremio» era una promesa que el sitio no podía cumplir. Se muestra lo que
 * sí funciona, y el presupuesto va a WhatsApp con el pedido ya escrito.
 *
 * **El presupuesto va sin plazo** con la tienda apagada: «en 24 h» era una
 * promesa a nombre de la clienta que nadie confirmó, y apagada pasa a ser la
 * oferta principal de la página. Con la tienda encendida queda como estaba.
 *
 * Los íconos los pone la página (`clave`): esto se prueba sin React.
 */
export interface Beneficio {
  clave: "precios" | "cuenta" | "presupuesto" | "documentacion";
  titulo: string;
  detalle: string;
  /** A dónde lleva la tarjeta: hoy solo el presupuesto, a WhatsApp. */
  aWhatsapp?: boolean;
}

/** El texto con el que se abre WhatsApp desde «Presupuesto por WhatsApp». */
export const TEXTO_PRESUPUESTO_PROFESIONAL =
  "Hola! Soy profesional y quería pedir presupuesto para una obra. Les paso la lista:";

export function beneficiosDelProfesional(tiendaActiva: boolean): Beneficio[] {
  if (tiendaActiva) {
    return [
      { clave: "precios", titulo: "Precios de gremio", detalle: "Tu propia lista de precios." },
      { clave: "cuenta", titulo: "Cuenta corriente", detalle: "Comprás ahora y pagás después." },
      { clave: "presupuesto", titulo: "Presupuesto en 24 h", detalle: "Mandás la lista de la obra y te contestamos." },
      { clave: "documentacion", titulo: "Documentación técnica", detalle: "Fichas y tablas de carga para el pliego." },
    ];
  }
  return [
    {
      clave: "presupuesto",
      titulo: "Presupuesto por WhatsApp",
      detalle: "Mandás la lista de la obra y te la cotizamos.",
      aWhatsapp: true,
    },
    { clave: "cuenta", titulo: "Cuenta corriente", detalle: "Comprás ahora y pagás después." },
    { clave: "documentacion", titulo: "Documentación técnica", detalle: "Fichas y tablas de carga para el pliego." },
  ];
}

/** La bajada del encabezado, con la misma regla. */
export function bajadaDelProfesional(tiendaActiva: boolean): string {
  return tiendaActiva
    ? "Precios de gremio, cuenta corriente y documentación técnica."
    : "Cuenta corriente, presupuestos y documentación técnica.";
}
