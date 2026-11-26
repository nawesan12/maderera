/**
 * Cómo cierra la cuenta del detalle de un pedido en Mi cuenta (H209).
 *
 * El descuento puede venir de dos maneras: sobre el total (los renglones van
 * a precio lleno y el pedido resta el descuento), o ya repartido en los
 * precios de los renglones (el acopio de PED-1216: 40 × $26.010 con el 10 %
 * adentro). En el primer caso se resta en una línea propia; en el segundo los
 * renglones ya suman el total, y restarlo otra vez lo aplicaba dos veces
 * (Subtotal $2.599.000 − $259.900 con renglones que daban $2.339.100). Ahí
 * se dice lo ahorrado sin restarlo.
 *
 * El subtotal es siempre la suma de los renglones.
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
  const subtotal = Math.round(sumaRenglones * 100) / 100;
  const ahorro = descuento > 0.005 ? descuento : 0;
  const restaElAhorro =
    ahorro > 0 && Math.abs(subtotal + costoEnvio - ahorro - total) < 0.01;
  return { subtotal, ahorro, restaElAhorro };
}
