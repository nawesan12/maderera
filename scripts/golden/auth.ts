/**
 * Casos golden de la sesión: lo que hace better-auth de verdad, para que el
 * Go (backend/internal/auth) demuestre que lee lo mismo.
 *
 *   MJBJ_PRUEBA_BASE=postgres://…/una_base_migrada npx tsx scripts/golden/auth.ts
 *
 * Registra usuarios y entra con ellos usando la misma configuración que la
 * aplicación (lib/auth-options.ts), y guarda en
 * backend/testdata/golden/auth/better-auth.json:
 *
 *   - las filas que quedaron en user, account, session y profiles (el test de
 *     Go las inserta en una base limpia y valida las cookies contra ellas);
 *   - las cookies que mandó better-auth al registrar y al entrar;
 *   - hashes de claves, incluidas con tildes y formas Unicode distintas
 *     (better-auth normaliza con NFKC antes del scrypt);
 *   - firmas de cookie para tokens cualquiera.
 *
 * **Usa una base descartable**: crea usuarios.
 */
import { betterAuth } from "better-auth";
import { hashPassword } from "better-auth/crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { writeFileSync, mkdirSync } from "node:fs";
import { Pool } from "pg";
import { buildAuthOptions } from "./auth-opciones";
import * as schema from "../../lib/db/schema";

const url = process.env.MJBJ_PRUEBA_BASE;
if (!url) throw new Error("Falta MJBJ_PRUEBA_BASE (una base descartable, ya migrada)");

// Un secreto fijo de prueba: las firmas tienen que salir iguales en Go.
const SECRETO = "secreto-de-prueba-mjbj-con-32-caracteres-o-mas";

const pool = new Pool({ connectionString: url });
const db = drizzle(pool, { schema, casing: "snake_case" });

async function cookiesDe(resp: Response) {
  return resp.headers.getSetCookie();
}

async function main() {
  const salida: Record<string, unknown> = { secreto: SECRETO, generado: new Date().toISOString() };

  for (const [nombre, baseURL] of [
    ["http", "http://localhost:3100"],
    ["https", "https://mjbj.com.ar"],
  ] as const) {
    const auth = betterAuth({ ...buildAuthOptions(db), secret: SECRETO, baseURL });
    const email = `golden-${nombre}-${Date.now()}@prueba.test`;
    const clave = "Clave con ñ y tilde á 2026";
    const alta = await auth.api.signUpEmail({
      body: { name: `Golden ${nombre}`, email, password: clave },
      asResponse: true,
    });
    if (!alta.ok) throw new Error(`alta ${nombre}: ${alta.status} ${await alta.text()}`);
    const entrada = await auth.api.signInEmail({
      body: { email, password: clave },
      asResponse: true,
    });
    if (!entrada.ok) throw new Error(`entrada ${nombre}: ${entrada.status}`);
    const datos = (await entrada.clone().json()) as { user: { id: string } };
    const userId = datos.user.id;

    // Las filas tal como quedaron, con los timestamps en texto (como los
    // guarda Postgres) para ver qué zona horaria escribió node-postgres.
    const filas = async (sql: string) => (await pool.query(sql, [userId])).rows;
    salida[nombre] = {
      baseURL,
      email,
      clave,
      userId,
      cookiesAlta: await cookiesDe(alta),
      cookiesEntrada: await cookiesDe(entrada),
      user: await filas(`select id, name, email, email_verified, image, created_at::text, updated_at::text from "user" where id = $1`),
      account: await filas(`select id, issuer, account_id, provider_id, user_id, password, created_at::text, updated_at::text from account where user_id = $1`),
      session: await filas(`select id, token, expires_at::text, created_at::text, updated_at::text, ip_address, user_agent, user_id from session where user_id = $1 order by created_at`),
      profiles: await filas(`select user_id, role::text, staff_role::text, condicion_iva::text from profiles where user_id = $1`),
      // Lo que devuelve getSession con esa cookie, para comparar.
      getSession: await auth.api.getSession({
        headers: new Headers({ cookie: (await cookiesDe(entrada)).map((c) => c.split(";")[0]).join("; ") }),
      }),
    };
  }

  // Hashes: la misma clave en composición Unicode distinta tiene que verificar
  // igual (NFKC). «é» precompuesta y «e» + acento combinado.
  const claves = ["maderera2026", "Clave con ñ y tilde á", "café", "café", "ｆｕｌｌｗｉｄｔｈ", "🔑 llave", "x".repeat(128)];
  salida.hashes = await Promise.all(claves.map(async (clave) => ({ clave, hash: await hashPassword(clave) })));

  // Firmas de cookie (better-call): HMAC-SHA256 en base64, dentro de encodeURIComponent.
  // No está entre las exportaciones públicas de better-call: se importa el
  // archivo, que es el mismo código que firma la cookie de sesión.
  // @ts-expect-error -- archivo interno de better-call, sin declaración de tipos
  const { signCookieValue } = await import("../../node_modules/better-call/dist/crypto.mjs");
  salida.firmas = await Promise.all(
    ["abc", "Tk9QZ3JlYXRUb2tlbjEyMzQ1Njc4OTAxMjM0NTY", "a.b.c", "ñ"].map(async (valor) => ({
      valor,
      firmado: await signCookieValue(valor, SECRETO),
    })),
  );

  const dir = new URL("../../backend/testdata/golden/auth/", import.meta.url);
  mkdirSync(dir, { recursive: true });
  writeFileSync(new URL("better-auth.json", dir), JSON.stringify(salida, null, 2) + "\n");
  console.log("listo:", new URL("better-auth.json", dir).pathname);
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
