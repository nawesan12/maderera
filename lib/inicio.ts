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
 *
 * `omitir` son las claves que la pantalla ya muestra de otra forma: el
 * depósito tiene la cola y lo que hay para preparar en listas, y la cifra
 * arriba repetía lo mismo, en grande, medio scroll antes del primer botón.
 */
export function partirPendientes<T extends { clave: string; urgente?: boolean }>(
  pendientes: T[],
  omitir: readonly string[] = [],
): { paraHoy: T[]; pendientes: T[] } {
  const quedan = pendientes.filter((p) => !omitir.includes(p.clave));
  return {
    paraHoy: quedan.filter((p) => p.urgente),
    pendientes: quedan.filter((p) => !p.urgente),
  };
}

/** Lo que el depósito ve en sus listas de Inicio, y no en «Para hoy». */
export const CLAVES_EN_LAS_LISTAS_DEL_DEPOSITO = ["entregar", "cortes", "preparar"] as const;

/**
 * Cuántos de los meses del gráfico tienen ventas (en alguna sucursal).
 *
 * Con menos de tres, «Ventas por sucursal» es un gráfico de barras vacías con
 * una sola barra al final: no muestra una tendencia, y se cambia por el mes en
 * curso de cada sucursal.
 */
export function mesesConVentas(
  ventas: { sucursales: { total: number }[] }[],
): number {
  return ventas.filter((m) => m.sucursales.some((s) => s.total > 0)).length;
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

export interface RenglonParaEntregar extends RenglonParaPreparar {
  /**
   * Lo que falta cobrar fuera de la cuenta corriente (`sinCobrar` de Go): el
   * «Marcar entregado» pregunta antes con eso, como en el tablero de Pedidos,
   * que el depósito ya ve.
   */
  sinCobrar: number | null;
}

/**
 * Lo que el depósito tiene que entregar o despachar hoy: los pedidos listos,
 * el que espera hace más primero (mes simulado, H396). Quedaban reducidos a
 * un chip al fondo de «Pendientes» y para entregar había que ir a Pedidos.
 * Se cuentan los mismos que Go (`listos`, solo «listo»): los que están en
 * camino ya salieron.
 *
 * Como `paraPreparar`, arma el renglón campo por campo: el total del pedido
 * no viaja al navegador.
 */
export function paraEntregar(
  pedidos: {
    id: string;
    numero: string;
    cliente: string;
    estado: string;
    tipoEntrega: string;
    zonaEnvio: string | null;
    estadoPago: string;
    sinCobrar: number | null;
    createdAt: Date;
  }[],
  tope = 5,
): { renglones: RenglonParaEntregar[]; total: number } {
  const listos = pedidos
    .filter((p) => p.estado === "listo")
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return {
    total: listos.length,
    renglones: listos.slice(0, tope).map((p) => ({
      id: p.id,
      numero: p.numero,
      cliente: p.cliente,
      estado: p.estado,
      tipoEntrega: p.tipoEntrega,
      zonaEnvio: p.zonaEnvio,
      estadoPago: p.estadoPago,
      sinCobrar: p.sinCobrar,
    })),
  };
}
