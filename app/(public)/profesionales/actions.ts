"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { professionalApplications } from "@/lib/db/schema";
import { getSession } from "@/lib/dal/session";
import { documentoValido, soloDigitos } from "@/lib/cuit";
import { notificarSolicitudProfesional } from "@/lib/notificaciones/profesionales";

export interface EstadoSolicitud {
  error?: string;
  ok?: string;
  /**
   * Lo que la persona había escrito, para devolvérselo si algo falló.
   *
   * React vacía el formulario después de ejecutar la acción. Sin esto, alguien
   * que se equivoca en un dígito del documento pierde los otros seis campos y
   * tiene que volver a tipear todo: es la forma más segura de que abandone a
   * mitad, que es justamente lo que este formulario corto trata de evitar.
   */
  valores?: Record<string, string>;
  /**
   * Cuántas veces se rechazó.
   *
   * Es lo que le da al formulario una `key` distinta en cada intento. Con la
   * sola presencia del error no alcanza: equivocarse dos veces en lo mismo da
   * el mismo mensaje, React no rehace los campos y lo tipeado no se repinta.
   */
  intento?: number;
}

/** Lo tipeado, para poder repintarlo si la validación rechaza. */
function loEscrito(formData: FormData): Record<string, string> {
  const campos = [
    "nombre",
    "razonSocial",
    "documentoTipo",
    "documentoNumero",
    "email",
    "telefono",
    "rubro",
    "volumenEstimado",
    "redSocial",
    "mensaje",
  ];

  return Object.fromEntries(
    campos.map((c) => [c, String(formData.get(c) ?? "")]),
  );
}

const esquema = z
  .object({
    nombre: z.string().trim().min(3, "Escribí tu nombre y apellido.").max(120),
    razonSocial: z.string().trim().max(160).optional(),
    documentoTipo: z.enum(["dni", "cuit"]),
    documentoNumero: z.string().trim().min(1, "Dejanos tu DNI o CUIT."),
    email: z.string().trim().email("Revisá el correo."),
    telefono: z.string().trim().min(6, "Dejanos un teléfono.").max(40),
    rubro: z.enum([
      "arquitecto",
      "constructora",
      "carpintero",
      "disenador",
      "instalador",
      "woodframer",
      "otro",
    ]),
    volumenEstimado: z.string().trim().max(120).optional(),
    redSocial: z.string().trim().max(160).optional(),
    mensaje: z.string().trim().max(600).optional(),
  })
  // El número se valida contra el tipo elegido: once dígitos con verificador si
  // es CUIT, siete u ocho si es DNI. Validarlo suelto dejaría pasar un DNI en el
  // campo del CUIT, que es justo el error que este formulario tiene que atrapar.
  .refine((d) => documentoValido(d.documentoTipo, d.documentoNumero), {
    path: ["documentoNumero"],
    message: "Revisá el número: no coincide con el tipo de documento.",
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
 * Lo único que se valida acá es la forma del documento —el dígito verificador
 * si es CUIT, la cantidad de dígitos si es DNI—, que atrapa los errores de
 * tipeo. Si el número existe y de quién es lo resuelve el vendedor antes de
 * aprobar.
 *
 * El CUIT dejó de ser obligatorio por pedido de la clienta. Vale la pena tener
 * presente que quien se anota con DNI no puede recibir factura A ni ver precios
 * netos: entra al portal igual, pero fiscalmente es consumidor final.
 */
export async function solicitarAcceso(
  previo: EstadoSolicitud,
  formData: FormData,
): Promise<EstadoSolicitud> {
  const parsed = esquema.safeParse({
    nombre: formData.get("nombre"),
    razonSocial: (formData.get("razonSocial") as string) || undefined,
    documentoTipo: formData.get("documentoTipo"),
    documentoNumero: formData.get("documentoNumero"),
    email: formData.get("email"),
    telefono: formData.get("telefono"),
    rubro: formData.get("rubro"),
    volumenEstimado: (formData.get("volumenEstimado") as string) || undefined,
    redSocial: (formData.get("redSocial") as string) || undefined,
    mensaje: (formData.get("mensaje") as string) || undefined,
  });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Revisá los datos.",
      valores: loEscrito(formData),
      intento: (previo.intento ?? 0) + 1,
    };
  }

  const datos = parsed.data;
  const numero = soloDigitos(datos.documentoNumero);
  const sesion = await getSession();

  // Una solicitud pendiente por documento: mandar el formulario tres veces no
  // debe llenar la cola del panel con lo mismo. Antes era por CUIT, que ahora
  // puede venir vacío.
  const [pendiente] = await db
    .select({ id: professionalApplications.id })
    .from(professionalApplications)
    .where(
      and(
        eq(professionalApplications.documentoNumero, numero),
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
      documentoNumero: numero,
      // Se proyecta a `cuit` solo cuando lo es: es la columna por la que después
      // se engancha la ficha de cliente y todo lo fiscal.
      cuit: datos.documentoTipo === "cuit" ? numero : null,
      razonSocial: datos.razonSocial ?? null,
      volumenEstimado: datos.volumenEstimado ?? null,
      redSocial: datos.redSocial ?? null,
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
