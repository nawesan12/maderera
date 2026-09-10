"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { sellers } from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";
import { registrarEnBitacora } from "@/lib/dal/admin/auditoria";

export interface EstadoVendedor {
  error?: string;
  ok?: string;
}

const esquema = z.object({
  id: z.string().uuid().optional(),
  nombre: z.string().trim().min(2, "Poné el nombre.").max(80),
  tipo: z.enum(["salon", "calle"]),
});

export async function guardarVendedor(
  _previo: EstadoVendedor,
  formData: FormData,
): Promise<EstadoVendedor> {
  const usuario = await requireStaff();

  const parsed = esquema.safeParse({
    id: (formData.get("id") as string) || undefined,
    nombre: formData.get("nombre"),
    tipo: formData.get("tipo") ?? "salon",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  }

  const d = parsed.data;

  try {
    if (d.id) {
      await db
        .update(sellers)
        .set({ nombre: d.nombre, tipo: d.tipo })
        .where(eq(sellers.id, d.id));
    } else {
      await db.insert(sellers).values({ nombre: d.nombre, tipo: d.tipo });
    }
  } catch (e) {
    // El índice único sobre el nombre: dos "Gabriela" serían el mismo problema
    // que el texto libre venía causando.
    if (e instanceof Error && e.message.includes("sellers_nombre_idx")) {
      return { error: "Ya hay un vendedor con ese nombre." };
    }
    throw e;
  }

  await registrarEnBitacora({
    sesion: usuario,
    accion: d.id ? "editar" : "crear",
    entidad: "vendedor",
    entidadId: d.id ?? null,
    descripcion: `Vendedor: ${d.nombre} (${d.tipo === "calle" ? "de calle" : "de salón"})`,
  });

  revalidatePath("/admin/clientes/vendedores");
  return { ok: "Guardado." };
}

/**
 * Se desactiva, no se borra: la cartera y las ventas históricas lo referencian
 * y un vendedor que se fue sigue teniendo que aparecer en los reportes de
 * cuando estaba.
 */
export async function alternarVendedor(id: string): Promise<EstadoVendedor> {
  const usuario = await requireStaff();

  const [fila] = await db
    .select({ activo: sellers.activo, nombre: sellers.nombre })
    .from(sellers)
    .where(eq(sellers.id, id))
    .limit(1);

  if (!fila) return { error: "Ese vendedor ya no está." };

  await db
    .update(sellers)
    .set({ activo: !fila.activo })
    .where(eq(sellers.id, id));

  await registrarEnBitacora({
    sesion: usuario,
    accion: "editar",
    entidad: "vendedor",
    entidadId: id,
    descripcion: `Vendedor ${fila.activo ? "desactivado" : "reactivado"}: ${fila.nombre}`,
  });

  revalidatePath("/admin/clientes/vendedores");
  return { ok: fila.activo ? "Desactivado." : "Reactivado." };
}
