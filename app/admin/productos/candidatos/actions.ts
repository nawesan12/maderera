"use server";

import { revalidatePath } from "next/cache";
import { guardarMesesSinVender } from "@/lib/dal/admin/parametros-catalogo";
import { registrarEnBitacora } from "@/lib/dal/admin/auditoria";
import { requireStaffRole } from "@/lib/dal/session";

/**
 * Cambia desde cuántos meses sin venta se señala un producto.
 *
 * Queda en la bitácora: es un parámetro que cambia qué ve todo el equipo en
 * esta pantalla, y en un mes nadie se acuerda de quién lo movió ni por qué la
 * lista pasó de cinco a cuarenta.
 */
export async function cambiarMesesSinVender(meses: number) {
  const usuario = await requireStaffRole("admin");

  const resultado = await guardarMesesSinVender(meses);
  if (resultado.error) return resultado;

  await registrarEnBitacora({
    sesion: usuario,
    accion: "editar",
    entidad: "producto",
    descripcion: `Cambió el umbral de candidatos a baja a ${meses} meses sin ventas`,
  });

  revalidatePath("/admin/productos/candidatos");
  return resultado;
}
