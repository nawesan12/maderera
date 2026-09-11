import "server-only";

import { desc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  customers,
  cuttingOrders,
  invoices,
  orders,
  quotes,
  suppliers,
} from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";
import { coincideBusqueda } from "@/lib/busqueda";
import { nombreComprobante } from "@/lib/fiscal/comprobantes";
import { puedeEntrar } from "@/lib/roles";

/**
 * Lo que encuentra el buscador del encabezado (⌘K).
 *
 * Antes miraba **solo el catálogo**, con un comentario que decía "cuando
 * pedidos, presupuestos y clientes dejen de ser datos de ejemplo, se suman
 * acá". Dejaron de serlo hace varias pasadas y el buscador siguió igual,
 * mientras el campo prometía en la cara "Buscar cliente, pedido, producto…".
 *
 * Un buscador global es lo más barato que ata un panel de sesenta pantallas:
 * quien atiende el teléfono escribe el apellido o el número que le dictan y
 * llega, sin saber en qué sección vive esa cosa. Por eso busca por **lo que la
 * gente tiene a mano**: el apellido, el CUIT, el número de comprobante que el
 * cliente está leyendo del papel.
 *
 * **Cada entidad respeta `ACCESO`.** El buscador no puede ser la puerta de
 * atrás que muestre el padrón de clientes a quien la sección le rebota: se
 * filtra por rol antes de consultar, no después de mostrar.
 */

export interface ResultadoDePanel {
  id: string;
  tipo: string;
  titulo: string;
  detalle: string;
  href: string;
}

/** Cuántos de cada tipo. Corto a propósito: el panel cae debajo del campo. */
const POR_TIPO = 4;

export async function buscarEnElPanel(
  termino: string,
): Promise<ResultadoDePanel[]> {
  /*
   * El rol sale de la sesión y **no se recibe por parámetro**. Es una función
   * de servidor: cualquiera puede invocarla por POST con los argumentos que
   * quiera, y un rol que llega de afuera es un rol que se puede elegir.
   */
  const { staffRole } = await requireStaff();
  if (!staffRole) return [];

  const texto = termino.trim();
  if (texto.length < 2) return [];

  const puede = (ruta: string) => puedeEntrar(ruta, staffRole);

  const [clientesEnc, pedidosEnc, presupuestosEnc, comprobantes, cortes, provs] =
    await Promise.all([
      puede("/admin/clientes") ? buscarClientes(texto) : [],
      puede("/admin/pedidos") ? buscarPedidos(texto) : [],
      puede("/admin/presupuestos") ? buscarPresupuestos(texto) : [],
      puede("/admin/facturacion") ? buscarComprobantes(texto) : [],
      puede("/admin/cortes") ? buscarCortes(texto) : [],
      puede("/admin/proveedores") ? buscarProveedores(texto) : [],
    ]);

  /*
   * El orden es el de la pregunta más frecuente, no el alfabético: quien usa
   * ⌘K casi siempre está buscando a alguien o un papel que le están dictando.
   */
  return [
    ...clientesEnc,
    ...pedidosEnc,
    ...presupuestosEnc,
    ...comprobantes,
    ...cortes,
    ...provs,
  ];
}

async function buscarClientes(texto: string): Promise<ResultadoDePanel[]> {
  const filas = await db
    .select({
      id: customers.id,
      nombre: customers.nombre,
      razonSocial: customers.razonSocial,
      cuit: customers.cuit,
      telefono: customers.telefono,
    })
    .from(customers)
    .where(
      coincideBusqueda(texto, [
        customers.nombre,
        customers.razonSocial,
        customers.cuit,
        customers.telefono,
      ]),
    )
    .orderBy(customers.nombre)
    .limit(POR_TIPO);

  return filas.map((f) => ({
    id: f.id,
    tipo: "Cliente",
    titulo: f.nombre,
    detalle: [f.razonSocial, f.cuit, f.telefono].filter(Boolean).join(" · "),
    href: `/admin/clientes/${f.id}`,
  }));
}

async function buscarPedidos(texto: string): Promise<ResultadoDePanel[]> {
  const filas = await db
    .select({
      id: orders.id,
      numero: orders.numero,
      contacto: orders.contactoNombre,
      estado: orders.estado,
      total: orders.total,
      creado: orders.createdAt,
    })
    .from(orders)
    .where(coincideBusqueda(texto, [orders.numero, orders.contactoNombre]))
    .orderBy(desc(orders.createdAt))
    .limit(POR_TIPO);

  return filas.map((f) => ({
    id: f.id,
    tipo: "Pedido",
    titulo: `${f.numero} · ${f.contacto}`,
    detalle: `${f.estado} · ${f.creado.toLocaleDateString("es-AR")}`,
    href: `/admin/pedidos/${f.id}`,
  }));
}

async function buscarPresupuestos(texto: string): Promise<ResultadoDePanel[]> {
  const filas = await db
    .select({
      id: quotes.id,
      numero: quotes.numero,
      contacto: quotes.contactoNombre,
      estado: quotes.estado,
      creado: quotes.createdAt,
    })
    .from(quotes)
    .where(coincideBusqueda(texto, [quotes.numero, quotes.contactoNombre]))
    .orderBy(desc(quotes.createdAt))
    .limit(POR_TIPO);

  return filas.map((f) => ({
    id: f.id,
    tipo: "Presupuesto",
    titulo: `${f.numero} · ${f.contacto}`,
    detalle: `${f.estado} · ${f.creado.toLocaleDateString("es-AR")}`,
    href: `/admin/presupuestos/${f.id}`,
  }));
}

async function buscarComprobantes(texto: string): Promise<ResultadoDePanel[]> {
  /*
   * El número de un comprobante se dicta con guiones y ceros —"0015-00000123"—
   * y en la base son dos enteros. Se compara contra el número formateado, que
   * es lo que la persona tiene delante en el papel.
   */
  const formateado = sql<string>`lpad(${invoices.puntoVenta}::text, 4, '0') || '-' || lpad(${invoices.numero}::text, 8, '0')`;

  const filas = await db
    .select({
      id: invoices.id,
      puntoVenta: invoices.puntoVenta,
      numero: invoices.numero,
      tipo: invoices.tipo,
      receptor: invoices.receptorNombre,
      total: invoices.total,
      formateado,
    })
    .from(invoices)
    .where(
      sql`(${coincideBusqueda(texto, [invoices.receptorNombre])} OR ${formateado} ILIKE ${`%${texto.trim()}%`})`,
    )
    .orderBy(desc(invoices.createdAt))
    .limit(POR_TIPO);

  return filas.map((f) => ({
    id: f.id,
    tipo: "Comprobante",
    titulo: `${nombreComprobante(f.tipo)} ${f.formateado}`,
    detalle: f.receptor,
    href: `/admin/facturacion/${f.id}`,
  }));
}

async function buscarCortes(texto: string): Promise<ResultadoDePanel[]> {
  const filas = await db
    .select({
      id: cuttingOrders.id,
      numero: cuttingOrders.numero,
      contacto: cuttingOrders.contactoNombre,
      material: cuttingOrders.materialDescripcion,
      estado: cuttingOrders.estado,
    })
    .from(cuttingOrders)
    .where(
      coincideBusqueda(texto, [
        cuttingOrders.numero,
        cuttingOrders.contactoNombre,
        cuttingOrders.materialDescripcion,
      ]),
    )
    .orderBy(desc(cuttingOrders.createdAt))
    .limit(POR_TIPO);

  return filas.map((f) => ({
    id: f.id,
    tipo: "Corte",
    titulo: `${f.numero} · ${f.contacto}`,
    detalle: `${f.material} · ${f.estado}`,
    href: `/admin/cortes/${f.id}`,
  }));
}

async function buscarProveedores(texto: string): Promise<ResultadoDePanel[]> {
  const filas = await db
    .select({
      id: suppliers.id,
      nombre: suppliers.nombre,
      razonSocial: suppliers.razonSocial,
      cuit: suppliers.cuit,
      rubro: suppliers.rubro,
    })
    .from(suppliers)
    .where(
      coincideBusqueda(texto, [
        suppliers.nombre,
        suppliers.razonSocial,
        suppliers.cuit,
        suppliers.rubro,
      ]),
    )
    .orderBy(suppliers.nombre)
    .limit(POR_TIPO);

  return filas.map((f) => ({
    id: f.id,
    tipo: "Proveedor",
    titulo: f.nombre,
    detalle: [f.razonSocial, f.cuit, f.rubro].filter(Boolean).join(" · "),
    href: `/admin/proveedores/${f.id}`,
  }));
}
