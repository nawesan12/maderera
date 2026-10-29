// La sesión, sin Next. requireStaff devuelve el admin de la base del
// benchmark (BENCH_USUARIO); getSession, la cuenta web del profesional
// (BENCH_CLIENTE). clienteDeLaSesion es la de lib/dal/cuenta.ts tal cual
// (sin el cache() de React, que fuera de Next no memoiza nada).
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers } from "@/lib/db/schema";

const usuario = { userId: process.env.BENCH_USUARIO ?? "", name: "Bench", role: "staff", staffRole: "admin" };
export async function requireStaff() {
  return usuario;
}
export async function requireStaffRole() {
  return usuario;
}
export async function getSession() {
  return { userId: process.env.BENCH_CLIENTE ?? "", name: "Cliente", email: "c@bench.test" };
}

export async function clienteDeLaSesion() {
  const sesion = await getSession();
  const [cliente] = await db
    .select({
      id: customers.id,
      nombre: customers.nombre,
      razonSocial: customers.razonSocial,
      cuit: customers.cuit,
      condicionIva: customers.condicionIva,
      email: customers.email,
      telefono: customers.telefono,
      direccion: customers.direccion,
      tipo: customers.tipo,
      estado: customers.estado,
      limiteCredito: customers.limiteCredito,
    })
    .from(customers)
    .where(and(eq(customers.userId, sesion.userId), eq(customers.active, true)))
    .limit(1);
  if (!cliente) return null;
  return { ...cliente, limiteCredito: Number(cliente.limiteCredito) };
}
