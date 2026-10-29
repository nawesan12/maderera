"use server";

import { revalidatePath, updateTag } from "next/cache";
import { ETIQUETAS } from "@/lib/cache-publico";
import { redirect } from "next/navigation";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";
import { getSession } from "@/lib/dal/session";
import { ErrorDeCobro, iniciarPagoDeInscripcion } from "@/lib/pagos/crear";

export interface EstadoInscripcion {
  error?: string;
  ok?: string;
}

/**
 * Inscripción a un evento.
 *
 * La toma la API de Go (backend/internal/profesionales/eventos.go): valida
 * como antes, frena por IP y por correo, y reserva el lugar con el candado
 * por evento (dos personas al último lugar no entran las dos). Gratuito:
 * queda confirmada de una y Go manda el correo. Con precio: queda reservada
 * —ocupando lugar— y acá se arma el cobro de Mercado Pago (tanda 6). La
 * confirmación llega por el mismo `acreditarPago` que cobra un pedido.
 */
export async function anotarse(_previo: EstadoInscripcion, formData: FormData): Promise<EstadoInscripcion> {
  const slug = formData.get("slug");
  const r = await (await api()).POST("/api/v1/eventos/inscripcion", {
    body: {
      eventId: formData.get("eventId"),
      slug,
      nombre: formData.get("nombre"),
      email: formData.get("email"),
      telefono: formData.get("telefono"),
    },
  });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "No pudimos anotarte. Probá de nuevo en un momento.") };

  // La lista de eventos está cacheada entre visitas y trae el conteo de
  // inscriptos: sin esto, quien acaba de anotarse seguiría viendo el cupo de
  // antes de anotarse.
  updateTag(ETIQUETAS.eventos);
  revalidatePath(`/eventos/${slug}`);
  revalidatePath("/eventos");
  revalidatePath("/admin/eventos");

  if (!r.data.requierePago) {
    return { ok: "Listo, quedaste anotado. Te mandamos los detalles por correo." };
  }

  let destino: string;
  try {
    const sesion = await getSession();
    destino = (await iniciarPagoDeInscripcion(r.data.id, sesion?.userId)).urlPago;
  } catch (error) {
    if (error instanceof ErrorDeCobro) return { error: error.message };
    console.error(error);
    return { error: "No pudimos anotarte. Probá de nuevo en un momento." };
  }
  redirect(destino);
}
