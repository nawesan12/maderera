import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { professionalApplications } from "@/lib/db/schema";
import { envolver, type CorreoArmado } from "@/lib/email/plantillas";
import { formatearCuitLargo } from "@/lib/cuit";
import { urlBase } from "@/lib/pagos/config";
import { despacharEmail } from "./avisos";

/**
 * Avisos del portal de profesionales.
 *
 * Tres momentos: recibimos la solicitud, la aprobamos, la rechazamos. Los tres
 * necesitan correo porque entre uno y otro pasan horas o días, y quien pidió el
 * acceso no va a estar mirando la pantalla.
 *
 * Como todos los avisos: no lanzan nunca.
 */

function acuseDeRecibo(nombre: string): CorreoArmado {
  const cuerpo = envolver({
    titulo: "Recibimos tu solicitud",
    adelanto: "Estamos revisando tu acceso al portal de profesionales.",
    saludo: nombre,
    parrafos: [
      "Un asesor la va a revisar y te contestamos dentro de las próximas 24 horas hábiles.",
      "Si necesitás algo antes, escribinos por WhatsApp y lo vemos.",
    ],
  });

  return { asunto: "Recibimos tu solicitud de acceso profesional", ...cuerpo };
}

function bienvenida(datos: {
  nombre: string;
  lista: string | null;
  limiteCredito: number;
}): CorreoArmado {
  const cuerpo = envolver({
    titulo: "Tu acceso profesional está activo",
    adelanto: "Ya tenés precios diferenciados en el catálogo.",
    saludo: datos.nombre,
    parrafos: [
      "Los precios que ves en el catálogo ahora son los tuyos: entrás con tu cuenta y el sitio te muestra la lista profesional, con los descuentos por volumen ya aplicados.",
      datos.limiteCredito > 0
        ? "También te habilitamos cuenta corriente, así podés comprar y abonar después."
        : "",
    ].filter(Boolean),
    datos: [
      ...(datos.lista ? [{ etiqueta: "Lista de precios", valor: datos.lista }] : []),
      ...(datos.limiteCredito > 0
        ? [
            {
              etiqueta: "Límite de cuenta corriente",
              valor: `$ ${datos.limiteCredito.toLocaleString("es-AR")}`,
            },
          ]
        : []),
    ],
    cta: { texto: "Entrar al catálogo", url: `${urlBase()}/catalogo` },
    cierre:
      "Desde tu cuenta también podés pedir presupuestos express, con respuesta en 24 horas, y descargar la documentación técnica.",
  });

  return { asunto: "Tu acceso profesional está activo", ...cuerpo };
}

function rechazo(nombre: string, motivo: string | null): CorreoArmado {
  const cuerpo = envolver({
    titulo: "Sobre tu solicitud de acceso profesional",
    adelanto: "Novedades de tu solicitud.",
    saludo: nombre,
    parrafos: [
      "Por ahora no pudimos habilitarte el acceso al portal de profesionales.",
      motivo ? `<strong>Motivo:</strong> ${motivo}` : "",
      "Si creés que hay un error o querés que lo revisemos, contestá este correo o escribinos por WhatsApp: la mayoría de los casos se resuelven hablando.",
    ].filter(Boolean),
  });

  return { asunto: "Sobre tu solicitud de acceso profesional", ...cuerpo };
}

export async function notificarSolicitudProfesional(
  solicitudId: string,
): Promise<void> {
  try {
    const [solicitud] = await db
      .select()
      .from(professionalApplications)
      .where(eq(professionalApplications.id, solicitudId))
      .limit(1);

    if (!solicitud) return;

    await despacharEmail({
      evento: "solicitud_profesional",
      para: solicitud.email,
      entidadTipo: "professional_application",
      entidadId: solicitudId,
      correo: acuseDeRecibo(solicitud.nombre.split(" ")[0]),
    });
  } catch {
    // La solicitud ya está guardada; el acuse es un extra.
  }
}

export async function notificarResolucionProfesional(
  solicitudId: string,
  datos: { lista?: string | null; limiteCredito?: number } = {},
): Promise<void> {
  try {
    const [solicitud] = await db
      .select()
      .from(professionalApplications)
      .where(eq(professionalApplications.id, solicitudId))
      .limit(1);

    if (!solicitud) return;

    const nombre = solicitud.nombre.split(" ")[0];

    await despacharEmail({
      evento:
        solicitud.estado === "aprobada"
          ? "profesional_aprobado"
          : "profesional_rechazado",
      para: solicitud.email,
      entidadTipo: "professional_application",
      entidadId: solicitudId,
      correo:
        solicitud.estado === "aprobada"
          ? bienvenida({
              nombre,
              lista: datos.lista ?? null,
              limiteCredito: datos.limiteCredito ?? 0,
            })
          : rechazo(nombre, solicitud.motivoRechazo),
    });
  } catch {
    // Igual que arriba.
  }
}

/** CUIT formateado para las pantallas del panel. */
export { formatearCuitLargo };
