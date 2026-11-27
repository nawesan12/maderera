/**
 * Cómo cierra la cuenta del detalle de un pedido en Mi cuenta (H209).
 *
 * El descuento puede venir de dos maneras: sobre el total (los renglones van
 * a precio lleno y el pedido resta el descuento), o ya repartido en los
 * precios de los renglones (el acopio de PED-1216: 40 × $26.010 con el 10 %
 * adentro). Restarlo otra vez de la suma de los renglones lo aplicaba dos
 * veces (Subtotal $2.599.000 − $259.900 con renglones que daban $2.339.100).
 *
 * En los dos casos la cuenta se dice igual: el subtotal de antes del
 * descuento, el descuento con su nombre en su renglón y el total. Con el
 * descuento en los precios, decía «Subtotal = Total» y abajo «Ahorraste»
 * sin decir contra qué (mes simulado, M2S2-116). `restaElAhorro` es falso
 * solo si los números no cierran de ninguna de las dos maneras: ahí se dice
 * lo ahorrado sin restarlo.
 */
export function cuentasDelPedido({
  sumaRenglones,
  descuento,
  costoEnvio,
  total,
}: {
  sumaRenglones: number;
  descuento: number;
  costoEnvio: number;
  total: number;
}): { subtotal: number; ahorro: number; restaElAhorro: boolean } {
  const suma = Math.round(sumaRenglones * 100) / 100;
  const ahorro = descuento > 0.005 ? descuento : 0;
  if (ahorro === 0) return { subtotal: suma, ahorro, restaElAhorro: false };
  if (Math.abs(suma + costoEnvio - ahorro - total) < 0.01) {
    return { subtotal: suma, ahorro, restaElAhorro: true };
  }
  if (Math.abs(suma + costoEnvio - total) < 0.01) {
    return { subtotal: Math.round((suma + ahorro) * 100) / 100, ahorro, restaElAhorro: true };
  }
  return { subtotal: suma, ahorro, restaElAhorro: false };
}

/** El nombre del renglón del descuento: el motivo guardado, o «Descuento». */
export function nombreDelDescuento(motivo: string | null | undefined): string {
  const m = motivo?.trim();
  return m ? m.charAt(0).toUpperCase() + m.slice(1) : "Descuento";
}
