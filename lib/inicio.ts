/**
 * Las cuentas de la primera pantalla del panel (`app/admin/page.tsx`), sin
 * React ni base, para poder probarlas.
 */

/**
 * «Para hoy» es solo lo urgente; lo demás baja a «Pendientes».
 *
 * Con todo junto, cinco medidas sin foto pesaban lo mismo que un cheque que
 * vence mañana: la misma cifra de 44 px, en la misma hoja. Qué es urgente lo
 * decide Go (`backend/internal/reportes/inicio.go`), con el mismo criterio
 * para el aviso diario. El orden de cada grupo se conserva.
 */
export function partirPendientes<T extends { urgente?: boolean }>(
  pendientes: T[],
): { paraHoy: T[]; pendientes: T[] } {
  return {
    paraHoy: pendientes.filter((p) => p.urgente),
    pendientes: pendientes.filter((p) => !p.urgente),
  };
}

/**
 * Cuántos de los meses del gráfico tienen ventas (en alguna sucursal).
 *
 * Con menos de tres, «Ventas por sucursal» es un gráfico de barras vacías con
 * una sola barra al final: no muestra una tendencia, y se cambia por el mes en
 * curso de cada sucursal.
 */
export function mesesConVentas(
  ventas: { central: number; aserradero: number }[],
): number {
  return ventas.filter((m) => m.central + m.aserradero > 0).length;
}

/** Desde cuántos meses con ventas el gráfico dice algo. */
export const MESES_PARA_EL_GRAFICO = 3;

/**
 * Los estados que cuenta «pedidos por preparar» en Go (`porPreparar` en
 * `inicio.go`): la lista del depósito y la cifra tienen que dar lo mismo.
 */
export const ESTADOS_POR_PREPARAR = ["pendiente", "preparando"] as const;

export interface RenglonParaPreparar {
  id: string;
  numero: string;
  cliente: string;
  estado: string;
  tipoEntrega: string;
  zonaEnvio: string | null;
  /** Si está pagado o no (sin el importe): el botón de avanzar lo pide. */
  estadoPago: string;
}

/**
 * Lo que el depósito tiene que armar: el que espera hace más primero.
 *
 * Arma el renglón campo por campo y **no copia el pedido**: el depósito no ve
 * importes (`veLosNumeros` es solo de administración), y un `...pedido`
 * habría mandado el total al navegador aunque la pantalla no lo pintara.
 */
export function paraPreparar(
  pedidos: {
    id: string;
    numero: string;
    cliente: string;
    estado: string;
    tipoEntrega: string;
    zonaEnvio: string | null;
    estadoPago: string;
    createdAt: Date;
  }[],
  tope = 5,
): { renglones: RenglonParaPreparar[]; total: number } {
  const suyos = pedidos
    .filter((p) =>
      (ESTADOS_POR_PREPARAR as readonly string[]).includes(p.estado),
    )
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return {
    total: suyos.length,
    renglones: suyos.slice(0, tope).map((p) => ({
      id: p.id,
      numero: p.numero,
      cliente: p.cliente,
      estado: p.estado,
      tipoEntrega: p.tipoEntrega,
      zonaEnvio: p.zonaEnvio,
      estadoPago: p.estadoPago,
    })),
  };
}
