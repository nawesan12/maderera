/**
 * La venta que se está cargando, guardada en esta máquina.
 *
 * Una recarga de la página tiraba todo lo cargado. Con «Rehacer» era peor: la
 * venta vieja ya estaba anulada y sus renglones existían solo en la pantalla
 * (mes simulado). Se guarda en el navegador, que es de esta caja y de esta
 * venta: no es un dato del negocio y no tiene por qué llegar al servidor.
 *
 * Todo va adentro de try/catch: en una ventana privada o con el almacenamiento
 * bloqueado, el mostrador vende igual, solo que sin esta red.
 */

/** Una venta a medio cargar de ayer no vuelve: los precios ya pueden ser otros. */
const VIDA_MS = 12 * 60 * 60 * 1000;

const clave = (branchId: string) => `mjbj:mostrador:venta:${branchId}`;

export function leerVentaEnCurso<T>(branchId: string): T | null {
  try {
    const crudo = window.localStorage.getItem(clave(branchId));
    if (!crudo) return null;
    const v = JSON.parse(crudo) as { at: number; venta: T };
    if (!v || typeof v.at !== "number" || Date.now() - v.at > VIDA_MS) {
      window.localStorage.removeItem(clave(branchId));
      return null;
    }
    return v.venta;
  } catch {
    return null;
  }
}

export function guardarVentaEnCurso<T>(branchId: string, venta: T | null) {
  try {
    if (venta === null) window.localStorage.removeItem(clave(branchId));
    else window.localStorage.setItem(clave(branchId), JSON.stringify({ at: Date.now(), venta }));
  } catch {
    // Sin almacenamiento se sigue vendiendo: la red de la recarga no está.
  }
}
