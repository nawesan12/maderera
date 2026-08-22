/**
 * Da de alta una cuenta web de cliente desde la línea de comandos.
 *
 * El registro público existe y anda (`/registro`), pero siempre crea una ficha
 * nueva y vacía: por diseño no vincula automáticamente con un cliente del
 * mostrador, porque el alta no verifica el correo (ver
 * `app/(auth)/registro/actions.ts`). Este script es la contracara: sirve para
 * hacer a mano —con la decisión de una persona— la vinculación que el registro
 * no hace solo, y para armar cuentas de prueba con historial de verdad.
 *
 * Uso:
 *   npm run cliente:create -- --email roberto@rfconstrucciones.com.ar --password Prueba1234
 *
 * Si ya hay un cliente cargado con ese correo, la cuenta se vincula a esa ficha
 * y hereda sus pedidos, presupuestos y cuenta corriente. Si no, se crea una
 * ficha nueva.
 */
import { betterAuth } from "better-auth";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq, isNull, and } from "drizzle-orm";
import * as schema from "./schema";
import { buildAuthOptions } from "../auth-options";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg("email");
  const password = arg("password");
  const nombreArg = arg("name");

  if (!email || !password) {
    console.error(
      'Faltan datos.\nUso: npm run cliente:create -- --email cliente@ejemplo.com --password Secreto123 --name "Nombre"',
    );
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema, casing: "snake_case" });
  const auth = betterAuth(buildAuthOptions(db));

  // ¿Ya hay una ficha de mostrador con ese correo y sin cuenta web?
  const [fichaExistente] = await db
    .select({
      id: schema.customers.id,
      nombre: schema.customers.nombre,
      tipo: schema.customers.tipo,
    })
    .from(schema.customers)
    .where(
      and(eq(schema.customers.email, email), isNull(schema.customers.userId)),
    )
    .limit(1);

  const nombre = nombreArg ?? fichaExistente?.nombre ?? email.split("@")[0];

  const [previo] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, email))
    .limit(1);

  let userId: string;

  if (previo) {
    console.log(`${email} ya existe como usuario. Reuso la cuenta.`);
    userId = previo.id;
  } else {
    const alta = await auth.api.signUpEmail({
      body: { email, password, name: nombre },
    });
    userId = alta.user.id;
    console.log(`Usuario creado: ${email}`);
  }

  if (fichaExistente) {
    await db
      .update(schema.customers)
      .set({ userId, updatedAt: new Date() })
      .where(eq(schema.customers.id, fichaExistente.id));

    // Un cliente marcado como profesional en el mostrador tiene que ver los
    // precios de profesional también en el sitio.
    if (fichaExistente.tipo === "profesional") {
      await db
        .update(schema.profiles)
        .set({ role: "profesional", updatedAt: new Date() })
        .where(eq(schema.profiles.userId, userId));
    }

    console.log(
      `Vinculada a la ficha de "${fichaExistente.nombre}": hereda sus pedidos, presupuestos y cuenta corriente.`,
    );
  } else {
    const [propia] = await db
      .select({ id: schema.customers.id })
      .from(schema.customers)
      .where(eq(schema.customers.userId, userId))
      .limit(1);

    if (!propia) {
      await db.insert(schema.customers).values({
        userId,
        nombre,
        email,
        tipo: "particular",
        limiteCredito: "0",
        notas: "Cuenta creada con cliente:create.",
      });
      console.log("Ficha de cliente nueva creada (sin historial).");
    }
  }

  console.log(`\nListo. Entrá en http://localhost:3000/ingresar con:`);
  console.log(`  correo:     ${email}`);
  console.log(`  contraseña: ${password}`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
