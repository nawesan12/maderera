/**
 * Qué regímenes de retención se ofrecen al pagarle a un proveedor, con qué
 * alícuota y cuáles arrancan tildados. Afuera del formulario para probarlo
 * (tests/regimenes-al-pagar.test.ts).
 */

export interface Regimen {
  id: string;
  /** El código («IIBB-MI»): no se muestra, el acumulado del mes viene por él. */
  codigo: string;
  nombre: string;
  impuesto: string;
  alicuota: number;
  alicuotaNoInscripto: number;
  minimoNoImponible: number;
}

export interface ProveedorDeRetencion {
  condicionIva: string;
  condicionGanancias: string | null;
  exentoGananciasHasta: string | null;
}

/**
 * Si el régimen le corresponde al proveedor: la misma regla que Go
 * (compras.SujetoARetencion), para no ofrecer lo que después se rechaza.
 * Ganancias sin condición cargada se ofrece igual: el rechazo dice qué
 * cargar.
 */
export function leCorresponde(r: Regimen, p: ProveedorDeRetencion | undefined, hoy: string): boolean {
  if (!p) return true;
  if (r.impuesto === "iva") return p.condicionIva === "responsable_inscripto";
  if (r.impuesto === "ganancias") {
    if (p.condicionIva === "monotributista") return false;
    if (p.condicionGanancias === "exento" && p.exentoGananciasHasta && hoy <= p.exentoGananciasHasta) return false;
  }
  return true;
}

/**
 * La alícuota con la que se le retendría: la de no inscripto en Ganancias si
 * lo es. Un régimen en 0 % para el proveedor no retiene nada y no se ofrece
 * (M4-004: eran 4 de 6 renglones).
 */
export function alicuotaPara(r: Regimen, p: ProveedorDeRetencion | undefined): number {
  if (r.impuesto === "ganancias" && p?.condicionGanancias === "no_inscripto") return r.alicuotaNoInscripto;
  return r.alicuota;
}

/** Los que se ofrecen: le corresponden y retienen algo. */
export function regimenesQueRetienen(regimenes: Regimen[], p: ProveedorDeRetencion | undefined, hoy: string): Regimen[] {
  return regimenes.filter((r) => leCorresponde(r, p, hoy) && alicuotaPara(r, p) > 0);
}

/**
 * Los que arrancan tildados: los que ya tuvieron base este mes (un pago con
 * los dos apagados no retenía y el acumulado quedaba mal para el siguiente,
 * M2S2-013) y, con la regla en «las_que_corresponden», la única de cada
 * impuesto que le corresponde (M4-004). Nunca uno al 0 %: Herrajes, inscripto,
 * arrancaba con «Ganancias · compra de bienes · 0%» tildado porque ese mes ya
 * tenía base (recorrido 2).
 */
export function tildadosAlArrancar(
  regimenes: Regimen[],
  p: ProveedorDeRetencion | undefined,
  hoy: string,
  codigosConBase: Set<string>,
  tildarLasQueCorresponden: boolean,
): string[] {
  const posibles = regimenesQueRetienen(regimenes, p, hoy);
  const unicas = tildarLasQueCorresponden
    ? posibles.filter((r) => posibles.filter((x) => x.impuesto === r.impuesto).length === 1)
    : [];
  return posibles.filter((r) => codigosConBase.has(r.codigo) || unicas.includes(r)).map((r) => r.id);
}
