/**
 * Fechas escritas como se escriben acá, dd/mm/aaaa, contra el aaaa-mm-dd que
 * viaja a las acciones. El `<input type="date">` las mostraba en el formato
 * del navegador: en uno en inglés salía «mm/dd/yyyy» (H267 y la tercera
 * prueba del mes).
 */

/** aaaa-mm-dd a dd/mm/aaaa; "" si no es una fecha. */
export function aPantalla(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/** dd/mm/aaaa a aaaa-mm-dd; null si no es una fecha que exista. */
export function aIso(texto: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(texto.trim());
  if (!m) return null;
  const [d, mes, a] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const f = new Date(Date.UTC(a, mes - 1, d));
  if (
    f.getUTCFullYear() !== a ||
    f.getUTCMonth() !== mes - 1 ||
    f.getUTCDate() !== d
  )
    return null;
  return `${a}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Los dígitos hasta el primero que hace imposible la fecha: un día después
 * del 31 o un mes después del 12 no se llegan a escribir.
 */
export function sinImposibles(digitos: string): string {
  const dia = Number(digitos.slice(0, 2));
  if (digitos.length >= 2 && (dia < 1 || dia > 31)) return digitos.slice(0, 1);
  const mes = Number(digitos.slice(2, 4));
  if (digitos.length >= 4 && (mes < 1 || mes > 12)) return digitos.slice(0, 3);
  return digitos;
}

/**
 * Lo que se tipeó, con las barras puestas solas: «2511» → «25/11». Una fecha
 * pegada como aaaa-mm-dd se da vuelta entera: leída como dígitos quedaba en
 * «20/2» (M2S4-036, M3S4-020).
 */
export function conBarras(escrito: string): string {
  const iso = /^\s*(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\s*$/.exec(escrito);
  if (iso) return `${iso[3].padStart(2, "0")}/${iso[2].padStart(2, "0")}/${iso[1]}`;
  const digitos = sinImposibles(escrito.replace(/\D/g, "").slice(0, 8));
  return [digitos.slice(0, 2), digitos.slice(2, 4), digitos.slice(4)]
    .filter(Boolean)
    .join("/");
}
