import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import type { BetterAuthOptions } from "better-auth";
import * as schema from "./db/schema";

/**
 * Configuración de Better Auth, separada de `lib/auth.ts` a propósito.
 *
 * `lib/auth.ts` está marcado `server-only` y arma la instancia que usa la app. Los
 * scripts de línea de comandos (`create-staff`) no corren dentro de Next y no
 * pueden importar ese módulo, así que reciben estas mismas opciones con su propia
 * conexión. De este modo la config vive en un solo lugar y el hash de contraseña
 * que genera el script es idéntico al que valida el login.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildAuthOptions(db: any): BetterAuthOptions {
  return {
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: {
      enabled: true,
      // El sitio es para clientes de una maderera, no una app global: verificar el
      // mail antes de dejar entrar agrega fricción sin resolver un riesgo real.
      // Se revisa cuando se abra el registro de profesionales con cuenta corriente.
      requireEmailVerification: false,
      minPasswordLength: 8,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 días
      updateAge: 60 * 60 * 24, // renueva la sesión una vez por día de uso
    },
    databaseHooks: {
      user: {
        create: {
          /**
           * Todo usuario nace con perfil de cliente.
           *
           * El rol NO se toma de lo que mande quien se registra: si viniera del
           * formulario, cualquiera se daría de alta como administrador. Subir a
           * staff o a profesional es siempre una acción deliberada desde adentro
           * (`npm run staff:create` o la aprobación de profesionales).
           */
          after: async (nuevoUsuario) => {
            await db.insert(schema.profiles).values({
              userId: nuevoUsuario.id,
              role: "cliente",
            });
          },
        },
      },
    },
    // nextCookies() tiene que ir último: hace que las Server Actions puedan
    // escribir la cookie de sesión.
    plugins: [nextCookies()],
  };
}
