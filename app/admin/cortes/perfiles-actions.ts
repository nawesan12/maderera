"use server";

import { revalidatePath } from "next/cache";
import { eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { cuttingExportProfiles } from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";
import { registrarEnBitacora } from "@/lib/dal/admin/auditoria";
import { COLUMNAS, type ClaveColumna } from "@/lib/cortes/formatos";

export interface EstadoPerfil {
  error?: string;
  ok?: string;
}

const claves = Object.keys(COLUMNAS) as [ClaveColumna, ...ClaveColumna[]];

const esquema = z.object({
  id: z.string().uuid().optional(),
  nombre: z.string().trim().min(2, "Poné un nombre.").max(80),
  programa: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((v) => (v ? v : null)),
  separador: z.enum([";", ",", "tab", "|"]),
  conEncabezado: z.boolean(),
  unidad: z.enum(["mm", "cm", "m"]),
  decimal: z.enum([",", "."]),
  valorSi: z.string().trim().min(1).max(10),
  valorNo: z.string().trim().min(1).max(10),
  finDeLinea: z.enum(["crlf", "lf"]),
  columnas: z
    .array(z.object({ clave: z.enum(claves), encabezado: z.string().trim().max(40) }))
    .min(1, "Elegí al menos una columna."),
  porDefecto: z.boolean(),
});

/**
 * Alta y edición de un perfil de exportación.
 *
 * Se guarda desde el panel y no desde el código porque acertarle al formato del
 * optimizador es prueba y error contra la máquina: se exporta, se importa, se
 * mira qué quedó mal, se corrige. Con un deploy por intento eso no se termina
 * nunca.
 */
export async function guardarPerfil(
  _previo: EstadoPerfil,
  formData: FormData,
): Promise<EstadoPerfil> {
  const usuario = await requireStaff();

  let columnas: unknown = [];
  try {
    columnas = JSON.parse(String(formData.get("columnas") ?? "[]"));
  } catch {
    return { error: "No se entendió la configuración de columnas." };
  }

  const parsed = esquema.safeParse({
    id: (formData.get("id") as string) || undefined,
    nombre: formData.get("nombre"),
    programa: (formData.get("programa") as string) || undefined,
    separador: formData.get("separador") ?? ";",
    conEncabezado: formData.get("conEncabezado") === "on",
    unidad: formData.get("unidad") ?? "mm",
    decimal: formData.get("decimal") ?? ",",
    valorSi: (formData.get("valorSi") as string) || "Sí",
    valorNo: (formData.get("valorNo") as string) || "No",
    finDeLinea: formData.get("finDeLinea") ?? "crlf",
    columnas,
    porDefecto: formData.get("porDefecto") === "on",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  }

  const d = parsed.data;
  const campos = {
    nombre: d.nombre,
    programa: d.programa,
    separador: d.separador,
    conEncabezado: d.conEncabezado,
    unidad: d.unidad,
    decimal: d.decimal,
    valorSi: d.valorSi,
    valorNo: d.valorNo,
    finDeLinea: d.finDeLinea,
    columnas: JSON.stringify(d.columnas),
    porDefecto: d.porDefecto,
    updatedAt: new Date(),
  };

  let id = d.id;

  if (id) {
    await db.update(cuttingExportProfiles).set(campos).where(eq(cuttingExportProfiles.id, id));
  } else {
    const [creado] = await db
      .insert(cuttingExportProfiles)
      .values(campos)
      .returning({ id: cuttingExportProfiles.id });
    id = creado?.id;
  }

  // Uno solo por defecto: si hay dos, cuál se usa depende del orden en que
  // salgan de la base, que es lo mismo que decir "cualquiera".
  if (d.porDefecto && id) {
    await db
      .update(cuttingExportProfiles)
      .set({ porDefecto: false })
      .where(ne(cuttingExportProfiles.id, id));
  }

  await registrarEnBitacora({
    sesion: usuario,
    accion: d.id ? "editar" : "crear",
    entidad: "corte",
    entidadId: id ?? null,
    descripcion: `${d.id ? "Editó" : "Creó"} el formato de exportación «${d.nombre}»`,
  });

  revalidatePath("/admin/cortes/formato");
  return { ok: "Formato guardado." };
}

export async function borrarPerfil(
  _previo: EstadoPerfil,
  formData: FormData,
): Promise<EstadoPerfil> {
  const usuario = await requireStaff();

  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: "No se pudo identificar el formato." };

  const [borrado] = await db
    .delete(cuttingExportProfiles)
    .where(eq(cuttingExportProfiles.id, id.data))
    .returning({ nombre: cuttingExportProfiles.nombre });

  if (!borrado) return { error: "Ese formato ya no estaba." };

  await registrarEnBitacora({
    sesion: usuario,
    accion: "eliminar",
    entidad: "corte",
    entidadId: id.data,
    descripcion: `Borró el formato de exportación «${borrado.nombre}»`,
  });

  revalidatePath("/admin/cortes/formato");
  return { ok: "Formato borrado." };
}
