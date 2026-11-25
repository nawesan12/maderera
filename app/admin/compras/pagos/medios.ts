/**
 * Cómo se dice cada medio de pago en pantalla. La base guarda la clave
 * («echeq»); el listado de pagos la mostraba cruda.
 */
export const NOMBRE_DEL_MEDIO: Record<string, string> = {
  transferencia: "Transferencia",
  efectivo: "Efectivo",
  cheque: "Cheque",
  echeq: "e-Cheq",
};
