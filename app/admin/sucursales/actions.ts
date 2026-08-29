"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { branches } from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";
import { registrarEnBitacora } from "@/lib/dal/admin/auditoria";

export interface EstadoSucursal {
  error?: string;
  ok?: string;
}

/**
 * La ficha de sucursal se ve en cuatro lugares del sitio público —la página de
 * sucursales, el pie, el checkout con retiro y el marcado de Google— así que
 * guardar tiene que refrescarlos a todos. Un teléfono corregido que sigue
 * apareciendo viejo en el pie es peor que no haberlo corregido.
 */
function refrescar() {
  revalidatePath("/admin/sucursales");
  revalidatePath("/sucursales");
  revalidatePath("/contacto");
  revalidatePath("/checkout");
  revalidatePath("/");
}

/** Campo de texto que se guarda vacío como `null` y no como cadena vacía. */
const textoOpcional = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((v) => (v ? v : null));

const esquema = z.object({
  id: z.string().uuid(),
  nombre: z.string().trim().min(3, "El nombre es muy corto.").max(120),
  direccion: z.string().trim().max(200),
  telefono: textoOpcional,
  whatsapp: textoOpcional,
  email: z
    .string()
    .trim()
    .max(160)
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || z.string().email().safeParse(v).success, {
      message: "El correo no tiene un formato válido.",
    }),
  horario: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v) => (v ? v : null)),
  mapUrl: z
    .string()
    .trim()
    .max(600)
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^https?:\/\//.test(v), {
      message: "El enlace del mapa tiene que empezar con http:// o https://",
    }),
  servicios: z.string().max(1200).default(""),
  destacados: z.string().max(600).default(""),
  active: z.boolean(),
});

/** Normaliza una lista escrita por renglones: sin vacíos ni espacios de sobra. */
function porRenglones(texto: string): string {
  return texto
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}

export async function guardarSucursal(
  _previo: EstadoSucursal,
  formData: FormData,
): Promise<EstadoSucursal> {
  const sesion = await requireStaff();

  const parsed = esquema.safeParse({
    id: formData.get("id"),
    nombre: formData.get("nombre"),
    direccion: formData.get("direccion") ?? "",
    telefono: formData.get("telefono") ?? undefined,
    whatsapp: formData.get("whatsapp") ?? undefined,
    email: formData.get("email") ?? undefined,
    horario: formData.get("horario") ?? undefined,
    mapUrl: formData.get("mapUrl") ?? undefined,
    servicios: (formData.get("servicios") as string) ?? "",
    destacados: (formData.get("destacados") as string) ?? "",
    active: formData.get("active") === "on" || formData.get("active") === "true",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  }

  const datos = parsed.data;

  const [antes] = await db
    .select({ id: branches.id, nombre: branches.name })
    .from(branches)
    .where(eq(branches.id, datos.id))
    .limit(1);

  if (!antes) return { error: "Esa sucursal no existe." };

  await db
    .update(branches)
    .set({
      name: datos.nombre,
      address: datos.direccion,
      phone: datos.telefono,
      whatsapp: datos.whatsapp,
      email: datos.email,
      hours: datos.horario,
      mapUrl: datos.mapUrl,
      servicios: porRenglones(datos.servicios),
      destacados: porRenglones(datos.destacados),
      active: datos.active,
    })
    .where(eq(branches.id, datos.id));

  await registrarEnBitacora({
    sesion,
    accion: "editar",
    entidad: "sucursal",
    entidadId: datos.id,
    descripcion: `Editó la ficha de ${datos.nombre}`,
  });

  refrescar();

  return { ok: "Ficha guardada." };
}
