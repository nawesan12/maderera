/**
 * La fecha y la hora de una firma, en hora de Argentina.
 *
 * Es `fechaHora` de lib/formato.ts con la zona fija. El contenedor de Next
 * corre en UTC: la constancia de la firma (la página del enlace y el correo
 * «remito firmado») decía las 03:05 por las 00:05, y desde las 21 la fecha
 * de mañana. El PDF del remito ya la escribe en hora argentina (Go).
 */
export const fechaHoraDeFirma = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "America/Argentina/Buenos_Aires",
});

/** La fecha del remito impreso («29/10/26»), en hora de Argentina como el PDF. */
export const fechaDelRemito = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
  timeZone: "America/Argentina/Buenos_Aires",
});
