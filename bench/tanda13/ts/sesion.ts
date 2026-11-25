// La sesión y la bitácora, sin Next. requireStaffRole devuelve el admin de la
// base del benchmark (BENCH_USUARIO); la bitácora escribe su fila como el TS.
import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";

const usuario = { userId: process.env.BENCH_USUARIO ?? "", name: "Bench", role: "staff", staffRole: "admin" };

export async function requireStaffRole(..._roles: string[]) {
  return usuario;
}

export async function registrarEnBitacora(d: {
  sesion: unknown;
  accion: string;
  entidad: string;
  entidadId?: string;
  descripcion: string;
  detalle?: unknown;
}) {
  await db.insert(auditLog).values({
    usuarioId: usuario.userId,
    usuarioNombre: usuario.name,
    accion: d.accion as never,
    entidad: d.entidad,
    entidadId: d.entidadId,
    descripcion: d.descripcion,
    detalle: (d.detalle === undefined ? null : JSON.stringify(d.detalle)) as never,
  } as never);
}
