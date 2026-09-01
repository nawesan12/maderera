"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSession } from "@/lib/dal/session";
import { estadoProfesional } from "@/lib/dal/profesionales";
import { ErrorDeInscripcion, inscribir } from "@/lib/eventos";
import { ErrorDeCobro, iniciarPagoDeInscripcion } from "@/lib/pagos/crear";
import { notificarInscripcion } from "@/lib/notificaciones/eventos";

export interface EstadoInscripcion {
  error?: string;
  ok?: string;
}

const esquema = z.object({
  eventId: z.string().uuid(),
  slug: z.string().min(1),
  nombre: z.string().trim().min(3, "Escribí tu nombre y apellido.").max(120),
  email: z.string().trim().email("Revisá el correo."),
  telefono: z.string().trim().max(40).optional(),
});

/**
 * Inscripción a un evento.
 *
 * Gratuito: queda confirmada de una. Con precio: queda reservada —ocupando
 * lugar— y manda a pagar. La confirmación llega por el mismo `acreditarPago`
 * que cobra un pedido, así que no hay un segundo camino por donde se confirme
 * algo sin que la plata haya entrado.
 */
export async function anotarse(
  _previo: EstadoInscripcion,
  formData: FormData,
): Promise<EstadoInscripcion> {
  const parsed = esquema.safeParse({
    eventId: formData.get("eventId"),
    slug: formData.get("slug"),
    nombre: formData.get("nombre"),
    email: formData.get("email"),
    telefono: (formData.get("telefono") as string) || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  }

  const [sesion, profesional] = await Promise.all([
    getSession(),
    estadoProfesional(),
  ]);

  let destino: string | null = null;

  try {
    const inscripcion = await inscribir({
      eventId: parsed.data.eventId,
      nombre: parsed.data.nombre,
      email: parsed.data.email,
      telefono: parsed.data.telefono,
      customerId: profesional.customerId,
      userId: sesion?.userId,
      esProfesional: profesional.aprobado,
    });

    revalidatePath(`/eventos/${parsed.data.slug}`);
    revalidatePath("/eventos");
    revalidatePath("/admin/eventos");

    if (!inscripcion.requierePago) {
      after(async () => {
        await notificarInscripcion(inscripcion.id);
      });

      return {
        ok: "Listo, quedaste anotado. Te mandamos los detalles por correo.",
      };
    }

    const cobro = await iniciarPagoDeInscripcion(
      inscripcion.id,
      sesion?.userId,
    );
    destino = cobro.urlPago;
  } catch (error) {
    if (error instanceof ErrorDeInscripcion || error instanceof ErrorDeCobro) {
      return { error: error.message };
    }
    console.error(error);
    return { error: "No pudimos anotarte. Probá de nuevo en un momento." };
  }

  redirect(destino);
}
