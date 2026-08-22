/**
 * Formatos del panel.
 *
 * La implementación vive en `lib/formato.ts`, compartida con el sitio público y
 * el portal del cliente. Este archivo queda como puerta de entrada para las
 * pantallas del panel, que ya importaban desde acá.
 */
export {
  fechaCorta,
  fechaHora,
  fechaLarga,
  formatearCuit,
  formatearMonto,
  haceCuanto,
  hora,
  moneda,
  plural,
} from "@/lib/formato";
