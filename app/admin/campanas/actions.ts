"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { campanas, type SegmentoCampana } from "@/lib/db/schema";
import { requireStaffRole } from "@/lib/dal/session";
import { registrarEnBitacora } from "@/lib/dal/admin/auditoria";
import { RUBROS_CLIENTE } from "@/lib/rubros-cliente";
import { leerSegmento, describirSegmento } from "@/lib/campanas/segmento";
import { armarCorreoDeCampana } from "@/lib/campanas/correo";
import { contarDestinatarios, iniciarEnvio, porMinuto, ErrorDeCampana } from "@/lib/campanas/envio";
import { proveedorEmail } from "@/lib/email";
import { procesarCola } from "@/lib/cola";
import { motivoParaNoEnviar } from "@/lib/campanas/disponible";

export interface EstadoCampana {
  ok?: string;
  error?: string;
  id?: string;
}

const RUBROS = RUBROS_CLIENTE.map((r) => r.valor);

/*
 * Una dirección web o una ruta del sitio. Nada de `javascript:` ni de otros
 * esquemas: el botón y la imagen van a cientos de casillas.
 */
const enlace = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === "" || /^https?:\/\//.test(v) || v.startsWith("/"), {
    message: "Tiene que empezar con https:// o con / (una página del sitio).",
  });

const esquema = z.object({
  asunto: z.string().trim().min(3, "Falta el asunto.").max(150, "El asunto es demasiado largo: en el celular se corta a los 40 caracteres."),
  adelanto: z.string().trim().max(150).optional(),
  cuerpo: z.string().trim().min(10, "Falta el texto de la campaña.").max(10_000),
  imagenUrl: enlace.optional(),
  botonTexto: z.string().trim().max(40).optional(),
  botonUrl: enlace.optional(),
});

function leerCampos(formData: FormData) {
  const datos = esquema.safeParse({
    asunto: formData.get("asunto"),
    adelanto: (formData.get("adelanto") as string) || undefined,
    cuerpo: formData.get("cuerpo"),
    imagenUrl: (formData.get("imagenUrl") as string) || undefined,
    botonTexto: (formData.get("botonTexto") as string) || undefined,
    botonUrl: (formData.get("botonUrl") as string) || undefined,
  });
  const segmento = leerSegmento(
    {
      tipo: formData.get("tipo") as string,
      rubros: formData.getAll("rubros") as string[],
      actividad: formData.get("actividad") as string,
      meses: formData.get("meses") as string,
    },
    RUBROS,
  );
  return { datos, segmento };
}

export async function guardarCampana(_previo: EstadoCampana, formData: FormData): Promise<EstadoCampana> {
  const usuario = await requireStaffRole("admin");
  const { datos, segmento } = leerCampos(formData);
  if (!datos.success) return { error: datos.error.issues[0]?.message ?? "Revisá los datos." };
  if (datos.data.botonTexto && !datos.data.botonUrl) return { error: "El botón necesita a dónde lleva." };

  const valores = {
    asunto: datos.data.asunto,
    adelanto: datos.data.adelanto ?? null,
    cuerpo: datos.data.cuerpo,
    imagenUrl: datos.data.imagenUrl || null,
    botonTexto: datos.data.botonTexto ?? null,
    botonUrl: datos.data.botonUrl || null,
    segmento,
    updatedAt: new Date(),
  };

  const id = (formData.get("id") as string) || null;
  if (id) {
    // Solo se edita lo que todavía no salió.
    const [editada] = await db
      .update(campanas)
      .set(valores)
      .where(and(eq(campanas.id, id), inArray(campanas.estado, ["borrador", "programada"])))
      .returning({ id: campanas.id });
    if (!editada) return { error: "Esa campaña ya se envió: no se puede editar. Podés duplicarla." };
    revalidatePath("/admin/campanas");
    return { ok: "Guardada.", id };
  }

  const [nueva] = await db
    .insert(campanas)
    .values({ ...valores, creadaPorUserId: usuario.userId, creadaPorNombre: usuario.name })
    .returning({ id: campanas.id });
  await registrarEnBitacora({
    sesion: usuario,
    accion: "crear",
    entidad: "campana",
    entidadId: nueva.id,
    descripcion: `Campaña «${valores.asunto}» (borrador)`,
  });
  revalidatePath("/admin/campanas");
  return { ok: "Guardada.", id: nueva.id };
}

/** A cuántas direcciones llega un segmento, para verlo mientras se elige. */
export async function alcanceDelSegmento(
  segmento: SegmentoCampana,
): Promise<{ cantidad: number; descripcion: string; porMinuto: number }> {
  await requireStaffRole("admin");
  const sano = leerSegmento(
    {
      tipo: segmento.tipo,
      rubros: segmento.rubros,
      actividad: segmento.actividad?.tipo ?? null,
      meses: segmento.actividad?.meses ?? null,
    },
    RUBROS,
  );
  return {
    cantidad: await contarDestinatarios(sano),
    descripcion: describirSegmento(sano),
    porMinuto: porMinuto(),
  };
}

/** El correo tal cual va a llegar, con el nombre de quien lo está armando. */
export async function vistaPrevia(formData: FormData): Promise<{ html?: string; error?: string }> {
  const usuario = await requireStaffRole("admin");
  const { datos } = leerCampos(formData);
  if (!datos.success) return { error: datos.error.issues[0]?.message };
  const correo = armarCorreoDeCampana(
    {
      asunto: datos.data.asunto,
      adelanto: datos.data.adelanto ?? null,
      cuerpo: datos.data.cuerpo,
      imagenUrl: datos.data.imagenUrl || null,
      botonTexto: datos.data.botonTexto ?? null,
      botonUrl: datos.data.botonUrl || null,
    },
    { email: usuario.email, nombre: usuario.name },
  );
  return { html: correo.html };
}

/**
 * Una prueba a la casilla de quien la arma. Es la única forma de ver cómo se
 * ve en Gmail o en el celular antes de mandarla a cientos.
 */
export async function enviarPrueba(formData: FormData): Promise<EstadoCampana> {
  const usuario = await requireStaffRole("admin");
  if (!proveedorEmail().real) return { error: "El envío de correos no está conectado todavía." };
  const { datos } = leerCampos(formData);
  if (!datos.success) return { error: datos.error.issues[0]?.message ?? "Revisá los datos." };

  const correo = armarCorreoDeCampana(
    {
      asunto: datos.data.asunto,
      adelanto: datos.data.adelanto ?? null,
      cuerpo: datos.data.cuerpo,
      imagenUrl: datos.data.imagenUrl || null,
      botonTexto: datos.data.botonTexto ?? null,
      botonUrl: datos.data.botonUrl || null,
    },
    { email: usuario.email, nombre: usuario.name },
  );
  const r = await proveedorEmail().enviar({
    para: usuario.email,
    asunto: `[Prueba] ${correo.asunto}`,
    html: correo.html,
    texto: correo.texto,
    cabeceras: correo.cabeceras,
  });
  return r.enviado ? { ok: `Te la mandamos a ${usuario.email}.` } : { error: r.error ?? "No salió." };
}

export async function enviarCampana(id: string): Promise<EstadoCampana> {
  const usuario = await requireStaffRole("admin");
  const impedimento = motivoParaNoEnviar();
  if (impedimento) return { error: impedimento };

  try {
    const { destinatarios } = await iniciarEnvio(id);
    await registrarEnBitacora({
      sesion: usuario,
      accion: "cambiar_estado",
      entidad: "campana",
      entidadId: id,
      descripcion: `Envió la campaña a ${destinatarios} direcciones`,
    });
    // La primera tanda sale ya; las siguientes, una por minuto con el cron.
    after(() => procesarCola({ limite: 1 }));
    revalidatePath("/admin/campanas");
    revalidatePath(`/admin/campanas/${id}`);
    return { ok: `Saliendo a ${destinatarios} ${destinatarios === 1 ? "dirección" : "direcciones"}.` };
  } catch (error) {
    if (error instanceof ErrorDeCampana) return { error: error.message };
    throw error;
  }
}

export async function programarCampana(id: string, cuando: string): Promise<EstadoCampana> {
  const usuario = await requireStaffRole("admin");
  const impedimento = motivoParaNoEnviar();
  if (impedimento) return { error: impedimento };

  // Llega de un `datetime-local`, sin zona: es la hora de Buenos Aires.
  const fecha = new Date(`${cuando}:00-03:00`);
  if (Number.isNaN(fecha.getTime())) return { error: "La fecha no es válida." };
  if (fecha.getTime() < Date.now() + 60_000) return { error: "Para mandarla ahora, usá «Enviar ahora»." };

  const [fila] = await db
    .update(campanas)
    .set({ estado: "programada", programadaPara: fecha, updatedAt: new Date() })
    .where(and(eq(campanas.id, id), inArray(campanas.estado, ["borrador", "programada"])))
    .returning({ id: campanas.id });
  if (!fila) return { error: "Esa campaña ya se envió." };

  await registrarEnBitacora({
    sesion: usuario,
    accion: "cambiar_estado",
    entidad: "campana",
    entidadId: id,
    descripcion: `Programó la campaña para el ${fecha.toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}`,
  });
  revalidatePath(`/admin/campanas/${id}`);
  revalidatePath("/admin/campanas");
  return { ok: "Programada." };
}

export async function desprogramarCampana(id: string): Promise<EstadoCampana> {
  await requireStaffRole("admin");
  await db
    .update(campanas)
    .set({ estado: "borrador", programadaPara: null, updatedAt: new Date() })
    .where(and(eq(campanas.id, id), eq(campanas.estado, "programada")));
  revalidatePath(`/admin/campanas/${id}`);
  revalidatePath("/admin/campanas");
  return { ok: "Volvió a borrador." };
}

/**
 * Corta un envío en curso. Lo que ya salió, salió; lo pendiente queda como
 * omitido, para que el conteo diga exactamente a quién no le llegó.
 */
export async function cancelarEnvio(id: string): Promise<EstadoCampana> {
  const usuario = await requireStaffRole("admin");
  const omitidos = await db.transaction(async (tx) => {
    const [fila] = await tx
      .update(campanas)
      .set({ estado: "cancelada", terminadaAt: new Date(), updatedAt: new Date() })
      .where(and(eq(campanas.id, id), eq(campanas.estado, "enviando")))
      .returning({ id: campanas.id });
    if (!fila) return null;
    const r = await tx.execute(sql`
      update campana_envios set estado = 'omitido' where campana_id = ${id} and estado = 'pendiente'
    `);
    return r.rowCount ?? 0;
  });
  if (omitidos === null) return { error: "Esa campaña no se está enviando." };

  await registrarEnBitacora({
    sesion: usuario,
    accion: "cambiar_estado",
    entidad: "campana",
    entidadId: id,
    descripcion: `Canceló el envío; ${omitidos} direcciones quedaron sin mandar`,
  });
  revalidatePath(`/admin/campanas/${id}`);
  revalidatePath("/admin/campanas");
  return { ok: `Cancelada. ${omitidos} quedaron sin mandar.` };
}

export async function duplicarCampana(id: string): Promise<EstadoCampana> {
  const usuario = await requireStaffRole("admin");
  const [original] = await db.select().from(campanas).where(eq(campanas.id, id)).limit(1);
  if (!original) return { error: "No existe esa campaña." };
  const [copia] = await db
    .insert(campanas)
    .values({
      asunto: original.asunto,
      adelanto: original.adelanto,
      cuerpo: original.cuerpo,
      imagenUrl: original.imagenUrl,
      botonTexto: original.botonTexto,
      botonUrl: original.botonUrl,
      segmento: original.segmento,
      creadaPorUserId: usuario.userId,
      creadaPorNombre: usuario.name,
    })
    .returning({ id: campanas.id });
  revalidatePath("/admin/campanas");
  return { ok: "Duplicada.", id: copia.id };
}

export async function eliminarBorrador(id: string): Promise<EstadoCampana> {
  const usuario = await requireStaffRole("admin");
  const [fila] = await db
    .delete(campanas)
    .where(and(eq(campanas.id, id), eq(campanas.estado, "borrador")))
    .returning({ asunto: campanas.asunto });
  if (!fila) return { error: "Solo se borran los borradores: lo enviado queda como registro." };
  await registrarEnBitacora({
    sesion: usuario,
    accion: "eliminar",
    entidad: "campana",
    entidadId: id,
    descripcion: `Borró el borrador «${fila.asunto}»`,
  });
  revalidatePath("/admin/campanas");
  return { ok: "Borrador eliminado." };
}
