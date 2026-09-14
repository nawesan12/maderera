import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("Falta DATABASE_URL. Copiá .env.example a .env.local.");
}

// En desarrollo el hot reload recrea los módulos en cada cambio, así que el pool
// se guarda en globalThis para no abrir una conexión nueva por recarga.
const globalForDb = globalThis as unknown as { pool?: Pool };

const pool =
  globalForDb.pool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    // Neon exige SSL; el Postgres local de Docker no lo tiene configurado.
    ssl: process.env.DATABASE_URL.includes("localhost")
      ? false
      : { rejectUnauthorized: true },

    /*
     * Pocas conexiones por instancia, a propósito.
     *
     * `pg` abre hasta diez por defecto, y eso está pensado para un servidor
     * único de toda la vida. Acá corre sobre funciones: bajo carga conviven
     * varias instancias, cada una con su pool, y diez por cabeza agotan el
     * techo de conexiones de la base mucho antes de que la aplicación esté
     * exigida. El síntoma no es lentitud sino "too many clients", que tira
     * pantallas enteras.
     *
     * Tres alcanza: una función atiende de a pocas consultas en paralelo y la
     * espera de una conexión libre dura microsegundos.
     */
    max: 3,

    /*
     * Y las que no se usan se sueltan. Entre el pico de la mañana en el
     * mostrador y la tarde tranquila no tiene sentido retener conexiones
     * abiertas contra una base que las cobra.
     */
    idleTimeoutMillis: 30_000,

    /*
     * Si la base no contesta en diez segundos, la consulta falla en vez de
     * quedarse colgada: es lo que permite que la pantalla muestre un error y
     * no una carga infinita.
     */
    connectionTimeoutMillis: 10_000,
  });

if (process.env.NODE_ENV !== "production") globalForDb.pool = pool;

export const db = drizzle(pool, { schema, casing: "snake_case" });
