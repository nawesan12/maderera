import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { inicioDelRol, type RolStaff } from "@/lib/roles";
import { api } from "@/lib/api/servidor";

export { inicioDelRol, type RolStaff };

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

/**
 * Devuelve la sesión o null. No redirige: sirve para UI que cambia si hay login.
 *
 * La sesión es de la API de Go (backend/internal/auth): valida la cookie,
 * renueva la sesión si corresponde y trae el rol del perfil, todo en una
 * consulta. Sin sesión contesta 401; cualquier otra cosa es un error de
 * verdad y se propaga (no se trata como «anónimo» a alguien que sí entró).
 */
export const getSession = cache(async (): Promise<SessionUser | null> => {
  const { data, response } = await (await api()).GET("/api/v1/sesion");
  if (response.status === 401) return null;
  if (!data) throw new Error(`La API de sesión respondió ${response.status}`);
  return {
    userId: data.userId,
    name: data.nombre,
    email: data.correo,
    role: data.rol,
    staffRole: data.rolStaff,
    priceListId: data.listaDePrecios,
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
