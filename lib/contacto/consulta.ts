/**
 * Los motivos del formulario de contacto y el texto con el que se abre
 * WhatsApp cuando el correo no salió (corrección de T5).
 *
 * Mientras el correo no esté conectado, toda consulta vuelve como
 * «simulada» y el formulario ofrece WhatsApp en verde lleno. Ese botón abría
 * un chat vacío: quien había escrito desde el celular el motivo, su nombre y
 * las medidas tenía que tipear todo de nuevo. Ahora el chat se abre con lo
 * que ya escribió.
 */

export const MOTIVOS = [
  { valor: "presupuesto", etiqueta: "Pedido de presupuesto" },
  { valor: "stock", etiqueta: "Consulta de stock" },
  { valor: "envio", etiqueta: "Envíos y entregas" },
  { valor: "corte", etiqueta: "Servicio de corte" },
  { valor: "profesional", etiqueta: "Cuenta de profesional" },
  { valor: "otro", etiqueta: "Otra consulta" },
] as const;

/**
 * «Hola! Soy Juan. Pedido de presupuesto: 12 placas de fenólico…».
 *
 * Sin mensaje no hay nada que llevar: `null`, y el botón abre el chat como
 * siempre. El teléfono y el correo no van: quien escribe por WhatsApp ya está
 * dando su número.
 */
export function textoDeContacto(valores: Record<string, string> | undefined): string | null {
  const mensaje = valores?.mensaje?.trim();
  if (!mensaje) return null;
  const nombre = valores?.nombre?.trim();
  const motivo = MOTIVOS.find((m) => m.valor === valores?.motivo)?.etiqueta;
  return `Hola!${nombre ? ` Soy ${nombre}.` : ""} ${motivo ? `${motivo}: ` : ""}${mensaje}`;
}
