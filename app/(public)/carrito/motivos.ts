/**
 * Qué hace que un pedido necesite cotización especial.
 *
 * Los cuatro salen del brief, sección 07: precios por volumen, fletes
 * especiales, fabricación a pedido y obras completas. Saberlo al entrar decide
 * si lo resuelve el mostrador o tiene que pasar por administración, y evita el
 * ida y vuelta.
 *
 * Vive en su propio módulo y **no en `actions.ts`**: un archivo `"use server"`
 * solo puede exportar funciones asíncronas, y desde el cliente una constante
 * declarada ahí no llega como el arreglo que parece.
 */
export const MOTIVOS_DE_COTIZACION = [
  { valor: "volumen", etiqueta: "Compra por volumen" },
  { valor: "flete", etiqueta: "Flete especial o fuera de Mar del Plata" },
  { valor: "fabricacion", etiqueta: "Fabricación a pedido o medida especial" },
  { valor: "obra", etiqueta: "Obra completa" },
] as const;
