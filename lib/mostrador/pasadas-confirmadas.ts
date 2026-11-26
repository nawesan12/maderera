/**
 * Las pasadas que se cobran de un corte de la cola (tercera prueba, CRT-7302).
 *
 * La ficha del corte cobra las pasadas que confirmó el taller; el mostrador
 * cobraba las del plano, una más. Mientras el despiece sea el del corte
 * (mismas medidas, cantidades y veta, en cualquier orden), mandan las
 * confirmadas; cambiado, manda el plano. Go hace la misma cuenta
 * (pasadasConfirmadas en mostrador/controles.go).
 */
export interface PiezaDelDespiece {
  largoMm: number;
  anchoMm: number;
  cantidad: number;
  respetaVeta: number;
}

const clave = (p: PiezaDelDespiece) => `${p.largoMm}x${p.anchoMm}x${p.cantidad}x${p.respetaVeta}`;

export function mismoDespiece(a: PiezaDelDespiece[], b: PiezaDelDespiece[]): boolean {
  if (a.length !== b.length) return false;
  const cuenta = new Map<string, number>();
  for (const p of a) cuenta.set(clave(p), (cuenta.get(clave(p)) ?? 0) + 1);
  for (const p of b) {
    const n = cuenta.get(clave(p)) ?? 0;
    if (n === 0) return false;
    cuenta.set(clave(p), n - 1);
  }
  return true;
}

export function pasadasACobrar(
  delPlano: number,
  piezas: PiezaDelDespiece[],
  confirmado: { piezas: PiezaDelDespiece[]; pasadas: number } | null | undefined,
): number {
  if (!confirmado || confirmado.pasadas <= 0 || delPlano <= 0) return delPlano;
  return mismoDespiece(piezas, confirmado.piezas) ? confirmado.pasadas : delPlano;
}
