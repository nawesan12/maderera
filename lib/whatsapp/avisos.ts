import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  avisosWhatsapp,
  branches,
  conversaciones,
  customers,
  orders,
} from "@/lib/db/schema";
import { proveedorWhatsapp } from "./index";
import { aJid } from "./config";
import { conversacionDe, registrarSaliente } from "./ingesta";
import { plantillaBase, previsualizar } from "./plantillas-base";

/**
 * Avisos automáticos por WhatsApp cuando un pedido cambia de estado.
 *
 * Es lo que el negocio hace hoy a mano: alguien del mostrador agarra el
 * teléfono y escribe "ya está listo lo tuyo". Automatizarlo ahorra ese trabajo
 * y evita el caso peor, que es que nadie avise y el cliente venga al pedo.
 *
 * Tres cuidados que no son opcionales:
 *
 * 1. **Nunca frena la operación.** Si WhatsApp falla, el pedido igual avanza.
 *    Un aviso que no sale es un problema menor; un pedido que no se puede
 *    marcar como listo porque Meta está caída es un problema real.
 * 2. **Solo si está encendido.** Cada estado tiene su interruptor y todos
 *    nacen apagados. Cada mensaje fuera de la ventana de 24 h es una
 *    conversación que Meta factura, así que esto se prende a conciencia.
 * 3. **Dentro de la ventana va texto libre.** Si el cliente escribió hace
 *    menos de 24 h, el aviso sale como mensaje normal y no consume plantilla.
 */

const VENTANA_MS = 24 * 3_600_000;

function log(evento: string, detalle?: string) {
  console.info(JSON.stringify({ scope: "whatsapp.avisos", evento, detalle }));
}

/**
 * Manda el aviso que corresponda al nuevo estado de un pedido.
 *
 * No lanza nunca: quien la llama está en medio de cambiar el estado y no puede
 * romperse por esto.
 */
export async function avisarCambioDePedido(
  orderId: string,
  nuevoEstado: string,
): Promise<void> {
  try {
    const [aviso] = await db
      .select()
      .from(avisosWhatsapp)
      .where(eq(avisosWhatsapp.evento, nuevoEstado))
      .limit(1);

    if (!aviso?.activo) return;

    const [pedido] = await db
      .select({
        numero: orders.numero,
        contactoNombre: orders.contactoNombre,
        contactoTelefono: orders.contactoTelefono,
        customerId: orders.customerId,
        clienteNombre: customers.nombre,
        clienteTelefono: customers.telefono,
        sucursal: branches.name,
      })
      .from(orders)
      .leftJoin(customers, eq(customers.id, orders.customerId))
      .leftJoin(branches, eq(branches.id, orders.branchId))
      .where(eq(orders.id, orderId))
      .limit(1);

    if (!pedido) return;

    // El teléfono de la ficha manda sobre el que se tipeó en el pedido: es el
    // que el negocio mantiene al día.
    const telefono = pedido.clienteTelefono ?? pedido.contactoTelefono;
    if (!telefono) {
      log("sin_telefono", pedido.numero);
      return;
    }

    const waJid = aJid(telefono);
    if (!waJid) {
      log("telefono_invalido", `${pedido.numero}: ${telefono}`);
      return;
    }

    const nombre = (pedido.clienteNombre ?? pedido.contactoNombre ?? "").split(
      /\s+/,
    )[0];

    const conversacion = await conversacionDe(waJid, nombre || null);

    // Si nunca se habló con esa persona, la conversación queda colgada del
    // pedido: quien conteste después va a ver de qué se trataba.
    if (!conversacion.orderId) {
      await db
        .update(conversaciones)
        .set({ orderId, updatedAt: new Date() })
        .where(eq(conversaciones.id, conversacion.id));
    }

    const proveedor = proveedorWhatsapp();
    const dentroDeVentana =
      conversacion.ultimoEntranteAt !== null &&
      Date.now() - conversacion.ultimoEntranteAt.getTime() < VENTANA_MS;

    const variables = [
      nombre || "cliente",
      pedido.numero,
      pedido.sucursal ?? "nuestra sucursal",
    ];

    // Dentro de la ventana se puede escribir libremente, que además no gasta
    // plantilla. Fuera de ella, Meta solo acepta una aprobada.
    if (dentroDeVentana && aviso.textoLibre) {
      const cuerpo = previsualizar(aviso.textoLibre, variables);
      const resultado = await proveedor.enviarTexto(waJid, cuerpo);

      if (!resultado.error) {
        await registrarSaliente({
          conversacionId: conversacion.id,
          cuerpo,
          waMessageId: resultado.waMessageId,
        });
        log("enviado_texto", `${pedido.numero} -> ${nuevoEstado}`);
        return;
      }

      // Si falló por la ventana, se reintenta con la plantilla más abajo.
      if (!resultado.fueraDeVentana) {
        log("error_texto", resultado.error);
        return;
      }
    }

    const definicion = plantillaBase(aviso.plantilla);
    const necesarias = definicion?.variables ?? variables.length;

    const resultado = await proveedor.enviarPlantilla(waJid, {
      nombre: aviso.plantilla,
      idioma: aviso.idioma,
      variables: variables.slice(0, necesarias),
    });

    if (resultado.error) {
      log("error_plantilla", `${pedido.numero}: ${resultado.error}`);
      return;
    }

    await registrarSaliente({
      conversacionId: conversacion.id,
      cuerpo: definicion
        ? previsualizar(definicion.cuerpo, variables.slice(0, necesarias))
        : `[${aviso.plantilla}]`,
      waMessageId: resultado.waMessageId,
      plantilla: aviso.plantilla,
    });

    log("enviado_plantilla", `${pedido.numero} -> ${nuevoEstado}`);
  } catch (error) {
    // Se traga el error a propósito: el pedido ya cambió de estado y esa
    // operación no se deshace porque no se pudo avisar.
    log(
      "error_inesperado",
      error instanceof Error ? error.message : "desconocido",
    );
  }
}

/**
 * Deja creados los avisos de los estados que tienen sentido avisar, apagados.
 *
 * Se llama la primera vez que se abre la pantalla de configuración: es mejor
 * mostrar los interruptores en cero que una pantalla vacía donde no se entiende
 * qué se puede prender.
 */
export async function sembrarAvisos(): Promise<void> {
  const [existente] = await db
    .select({ id: avisosWhatsapp.id })
    .from(avisosWhatsapp)
    .limit(1);

  if (existente) return;

  await db.insert(avisosWhatsapp).values([
    {
      evento: "preparando",
      plantilla: "pedido_preparando",
      textoLibre:
        "Hola {{1}}! Ya estamos preparando tu pedido {{2}}. Te avisamos apenas esté listo.",
      activo: false,
    },
    {
      evento: "listo",
      plantilla: "pedido_listo",
      textoLibre:
        "Hola {{1}}! Tu pedido {{2}} ya está listo para retirar en {{3}}.",
      activo: false,
    },
    {
      evento: "en-camino",
      plantilla: "pedido_en_camino",
      textoLibre:
        "Hola {{1}}! Tu pedido {{2}} salió para la dirección que nos diste.",
      activo: false,
    },
    {
      evento: "entregado",
      plantilla: "pedido_entregado",
      textoLibre:
        "Hola {{1}}! Entregamos tu pedido {{2}}. Gracias por elegirnos.",
      activo: false,
    },
  ]);
}
