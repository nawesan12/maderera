import { importeParaElCampo } from "@/lib/formato";

/** El costo que se propone: el último, redondeado a pesos como se pacta. */
export function costoPropuesto(costo: string | number | null | undefined): string {
  const n = Number(costo);
  return costo === null || costo === undefined || costo === "" || !Number.isFinite(n) ? "" : importeParaElCampo(Math.round(n));
}

/**
 * Un costo un 30 % por debajo o por encima del último casi siempre es un error
 * de carga (mes simulado, H297: la placa de yeso a $7.800 contra $17.050, el
 * montante a $4.100 contra $6.619, la lana a $38.000 contra $54.860). Se marca
 * el campo y no se frena: a veces el precio cambió de verdad.
 */
export function costoLejos(costo: number, ultimo: number | null | undefined): boolean {
  if (!ultimo || ultimo <= 0 || !(costo > 0)) return false;
  return costo < ultimo * 0.7 || costo > ultimo * 1.3;
}
