import "server-only";

import { and, asc, desc, eq, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  accountMovements,
  customers,
  orders,
  priceLists,
  quotes,
} from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";
import { coincideBusqueda } from "@/lib/busqueda";

export interface ClienteListado {
  id: string;
  nombre: string;
  razonSocial: string | null;
  cuit: string | null;
  rubro: string | null;
  tipo: "particular" | "profesional";
  estado: "activo" | "moroso" | "inactivo";
  asesor: string | null;
  telefono: string | null;
  email: string | null;
  saldo: number;
  limiteCredito: number;
  totalComprado: number;
  ultimaCompra: Date | null;
}

/**
 * Clientes con su saldo de cuenta corriente.
 *
 * El saldo se calcula sumando los movimientos en vez de leerse de una columna:
 * un saldo guardado aparte se desincroniza en cuanto algo falla a mitad de una
 * operación, y esa diferencia se termina descubriendo discutiendo con el cliente
 * en el mostrador.
 */
export async function listarClientes(
  filtros: { busqueda?: string; tipo?: string } = {},
): Promise<ClienteListado[]> {
  await requireStaff();

  const condiciones = [eq(customers.active, true)];

  if (filtros.tipo && filtros.tipo !== "todos") {
    condiciones.push(eq(customers.tipo, filtros.tipo as "particular" | "profesional"));
  }
  if (filtros.busqueda) {
    const coincidencia = coincideBusqueda(filtros.busqueda, [
      customers.nombre,
      customers.razonSocial,
      customers.cuit,
      customers.rubro,
      customers.email,
    ]);
    if (coincidencia) condiciones.push(coincidencia);
  }

  const saldo = db
    .select({
      customerId: accountMovements.customerId,
      saldo: sql<string>`sum(${accountMovements.monto})`.as("saldo"),
    })
    .from(accountMovements)
    .groupBy(accountMovements.customerId)
    .as("saldos");

  const compras = db
    .select({
      customerId: orders.customerId,
      total: sql<string>`sum(${orders.total})`.as("total_comprado"),
      ultima: sql<Date>`max(${orders.createdAt})`.as("ultima_compra"),
    })
    .from(orders)
    .where(sql`${orders.estado} <> 'cancelado'`)
    .groupBy(orders.customerId)
    .as("compras");

  const filas = await db
    .select({
      id: customers.id,
      nombre: customers.nombre,
      razonSocial: customers.razonSocial,
      cuit: customers.cuit,
      rubro: customers.rubro,
      tipo: customers.tipo,
      estado: customers.estado,
      asesor: customers.asesor,
      telefono: customers.telefono,
      email: customers.email,
      limiteCredito: customers.limiteCredito,
      saldo: saldo.saldo,
      totalComprado: compras.total,
      ultimaCompra: compras.ultima,
    })
    .from(customers)
    .leftJoin(saldo, eq(saldo.customerId, customers.id))
    .leftJoin(compras, eq(compras.customerId, customers.id))
    .where(and(...condiciones))
    .orderBy(asc(customers.nombre));

  return filas.map((f) => ({
    ...f,
    saldo: Number(f.saldo ?? 0),
    limiteCredito: Number(f.limiteCredito),
    totalComprado: Number(f.totalComprado ?? 0),
    ultimaCompra: f.ultimaCompra ? new Date(f.ultimaCompra) : null,
  }));
}

/** Ficha completa: datos, cuenta corriente y últimas operaciones. */
export async function obtenerCliente(id: string) {
  await requireStaff();

  const [cliente] = await db
    .select()
    .from(customers)
    .where(eq(customers.id, id))
    .limit(1);

  if (!cliente) return null;

  const [movimientos, pedidosDelCliente, presupuestosDelCliente, totales] =
    await Promise.all([
      db
        .select()
        .from(accountMovements)
        .where(eq(accountMovements.customerId, id))
        .orderBy(desc(accountMovements.createdAt))
        .limit(20),
      db
        .select({
          id: orders.id,
          numero: orders.numero,
          estado: orders.estado,
          total: orders.total,
          createdAt: orders.createdAt,
        })
        .from(orders)
        .where(eq(orders.customerId, id))
        .orderBy(desc(orders.createdAt))
        .limit(10),
      db
        .select({
          id: quotes.id,
          numero: quotes.numero,
          estado: quotes.estado,
          total: quotes.total,
          createdAt: quotes.createdAt,
        })
        .from(quotes)
        .where(eq(quotes.customerId, id))
        .orderBy(desc(quotes.createdAt))
        .limit(10),
      // El saldo se suma en la base y no sobre `movimientos`: esa lista viene
      // con `limit(20)`, así que sumarla daba el saldo de las últimas veinte
      // filas y no el de la cuenta. Con un cliente de años, el número que se
      // mostraba en la ficha no era el que el cliente debía.
      db
        .select({
          saldo: sql<string>`coalesce(sum(${accountMovements.monto}), 0)`,
          cuantos: sql<number>`count(*)`,
        })
        .from(accountMovements)
        .where(eq(accountMovements.customerId, id)),
    ]);

  const saldo = Number(totales[0]?.saldo ?? 0);
  const totalMovimientos = Number(totales[0]?.cuantos ?? 0);

  return {
    ...cliente,
    cuentaWebSinVincular: await buscarCuentaWebSinVincular(cliente),
    saldo,
    movimientos,
    /** Cuántos hay en total: `movimientos` trae solo los últimos veinte. */
    totalMovimientos,
    pedidos: pedidosDelCliente,
    presupuestos: presupuestosDelCliente,
  };
}

/**
 * Busca la ficha que dejó el registro del sitio para este mismo cliente.
 *
 * Cuando alguien que ya compra en el mostrador se crea una cuenta web, el
 * registro le arma una ficha nueva a propósito: como el alta no verifica el
 * correo, vincular sola por coincidencia de mail permitiría registrarse con la
 * dirección de un tercero y quedarse con su cuenta corriente.
 *
 * Entonces quedan dos fichas de la misma persona, y quien las une es alguien
 * del mostrador que sabe con quién está hablando. Esto solo detecta el caso y
 * lo pone a la vista.
 */
async function buscarCuentaWebSinVincular(cliente: {
  id: string;
  email: string | null;
  userId: string | null;
}) {
  // Si esta ficha ya tiene cuenta web, no hay nada que unir.
  if (cliente.userId || !cliente.email) return null;

  const [candidata] = await db
    .select({
      id: customers.id,
      nombre: customers.nombre,
      createdAt: customers.createdAt,
    })
    .from(customers)
    .where(
      and(
        eq(customers.email, cliente.email),
        eq(customers.active, true),
        isNotNull(customers.userId),
        ne(customers.id, cliente.id),
      ),
    )
    .limit(1);

  return candidata ?? null;
}

export async function listarListasParaClientes() {
  await requireStaff();
  return db.select().from(priceLists).orderBy(desc(priceLists.isDefault));
}
