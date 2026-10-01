import "server-only";
import { cacheLife } from "next/cache";

/**
 * El año en curso, para lo que se arma una vez y se sirve a todos.
 *
 * Con Cache Components, leer el reloj en un componente de servidor que forma
 * parte de la página ya armada es un error del build: el resultado quedaría
 * congelado en el HTML sin que nadie lo haya decidido. Pasarlo por un caché
 * con vencimiento lo vuelve una decisión explícita —el año del pie puede tener
 * hasta un día de atraso el 1 de enero, y eso está bien—.
 */
export async function anioEnCurso(): Promise<number> {
  "use cache";
  cacheLife("days");
  return new Date().getFullYear();
}
