import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { inicioDelRol, type RolStaff } from "@/lib/roles";

export { inicioDelRol, type RolStaff };
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";

/**
 * Capa de acceso a datos.
 *
 * En este proyecto no hay Row Level Security: la base solo se toca desde el
 * servidor con una única credencial. Eso convierte a estas funciones en la única
 * línea de defensa, así que la regla es estricta:
 *
 *   toda consulta que devuelva datos de una persona filtra por el userId que sale
 *   de acá, nunca por uno que venga del cliente.
 *
 * `cache()` memoiza durante un mismo render, para no repetir la consulta de sesión
 * en cada componente que la necesite.
 */

export interface SessionUser {
  userId: string;
  name: string;
  email: string;
  role: "cliente" | "profesional" | "staff";
  staffRole: RolStaff | null;
  priceListId: string | null;
}

/** Devuelve la sesión o null. No redirige: sirve para UI que cambia si hay login. */
export const getSession = cache(async (): Promise<SessionUser | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;

  const [profile] = await db
    .select({
      role: profiles.role,
      staffRole: profiles.staffRole,
      priceListId: profiles.priceListId,
    })
    .from(profiles)
    .where(eq(profiles.userId, session.user.id))
    .limit(1);

  return {
    userId: session.user.id,
    name: session.user.name,
    email: session.user.email,
    role: profile?.role ?? "cliente",
    staffRole: profile?.staffRole ?? null,
    priceListId: profile?.priceListId ?? null,
  };
});

/** Exige sesión. Si no hay, manda a login. */
export const verifySession = cache(async (): Promise<SessionUser> => {
  const session = await getSession();
  if (!session) redirect("/ingresar");
  return session;
});

/** Exige que sea personal de la empresa. Protege todo `/admin`. */
export const requireStaff = cache(async (): Promise<SessionUser> => {
  const session = await verifySession();
  if (session.role !== "staff" || !session.staffRole) {
    redirect("/");
  }
  return session;
});

/**
 * Como `requireStaff`, pero para los Route Handlers.
 *
 * `requireStaff` hace `redirect("/ingresar")`, que en una página es lo correcto
 * y en un endpoint es un desastre: el `fetch` sigue la redirección y recibe el
 * **HTML del login con status 200**. La cola de sincronización del mostrador
 * daría por buena esa respuesta y borraría una venta que nunca se guardó.
 *
 * Devuelve `null` y el handler contesta 401, que es lo que la cola sabe leer:
 * retener todo y pedir que alguien vuelva a entrar.
 */
export const staffOrNull = cache(async (): Promise<SessionUser | null> => {
  const session = await getSession();
  if (!session || session.role !== "staff" || !session.staffRole) return null;
  return session;
});

/** Exige un rol concreto dentro del panel. */
export const requireStaffRole = cache(
  async (
    ...allowed: ReadonlyArray<RolStaff>
  ): Promise<SessionUser> => {
    const session = await requireStaff();
    if (!allowed.includes(session.staffRole!)) redirect(inicioDelRol(session.staffRole));
    return session;
  },
);
