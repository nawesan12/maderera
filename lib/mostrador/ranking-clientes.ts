/**
 * En qué orden se ofrecen los clientes en el buscador del mostrador.
 *
 * Antes salían en orden alfabético, de a ocho: con cuarenta «García» en el
 * padrón, el que se buscaba quedaba afuera y había que seguir tipeando. Ahora
 * gana lo más específico —el CUIT o el DNI exacto—, después el que empieza con
 * lo tipeado, después el que lo contiene, y entre iguales el que se atendió
 * hace menos: el cliente de todos los días aparece primero.
 *
 * Es lógica pura: la usan la búsqueda local, la del servidor y los tests.
 */

import { normalizar } from "@/lib/mostrador/offline/busqueda-local";

export interface ClienteOrdenable {
  id: string;
  nombre: string;
  razonSocial: string | null;
  cuit: string | null;
}

export function puntajeDeCliente(cliente: ClienteOrdenable, consulta: string): number {
  const digitos = consulta.replace(/\D/g, "");
  const cuit = (cliente.cuit ?? "").replace(/\D/g, "");

  // Un documento tipeado entero: es exactamente ese cliente.
  if (digitos.length >= 7 && cuit && (cuit === digitos || cuit.slice(2, 10) === digitos)) return 0;
  if (digitos.length >= 4 && cuit.includes(digitos)) return 1;

  const q = normalizar(consulta);
  const nombres = [cliente.nombre, cliente.razonSocial ?? ""].map(normalizar);
  if (nombres.some((n) => n.startsWith(q))) return 2;
  if (nombres.some((n) => n.split(" ").some((palabra) => palabra.startsWith(q)))) return 3;
  return 4;
}

/**
 * Ordena por puntaje y, entre iguales, por cuán reciente se atendió.
 *
 * `recientes` son ids, del más nuevo al más viejo.
 */
export function ordenarClientes<T extends ClienteOrdenable>(
  clientes: T[],
  consulta: string,
  recientes: string[] = [],
): T[] {
  const lugar = new Map(recientes.map((id, i) => [id, i]));
  return [...clientes]
    .map((c) => ({ c, p: puntajeDeCliente(c, consulta), r: lugar.get(c.id) ?? Infinity }))
    .sort((a, b) => a.p - b.p || a.r - b.r || a.c.nombre.localeCompare(b.c.nombre, "es"))
    .map((x) => x.c);
}
