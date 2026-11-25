/**
 * La vuelta del golden de sesión: ¿better-auth acepta una cookie que escribió
 * Go? Ver backend/internal/auth/cruzada_test.go.
 *
 *   MJBJ_PRUEBA_BASE=… npx tsx scripts/golden/auth-verificar.ts <archivo-con-la-cookie>
 */
import { betterAuth } from "better-auth";
import { drizzle } from "drizzle-orm/node-postgres";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { buildAuthOptions } from "./auth-opciones";
import * as schema from "../../lib/db/schema";

const [cookie, userId] = readFileSync(process.argv[2], "utf8").trim().split("\n");
const pool = new Pool({ connectionString: process.env.MJBJ_PRUEBA_BASE });
const db = drizzle(pool, { schema, casing: "snake_case" });
const auth = betterAuth({
  ...buildAuthOptions(db),
  secret: "secreto-de-prueba-mjbj-con-32-caracteres-o-mas",
  baseURL: "https://mjbj.com.ar",
});
async function main() {
  const ses = await auth.api.getSession({ headers: new Headers({ cookie }) });
  await pool.end();
  if (ses?.user.id !== userId) {
    console.error("better-auth NO aceptó la cookie de Go:", ses);
    process.exit(1);
  }
  console.log("better-auth aceptó la sesión de Go:", ses.user.email);
}
void main();
