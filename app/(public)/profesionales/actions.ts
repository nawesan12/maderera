"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { professionalApplications } from "@/lib/db/schema";
import { getSession } from "@/lib/dal/session";
import { cuitValido, soloDigitos } from "@/lib/cuit";
import { notificarSolicitudProfesional } from "@/lib/notificaciones/profesionales";

export interface EstadoSolicitud {
  error?: string;
  ok?: string;
}

const esquema = z.object({
  nombre: z.string().trim().min(3, "Escribí tu nombre y apellido.").max(120),
  razonSocial: z.string().trim().max(160).optional(),
  cuit: z
    .string()
    .trim()
    .refine(cuitValido, "El CUIT no es válido. Revisá los números."),
  email: z.string().trim().email("Revisá el correo."),
  telefono: z.string().trim().min(6, "Dejanos un teléfono.").max(40),
  rubro: z.enum([
    "arquitecto",
    "constructora",
    "carpintero",
    "disenador",
    "instalador",
    "otro",
  ]),
  matricula: z.string().trim().max(60).optional(),
  volumenEstimado: z.string().trim().max(120).optional(),
  localidad: z.string().trim().max(120).optional(),
  mensaje: z.string().trim().max(600).optional(),
});

/**
 * Solicitud de acceso al portal de profesionales.
 *
 * **La solicitud no habilita nada.** Crea una fila pendiente que alguien de la
 * casa aprueba desde el panel. Habilitarla sola sería regalar precios
 * diferenciados y cuenta corriente a quien complete un formulario, que es
 * exactamente el mismo error que ya se evitó con el registro de clientes: sin
 * verificación, un formulario no prueba nada sobre quién lo llenó.
 *
 * Lo único que se valida acá es el dígito verificador del CUIT, que atrapa los
 * errores de tipeo. Si el CUIT existe y de quién es lo resuelve el vendedor
 * antes de aprobar.
 */
export async function solicitarAcceso(
  _previo: EstadoSolicitud,
  formData: FormData,
): Promise<EstadoSolicitud> {
  const parsed = esquema.safeParse({
    nombre: formData.get("nombre"),
    razonSocial: (formData.get("razonSocial") as string) || undefined,
    cuit: formData.get("cuit"),
    email: formData.get("email"),
    telefono: formData.get("telefono"),
    rubro: formData.get("rubro"),
    matricula: (formData.get("matricula") as string) || undefined,
    volumenEstimado: (formData.get("volumenEstimado") as string) || undefined,
    localidad: (formData.get("localidad") as string) || undefined,
    mensaje: (formData.get("mensaje") as string) || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  }

  const datos = parsed.data;
  const cuit = soloDigitos(datos.cuit);
  const sesion = await getSession();

  // Una solicitud pendiente por CUIT: mandar el formulario tres veces no debe
  // llenar la cola del panel con lo mismo.
  const [pendiente] = await db
    .select({ id: professionalApplications.id })
    .from(professionalApplications)
    .where(
      and(
        eq(professionalApplications.cuit, cuit),
        eq(professionalApplications.estado, "pendiente"),
      ),
    )
    .limit(1);

  if (pendiente) {
    return {
      ok: "Ya tenemos tu solicitud y la estamos revisando. Te contestamos dentro de las próximas 24 horas hábiles.",
    };
  }

  const [solicitud] = await db
    .insert(professionalApplications)
    .values({
      ...datos,
      cuit,
      razonSocial: datos.razonSocial ?? null,
      matricula: datos.matricula ?? null,
      volumenEstimado: datos.volumenEstimado ?? null,
      localidad: datos.localidad ?? null,
      mensaje: datos.mensaje ?? null,
      userId: sesion?.userId ?? null,
    })
    .returning({ id: professionalApplications.id });

  revalidatePath("/admin/profesionales");

  after(async () => {
    await notificarSolicitudProfesional(solicitud.id);
  });

  return {
    ok: "Recibimos tu solicitud. Te contestamos dentro de las próximas 24 horas hábiles.",
  };
}
