/**
 * Da de alta una persona del equipo y le crea el perfil con rol de staff.
 *
 * Existe porque el registro público crea siempre clientes: nadie puede volverse
 * administrador desde el sitio. El primer admin tiene que nacer desde acá.
 *
 * Uso:
 *   npm run staff:create -- --email juan@mjbj.com.ar --password Secreto123 --name "Juan Pérez" --role admin
 */
import { betterAuth } from "better-auth";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import * as schema from "./schema";
import { buildAuthOptions } from "../auth-options";

type StaffRole = (typeof schema.staffRole.enumValues)[number];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg("email");
  const password = arg("password");
  const name = arg("name") ?? email?.split("@")[0];
  const role = (arg("role") ?? "admin") as StaffRole;

  if (!email || !password) {
    console.error(
      'Faltan datos.\nUso: npm run staff:create -- --email mail@mjbj.com.ar --password Secreto123 --name "Nombre" --role admin',
    );
    process.exit(1);
  }

  if (!schema.staffRole.enumValues.includes(role)) {
    console.error(
      `Rol inválido: ${role}. Opciones: ${schema.staffRole.enumValues.join(", ")}`,
    );
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema, casing: "snake_case" });

  // La contraseña la hashea Better Auth, así que el alta se hace por su API y no
  // escribiendo la tabla a mano: así el hash siempre coincide con lo que espera
  // el login.
  const auth = betterAuth(buildAuthOptions(db));

  const [previo] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, email))
    .limit(1);

  let userId: string;

  if (previo) {
    const credenciales = await db
      .select({ id: schema.account.id })
      .from(schema.account)
      .where(eq(schema.account.userId, previo.id))
      .limit(1);

    if (credenciales.length === 0) {
      // Alta interrumpida a mitad de camino: el usuario existe pero no tiene con
      // qué iniciar sesión. No sirve para nada, así que se descarta y se rehace.
      console.log(`Encontré ${email} sin credenciales. Lo recreo.`);
      await db.delete(schema.user).where(eq(schema.user.id, previo.id));
      const alta = await auth.api.signUpEmail({
        body: { email, password, name: name! },
      });
      userId = alta.user.id;
    } else {
      // Se reescribe la contraseña con el hash que usa Better Auth hoy
      // (scrypt). Hace falta de verdad: una cuenta creada con otro esquema
      // —por ejemplo un bcrypt de un seed viejo— no falla diciendo "clave
      // incorrecta", falla con "Invalid password hash" y deja a esa persona
      // afuera sin forma de entrar.
      const contexto = await auth.$context;
      const hash = await contexto.password.hash(password);
      await contexto.internalAdapter.updatePassword(previo.id, hash);

      console.log(`${email} ya existe. Le actualicé la contraseña y el rol.`);
      userId = previo.id;
    }
  } else {
    const alta = await auth.api.signUpEmail({
      body: { email, password, name: name! },
    });
    userId = alta.user.id;
  }

  const existing = await db
    .select({ id: schema.profiles.id })
    .from(schema.profiles)
    .where(eq(schema.profiles.userId, userId))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(schema.profiles)
      .set({ role: "staff", staffRole: role, updatedAt: new Date() })
      .where(eq(schema.profiles.userId, userId));
  } else {
    await db.insert(schema.profiles).values({
      userId,
      role: "staff",
      staffRole: role,
    });
  }

  console.log(`Listo: ${email} habilitado como staff/${role}.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
