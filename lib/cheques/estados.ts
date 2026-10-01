/**
 * Qué le puede pasar a un cheque, y qué significa para la cuenta del cliente.
 *
 * Vive aparte de la acción del servidor porque es la parte que tiene que ser
 * correcta y se puede probar sin base: una transición de más —un rechazado
 * que vuelve a la cartera— es plata que aparece o desaparece de una cuenta.
 */

export type EstadoDeCheque =
  | "informado"
  | "cartera"
  | "entregado"
  | "depositado"
  | "acreditado"
  | "rechazado"
  | "anulado";

/**
 * Las transiciones posibles. Los estados finales —acreditado, rechazado,
 * anulado— son finales.
 */
export const TRANSICIONES: Record<EstadoDeCheque, EstadoDeCheque[]> = {
  // Lo informó el cliente: se acepta al tenerlo en mano, o se rechaza.
  informado: ["cartera", "rechazado"],
  cartera: ["depositado", "entregado", "rechazado", "anulado"],
  depositado: ["acreditado", "rechazado"],
  entregado: ["acreditado", "rechazado"],
  acreditado: [],
  rechazado: [],
  anulado: [],
};

export function puedePasar(desde: EstadoDeCheque, hacia: EstadoDeCheque): boolean {
  return TRANSICIONES[desde]?.includes(hacia) ?? false;
}

/**
 * Qué le hace la transición a la cuenta corriente del cliente que lo dio.
 *
 * - `acreditar`: aceptar un cheque informado emite el recibo y baja la deuda.
 * - `debitar`: el banco rechazó un cheque que ya había bajado la deuda; la
 *   deuda vuelve con una nota de débito atada al cheque. Es lo que la clienta
 *   pidió: «que se plasme en el usuario final».
 * - `nada`: el cheque cambia de lugar pero la cuenta no —se deposita, se
 *   endosa, se acredita en el banco, o se rechaza uno que nunca se aceptó—.
 */
export function efectoEnLaCuenta(
  desde: EstadoDeCheque,
  hacia: EstadoDeCheque,
): "acreditar" | "debitar" | "nada" {
  if (desde === "informado" && hacia === "cartera") return "acreditar";
  if (hacia === "rechazado" && desde !== "informado") return "debitar";
  return "nada";
}

/** Cómo se le dice cada estado al cliente, en Mi cuenta y en el recibo. */
export const ESTADO_PARA_EL_CLIENTE: Record<EstadoDeCheque, string> = {
  informado: "Por recibir",
  cartera: "Aceptado",
  entregado: "Endosado",
  depositado: "Depositado",
  acreditado: "Acreditado",
  rechazado: "Rechazado",
  anulado: "Anulado",
};
