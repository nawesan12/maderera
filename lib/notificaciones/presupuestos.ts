import "server-only";

import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { quoteItems, quotes } from "@/lib/db/schema";
import { envolver, presupuestoListo, type CorreoArmado } from "@/lib/email/plantillas";
import { fechaHora } from "@/lib/formato";
import { urlBase } from "@/lib/pagos/config";
import { despacharEmail } from "./avisos";

/**
 * Avisos de presupuestos.
 *
 * Dos momentos: cuando lo pedimos —el acuse, que es lo que evita el llamado de
 * "¿les llegó?"— y cuando está armado y listo para aceptar.
 */

function acuse(datos: {
  nombre: string;
  numero: string;
  express: boolean;
  respondeHasta: Date | null;
}): CorreoArmado {
  const cuerpo = envolver({
    titulo: "Recibimos tu pedido de presupuesto",
    adelanto: `Estamos armando el presupuesto ${datos.numero}.`,
    saludo: datos.nombre,
    parrafos: [
      datos.express
        ? "Como sos cliente profesional, entra por la cola express: te contestamos dentro de las 24 horas hábiles."
        : "Lo estamos armando y te contestamos a la brevedad.",
    ],
    datos: [
      { etiqueta: "Número", valor: datos.numero },
      ...(datos.respondeHasta
        ? [
            {
              etiqueta: "Te contestamos antes de",
              valor: fechaHora.format(datos.respondeHasta),
            },
          ]
        : []),
    ],
    cierre:
      "Si necesitás agregar o cambiar algo, contestá este correo y lo ajustamos antes de cotizarlo.",
  });

  return { asunto: `Pedido de presupuesto ${datos.numero}`, ...cuerpo };
}

export async function notificarPresupuestoRecibido(
  quoteId: string,
): Promise<void> {
  try {
    const [presupuesto] = await db
      .select()
      .from(quotes)
      .where(eq(quotes.id, quoteId))
      .limit(1);

    if (!presupuesto?.contactoEmail) return;

    await despacharEmail({
      evento: "presupuesto_recibido",
      para: presupuesto.contactoEmail,
      entidadTipo: "quote",
      entidadId: quoteId,
      correo: acuse({
        nombre: presupuesto.contactoNombre.split(" ")[0],
        numero: presupuesto.numero,
        express: presupuesto.origen === "express",
        respondeHasta: presupuesto.respondeHasta,
      }),
    });
  } catch {
    // El presupuesto ya está guardado; el acuse es un extra.
  }
}

/** Le manda el presupuesto armado, con el detalle y el link para aceptarlo. */
export async function notificarPresupuestoEnviado(
  quoteId: string,
): Promise<void> {
  try {
    const [presupuesto] = await db
      .select()
      .from(quotes)
      .where(eq(quotes.id, quoteId))
      .limit(1);

    if (!presupuesto?.contactoEmail) return;

    const lineas = await db
      .select({
        descripcion: quoteItems.descripcion,
        cantidad: quoteItems.cantidad,
        unidad: quoteItems.unidad,
        subtotal: quoteItems.subtotal,
      })
      .from(quoteItems)
      .where(eq(quoteItems.quoteId, quoteId))
      .orderBy(asc(quoteItems.orden));

    await despacharEmail({
      evento: "presupuesto_listo",
      para: presupuesto.contactoEmail,
      entidadTipo: "quote",
      entidadId: quoteId,
      correo: presupuestoListo({
        nombre: presupuesto.contactoNombre.split(" ")[0],
        numero: presupuesto.numero,
        total: presupuesto.total,
        vence: presupuesto.validoHasta
          ? fechaHora.format(presupuesto.validoHasta)
          : null,
        lineas: lineas.map((l) => ({
          descripcion: l.descripcion,
          cantidad: Number(l.cantidad),
          unidad: l.unidad,
          importe: l.subtotal,
        })),
      }),
    });
  } catch {
    // Igual que arriba.
  }
}

/** Link directo al presupuesto en el portal, para el panel. */
export function urlDelPresupuesto(numero: string): string {
  return `${urlBase()}/mi-cuenta/presupuestos/${numero}`;
}
