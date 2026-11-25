/**
 * Entrar con clave en TypeScript, como era antes: better-auth signInEmail,
 * con 12 a la vez (los mismos que GOMAXPROCS del lado Go). Node hace el
 * scrypt en el pool de libuv, de 4 hilos por omisión.
 *
 *   BENCH_BASE=postgres://… npx tsx bench/tanda1/entrar-ts.ts
 */
import { betterAuth } from "better-auth";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { buildAuthOptions } from "../../scripts/golden/auth-opciones";
import * as schema from "../../lib/db/schema";

const pool = new Pool({ connectionString: process.env.BENCH_BASE, max: 20 });
const db = drizzle(pool, { schema, casing: "snake_case" });
const auth = betterAuth({ ...buildAuthOptions(db), secret: "secreto-de-benchmark-mjbj-con-32-caracteres-o-mas", baseURL: "http://localhost" });

async function main() {
  const total = 60, aLaVez = 12;
  // Calentar.
  for (let i = 0; i < 4; i++) await auth.api.signInEmail({ body: { email: "bench@mjbj.com.ar", password: "clave de benchmark" } });
  let hechos = 0;
  const inicio = performance.now();
  await Promise.all(
    Array.from({ length: aLaVez }, async () => {
      while (hechos < total) {
        hechos++;
        await auth.api.signInEmail({ body: { email: "bench@mjbj.com.ar", password: "clave de benchmark" } });
      }
    }),
  );
  const s = (performance.now() - inicio) / 1000;
  console.log(`ts   entradas/s=${(total / s).toFixed(2)}  promedio_por_entrada=${((s / total) * 1000).toFixed(1)}ms (pool libuv ${process.env.UV_THREADPOOL_SIZE ?? 4})`);
  await pool.end();
}
main();
