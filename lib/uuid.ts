/**
 * Si un texto tiene forma de uuid.
 *
 * Las fichas del panel y las hojas para imprimir buscan por id, y la columna es
 * `uuid`: Postgres rechaza cualquier otra cosa con un error —«invalid input
 * syntax for type uuid»— en vez de devolver nada. Un enlace mal copiado
 * terminaba en «Esta pantalla no cargó», con un código para pasarle a quien
 * mantiene el sistema, cuando lo que pasaba era que la ficha no existe.
 */
export function esUuid(texto: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(texto);
}
