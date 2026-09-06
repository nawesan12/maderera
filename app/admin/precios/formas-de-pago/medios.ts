/**
 * Los medios de pago que el negocio ofrece, con su nombre legible.
 *
 * Vive en su propio módulo y **no en el editor**: el editor es `"use client"`,
 * y de un módulo de cliente el servidor solo recibe referencias a los
 * componentes, no los valores. Importar este arreglo desde la pantalla daba un
 * `MEDIOS.find is not a function` en tiempo de ejecución que TypeScript no
 * puede ver, porque para el compilador el import es perfectamente válido.
 */
export const MEDIOS = [
  { valor: "transferencia", etiqueta: "Transferencia" },
  { valor: "efectivo", etiqueta: "Efectivo" },
  { valor: "debito", etiqueta: "Débito" },
  { valor: "credito", etiqueta: "Crédito" },
  { valor: "mercado_pago", etiqueta: "Mercado Pago" },
  { valor: "cuenta_corriente", etiqueta: "Cuenta corriente" },
] as const;
