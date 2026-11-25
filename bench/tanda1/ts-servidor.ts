/**
 * El lado TypeScript del benchmark de la tanda 1: la lectura de sesión **como
 * era antes de la mudanza** —better-auth getSession + la consulta del perfil,
 * la misma lógica que tenía lib/dal/session.ts—, servida por node:http.
 *
 * Sin Next en el medio, a propósito: así se compara el lenguaje y sus
 * librerías, no el framework. (Con Next adelante, el lado TS sería más lento,
 * no más rápido.)
 *
 *   BENCH_BASE=postgres://… npx tsx bench/tanda1/ts-servidor.ts   # escucha en :8091
 */
import { createServer } from "node:http";
import { betterAuth } from "better-auth";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { buildAuthOptions } from "../../scripts/golden/auth-opciones";
import * as schema from "../../lib/db/schema";

// El mismo tamaño de pool que tenía la aplicación (DATABASE_POOL_MAX = 10)
// y que la API de Go (20): se usa el de Go para que el pool no sea la
// diferencia.
const pool = new Pool({ connectionString: process.env.BENCH_BASE, max: 20 });
const db = drizzle(pool, { schema, casing: "snake_case" });
const auth = betterAuth({
  ...buildAuthOptions(db),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: "http://localhost:3100",
});

async function sesion(cookie: string) {
  const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
  if (!session?.user) return null;
  const [perfil] = await db
    .select({ role: schema.profiles.role, staffRole: schema.profiles.staffRole, priceListId: schema.profiles.priceListId })
    .from(schema.profiles)
    .where(eq(schema.profiles.userId, session.user.id))
    .limit(1);
  return {
    userId: session.user.id,
    nombre: session.user.name,
    correo: session.user.email,
    rol: perfil?.role ?? "cliente",
    rolStaff: perfil?.staffRole ?? null,
    listaDePrecios: perfil?.priceListId ?? null,
  };
}

createServer(async (req, res) => {
  if (req.url === "/salud") return res.end("ok");
  try {
    const s = await sesion(req.headers.cookie ?? "");
    res.writeHead(s ? 200 : 401, { "content-type": "application/json" });
    res.end(JSON.stringify(s));
  } catch (e) {
    res.writeHead(500);
    res.end(String(e));
  }
}).listen(8091, () => console.log("ts-servidor en :8091"));
