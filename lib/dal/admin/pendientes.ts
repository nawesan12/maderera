import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  cheques,
  cuttingOrders,
  orders,
  productReviews,
  professionalApplications,
  purchaseInvoices,
} from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";
import { puedeEntrar } from "@/lib/roles";

/**
 * Qué hay que hacer hoy.
 *
 * El resumen contestaba "cómo viene el negocio" —ventas, presupuestos
 * abiertos, clientes— y **no contestaba "qué tengo que hacer"**, que es la
 * pregunta con la que alguien abre el panel a las ocho de la mañana. Peor: los
 * conteos que la contestan ya existían, calculados, pero cada uno encerrado en
 * su pantalla. El cheque que vence el viernes solo se veía entrando a Cheques;
 * la venta que quedó sin caja, entrando a Caja. Para enterarse había que
 * recorrer el menú, que es exactamente lo que un resumen existe para evitar.
 *
 * **Cada renglón lleva a la pantalla que lo resuelve, ya filtrada.** Un aviso
 * que dice "hay tres" y te deja buscándolos es medio aviso.
 *
 * **Solo aparece lo que el rol puede abrir.** Se filtra con `ACCESO`, la misma
 * lista que usan el menú y las páginas: sin esto, quien atiende el depósito
 * vería cuánto se le debe a los proveedores en la primera pantalla del panel.
 */

export interface Pendiente {
  clave: string;
  cantidad: number;
  /** Qué es, ya en plural o singular según la cantidad. */
  texto: string;
  /** Por qué importa hoy. Una línea. */
  detalle?: string;
  href: string;
  /** Lo que no puede esperar se pinta; el resto se lee en gris. */
  urgente?: boolean;
}

/** Cuántos días adelante mira el aviso de vencimientos. */
const DIAS_DE_AVISO = 7;

export async function trabajoPendiente(): Promise<Pendiente[]> {
  const { staffRole } = await requireStaff();
  if (!staffRole) return [];

  const ve = (ruta: string) => puedeEntrar(ruta, staffRole);

  const [ventas, cortes, cartera, compras, solicitudes, resenas] =
    await Promise.all([
      ve("/admin/pedidos") ? contarPedidos() : null,
      ve("/admin/cortes") ? contarCortes() : null,
      ve("/admin/cheques") ? contarCheques() : null,
      ve("/admin/compras/facturas") ? contarFacturasDeCompra() : null,
      ve("/admin/profesionales") ? contarSolicitudes() : null,
      ve("/admin/contenido") ? contarResenas() : null,
    ]);

  const filas: Pendiente[] = [];

  if (ventas?.porPreparar) {
    filas.push({
      clave: "preparar",
      cantidad: ventas.porPreparar,
      texto: ventas.porPreparar === 1 ? "pedido por preparar" : "pedidos por preparar",
      detalle: "Todavía no salieron a armarse",
      href: "/admin/pedidos",
      urgente: true,
    });
  }

  if (ventas?.listos) {
    filas.push({
      clave: "entregar",
      cantidad: ventas.listos,
      texto: ventas.listos === 1 ? "pedido listo sin entregar" : "pedidos listos sin entregar",
      detalle: "Armados y esperando que los retiren o salgan",
      href: "/admin/pedidos",
    });
  }

  if (cortes) {
    filas.push({
      clave: "cortes",
      cantidad: cortes,
      texto: cortes === 1 ? "corte en la cola" : "cortes en la cola",
      detalle: "Esperando la seccionadora",
      href: "/admin/cortes",
      urgente: true,
    });
  }

  if (cartera?.vencidos) {
    filas.push({
      clave: "cheques-vencidos",
      cantidad: cartera.vencidos,
      texto: cartera.vencidos === 1 ? "cheque pasado de fecha" : "cheques pasados de fecha",
      detalle: "Venció y sigue en cartera",
      href: "/admin/cheques",
      urgente: true,
    });
  }

  if (cartera?.porVencer) {
    filas.push({
      clave: "cheques",
      cantidad: cartera.porVencer,
      texto: cartera.porVencer === 1 ? "cheque vence esta semana" : "cheques vencen esta semana",
      detalle: "Los recibidos hay que depositarlos; los entregados, cubrirlos",
      href: "/admin/cheques",
    });
  }

  if (compras?.vencidas) {
    filas.push({
      clave: "compras-vencidas",
      cantidad: compras.vencidas,
      texto: compras.vencidas === 1 ? "factura de compra vencida" : "facturas de compra vencidas",
      detalle: "Pasó el vencimiento y sigue sin pagarse del todo",
      href: "/admin/compras/facturas",
      urgente: true,
    });
  }

  if (compras?.porVencer) {
    filas.push({
      clave: "compras",
      cantidad: compras.porVencer,
      texto: compras.porVencer === 1 ? "factura de compra vence esta semana" : "facturas de compra vencen esta semana",
      href: "/admin/compras/facturas",
    });
  }

  if (solicitudes) {
    filas.push({
      clave: "profesionales",
      cantidad: solicitudes,
      texto: solicitudes === 1 ? "profesional esperando respuesta" : "profesionales esperando respuesta",
      detalle: "Pidieron la cuenta con precio de gremio",
      href: "/admin/profesionales",
    });
  }

  if (resenas) {
    filas.push({
      clave: "resenas",
      cantidad: resenas,
      texto: resenas === 1 ? "reseña sin moderar" : "reseñas sin moderar",
      detalle: "No se publican hasta que alguien las mire",
      href: "/admin/contenido",
    });
  }

  // Lo urgente arriba, y dentro de cada mitad lo más grande primero: es el
  // mismo criterio que usan los listados del panel para agrupar.
  return filas.sort((a, b) => {
    if (!!b.urgente !== !!a.urgente) return b.urgente ? 1 : -1;
    return b.cantidad - a.cantidad;
  });
}

async function contarPedidos() {
  const [fila] = await db
    .select({
      porPreparar: sql<number>`(count(*) filter (where ${orders.estado} in ('pendiente', 'preparando')))::int`,
      listos: sql<number>`(count(*) filter (where ${orders.estado} in ('listo', 'en-camino')))::int`,
    })
    .from(orders);
  return fila ?? { porPreparar: 0, listos: 0 };
}

async function contarCortes() {
  const [fila] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(cuttingOrders)
    .where(eq(cuttingOrders.estado, "en-cola"));
  return fila?.n ?? 0;
}

async function contarCheques() {
  /*
   * "Vencido" acá no es un estado guardado sino una fecha que pasó: un cheque
   * en cartera con fecha de ayer sigue diciendo `cartera` y es justamente el
   * que hay que mirar. Guardar el vencimiento como estado obligaría a que algo
   * corra todas las noches para moverlo, y si esa noche no corre, el aviso no
   * aparece nunca.
   */
  const [fila] = await db
    .select({
      vencidos: sql<number>`(count(*) filter (where ${cheques.fechaPago} < now()))::int`,
      porVencer: sql<number>`(count(*) filter (where ${cheques.fechaPago} >= now() and ${cheques.fechaPago} < now() + ${`${DIAS_DE_AVISO} days`}::interval))::int`,
    })
    .from(cheques)
    .where(sql`${cheques.estado} in ('cartera', 'entregado', 'depositado')`);
  return fila ?? { vencidos: 0, porVencer: 0 };
}

async function contarFacturasDeCompra() {
  /*
   * Impaga es lo que **no está imputado en pagos**, no un estado que alguien
   * marque: es el mismo criterio que usa la pantalla de facturas de compra
   * para decir "Pagada / a medias / sin imputar", y conviene que sea el mismo
   * o el resumen y la pantalla se contradicen.
   */
  const saldoPendiente = sql`${purchaseInvoices.total} - coalesce((
    select sum(a.importe)
    from supplier_payment_allocations a
    where a.purchase_invoice_id = ${purchaseInvoices.id}
  ), 0) > 0.01`;

  const [fila] = await db
    .select({
      vencidas: sql<number>`(count(*) filter (where ${purchaseInvoices.fechaVencimiento} < now()))::int`,
      porVencer: sql<number>`(count(*) filter (where ${purchaseInvoices.fechaVencimiento} >= now() and ${purchaseInvoices.fechaVencimiento} < now() + ${`${DIAS_DE_AVISO} days`}::interval))::int`,
    })
    .from(purchaseInvoices)
    .where(
      and(
        sql`${purchaseInvoices.fechaVencimiento} is not null`,
        saldoPendiente,
      ),
    );
  return fila ?? { vencidas: 0, porVencer: 0 };
}

async function contarSolicitudes() {
  const [fila] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(professionalApplications)
    .where(eq(professionalApplications.estado, "pendiente"));
  return fila?.n ?? 0;
}

async function contarResenas() {
  const [fila] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(productReviews)
    .where(eq(productReviews.estado, "pendiente"));
  return fila?.n ?? 0;
}
