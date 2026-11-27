/**
 * Las reglas del negocio que esperan al contador o a la clienta (migración
 * 00290), en espejo de `backend/internal/reglas`. El primer valor de cada una
 * es el de arranque: el comportamiento que el sistema tenía antes de que la
 * regla existiera. Go es quien las aplica; acá solo se leen para que la
 * pantalla muestre lo mismo que Go va a hacer.
 */
export const OPCIONES_DE_REGLAS = {
  venta_reconocida: ["entregar_o_facturar", "tomar", "entregar", "facturar"],
  cobro_antes_de_facturar: ["circuito_b", "anticipos"],
  excedente_cuenta_corriente: ["circuito_b", "anticipos"],
  asiento_sin_cae: ["al_cae", "transitoria"],
  corte_chico_material: ["sin_cargo", "cobrar"],
  corte_chico_stock: ["no_mueve", "descuenta"],
  contado_por_lista: ["con_ventaja", "siempre"],
  descuento_al_flete: ["no", "si"],
  factura_al_monotributista: ["a", "b"],
  precios_profesional_sin_tienda: ["no", "si"],
  sucursal_del_corte_suelto: ["primera", "preguntar"],
  firma_sin_pin: ["contrasena", "solo_pin"],
  aceptar_presupuesto_pendiente: ["no", "si"],
  etiqueta_del_circuito: ["b", "sin_factura", "interno"],
  datos_fiscales_del_cliente: ["hasta_facturar", "ninguno"],
  lote_y_cupon: ["obligatorio", "opcional"],
  descuento_con_escala: ["reemplaza", "suma"],
  redondeo_efectivo: ["no", "al_peso"],
  cae_en_compras: ["opcional", "exigido"],
  deuda_sin_comprobante: ["circuito_b", "saldo_inicial"],
  entregar_sin_cobrar: ["deposito", "fuera_de_la_cuenta"],
  exportar_sicore: ["no", "si"],
  base_retencion_iva: ["neto", "total"],
  retencion_en_el_cobro: ["admin", "quien_cobra"],
} as const;


export type ReglaPendiente = keyof typeof OPCIONES_DE_REGLAS;
export type ValorDeRegla<R extends ReglaPendiente> = (typeof OPCIONES_DE_REGLAS)[R][number];

/** El valor de una regla leído de los ajustes, o el de arranque si falta o es basura. */
export function valorDeRegla<R extends ReglaPendiente>(
  ajustes: Record<string, string>,
  clave: R,
): ValorDeRegla<R> {
  const opciones = OPCIONES_DE_REGLAS[clave] as readonly string[];
  const v = ajustes[clave];
  return (v && opciones.includes(v) ? v : opciones[0]) as ValorDeRegla<R>;
}
