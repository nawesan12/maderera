import "server-only";

import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  accountMovements,
  avisosWhatsapp,
  branches,
  conversaciones,
  customers,
  mensajes,
  orders,
  sesionWhatsapp,
} from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";
import { proveedorWhatsapp } from "@/lib/whatsapp";
import { PLANTILLAS_BASE } from "@/lib/whatsapp/plantillas-base";
import type { EstadoConexion, PlantillaAprobada } from "@/lib/whatsapp/tipos";

/**
 * Lectura de la bandeja de WhatsApp. Solo para personal de la empresa.
 *
 * Nada de esto se expone al portal del cliente: son conversaciones de todos los
 * clientes juntas.
 */

/** Horas que dura la ventana para contestar con texto libre. */
export const VENTANA_HORAS = 24;

export interface ConversacionListada {
  id: string;
  waJid: string;
  nombre: string;
  customerId: string | null;
  clienteNombre: string | null;
  clienteTipo: "particular" | "profesional" | null;
  estado: "abierta" | "cerrada";
  ultimoMensajeAt: Date | null;
  ultimoMensajePreview: string | null;
  ultimoEntranteAt: Date | null;
  noLeidos: number;
  /** Si todavía se puede contestar con texto libre. */
  ventanaAbierta: boolean;
}

function calcularVentana(ultimoEntranteAt: Date | null): boolean {
  if (!ultimoEntranteAt) return false;
  const horas = (Date.now() - ultimoEntranteAt.getTime()) / 3_600_000;
  return horas < VENTANA_HORAS;
}

export async function listarConversaciones(
  filtro: "todas" | "sin-leer" | "cerradas" = "todas",
): Promise<ConversacionListada[]> {
  await requireStaff();

  const condiciones = [];

  if (filtro === "sin-leer") {
    condiciones.push(sql`${conversaciones.noLeidos} > 0`);
    condiciones.push(eq(conversaciones.estado, "abierta"));
  } else if (filtro === "cerradas") {
    condiciones.push(eq(conversaciones.estado, "cerrada"));
  } else {
    condiciones.push(eq(conversaciones.estado, "abierta"));
  }

  const filas = await db
    .select({
      id: conversaciones.id,
      waJid: conversaciones.waJid,
      displayName: conversaciones.displayName,
      customerId: conversaciones.customerId,
      clienteNombre: customers.nombre,
      clienteTipo: customers.tipo,
      estado: conversaciones.estado,
      ultimoMensajeAt: conversaciones.ultimoMensajeAt,
      ultimoMensajePreview: conversaciones.ultimoMensajePreview,
      ultimoEntranteAt: conversaciones.ultimoEntranteAt,
      noLeidos: conversaciones.noLeidos,
    })
    .from(conversaciones)
    .leftJoin(customers, eq(customers.id, conversaciones.customerId))
    .where(and(...condiciones))
    .orderBy(desc(conversaciones.ultimoMensajeAt))
    .limit(100);

  return filas.map((f) => ({
    ...f,
    nombre: f.clienteNombre ?? f.displayName ?? "Sin identificar",
    ventanaAbierta: calcularVentana(f.ultimoEntranteAt),
  }));
}

/**
 * Una conversación con sus mensajes y el contexto del cliente al costado.
 *
 * El saldo y el pedido abierto se traen acá y no en otra pantalla porque son
 * justo lo que hace falta para contestar: "¿ya está listo lo mío?" y "¿cuánto
 * debo?" son las dos preguntas que llegan por WhatsApp.
 */
export async function obtenerConversacion(id: string) {
  await requireStaff();

  const [conversacion] = await db
    .select({
      id: conversaciones.id,
      waJid: conversaciones.waJid,
      displayName: conversaciones.displayName,
      customerId: conversaciones.customerId,
      orderId: conversaciones.orderId,
      estado: conversaciones.estado,
      notas: conversaciones.notas,
      ultimoEntranteAt: conversaciones.ultimoEntranteAt,
      noLeidos: conversaciones.noLeidos,
      clienteNombre: customers.nombre,
      clienteTipo: customers.tipo,
      clienteTelefono: customers.telefono,
      clienteEmail: customers.email,
      clienteLimite: customers.limiteCredito,
      clienteEstado: customers.estado,
    })
    .from(conversaciones)
    .leftJoin(customers, eq(customers.id, conversaciones.customerId))
    .where(eq(conversaciones.id, id))
    .limit(1);

  if (!conversacion) return null;

  const listaMensajes = await db
    .select()
    .from(mensajes)
    .where(eq(mensajes.conversacionId, id))
    .orderBy(asc(mensajes.ocurridoAt))
    .limit(300);

  let saldo = 0;
  let pedidos: {
    id: string;
    numero: string;
    estado: string;
    total: string;
    createdAt: Date;
    sucursal: string | null;
  }[] = [];

  if (conversacion.customerId) {
    const [filaSaldo, filasPedidos] = await Promise.all([
      db
        .select({
          saldo: sql<string>`coalesce(sum(${accountMovements.monto}), 0)`,
        })
        .from(accountMovements)
        .where(eq(accountMovements.customerId, conversacion.customerId)),
      db
        .select({
          id: orders.id,
          numero: orders.numero,
          estado: orders.estado,
          total: orders.total,
          createdAt: orders.createdAt,
          sucursal: branches.name,
        })
        .from(orders)
        .leftJoin(branches, eq(branches.id, orders.branchId))
        .where(eq(orders.customerId, conversacion.customerId))
        .orderBy(desc(orders.createdAt))
        .limit(5),
    ]);

    saldo = Number(filaSaldo[0]?.saldo ?? 0);
    pedidos = filasPedidos;
  }

  return {
    ...conversacion,
    nombre:
      conversacion.clienteNombre ??
      conversacion.displayName ??
      "Sin identificar",
    ventanaAbierta: calcularVentana(conversacion.ultimoEntranteAt),
    mensajes: listaMensajes,
    saldo,
    limiteCredito: Number(conversacion.clienteLimite ?? 0),
    pedidos,
  };
}

/**
 * Pone en cero los no leídos de una conversación.
 *
 * No revalida nada a propósito: la llama la propia pantalla que está mostrando
 * la conversación, y revalidar desde ahí la haría volver a renderizarse en un
 * ciclo sin fin. El contador del menú se actualiza en la siguiente navegación,
 * que es cuando importa.
 */
export async function marcarLeidaSilencioso(id: string): Promise<void> {
  await db
    .update(conversaciones)
    .set({ noLeidos: 0 })
    .where(and(eq(conversaciones.id, id), sql`${conversaciones.noLeidos} > 0`));
}

/** Cuántas conversaciones tienen mensajes sin leer. Va en el menú del panel. */
export async function conversacionesSinLeer(): Promise<number> {
  const [fila] = await db
    .select({ total: sql<number>`count(*)` })
    .from(conversaciones)
    .where(
      and(
        eq(conversaciones.estado, "abierta"),
        sql`${conversaciones.noLeidos} > 0`,
      ),
    );

  return Number(fila?.total ?? 0);
}

/** Estado de la conexión, mezclando lo que dice el proveedor y lo guardado. */
export async function estadoWhatsapp(): Promise<EstadoConexion> {
  await requireStaff();

  const proveedor = proveedorWhatsapp();
  const estado = await proveedor.estado();

  const [fila] = await db
    .select({ ultimaSenal: sesionWhatsapp.ultimaSenal })
    .from(sesionWhatsapp)
    .limit(1);

  return {
    ...estado,
    ultimaSenal: fila?.ultimaSenal
      ? fila.ultimaSenal.getTime()
      : estado.ultimaSenal,
  };
}

/**
 * Plantillas disponibles.
 *
 * Con la Cloud API salen del WABA; en demostración, del catálogo base. Se
 * ordenan igual en los dos casos para que la pantalla no cambie de forma según
 * cómo esté configurado.
 */
export async function listarPlantillas(): Promise<PlantillaAprobada[]> {
  await requireStaff();

  const plantillas = await proveedorWhatsapp().listarPlantillas();
  const lista = plantillas.length > 0 ? plantillas : PLANTILLAS_BASE;

  return [...lista].sort((a, b) => a.nombre.localeCompare(b.nombre));
}

/** Configuración de los avisos automáticos, uno por estado de pedido. */
export async function listarAvisos() {
  await requireStaff();

  return db
    .select()
    .from(avisosWhatsapp)
    .orderBy(asc(avisosWhatsapp.evento));
}
