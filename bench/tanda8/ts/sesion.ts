// La sesión y la bitácora, sin Next. requireStaff devuelve el admin de la
// base del benchmark (BENCH_USUARIO); la bitácora escribe su fila como el TS.
import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";

const usuario = { userId: process.env.BENCH_USUARIO ?? "", name: "Bench", role: "staff", staffRole: "admin" };
export async function requireStaff() {
  return usuario;
}
export async function requireStaffRole(..._roles: string[]) {
  return usuario;
}
export async function registrarEnBitacora(d: { accion: string; entidad: string; descripcion: string; detalle?: unknown }) {
  await db.insert(auditLog).values({
    usuarioId: usuario.userId,
    usuarioNombre: usuario.name,
    accion: d.accion as never,
    entidad: d.entidad,
    descripcion: d.descripcion,
    detalle: (d.detalle ?? null) as never,
  } as never);
}
