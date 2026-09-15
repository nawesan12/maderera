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
     * Cuántas conexiones abre cada instancia.
     *
     * **Acá hubo un intento de ahorro que salió mal.** Estuvo en 3, con el
     * razonamiento de que varias instancias con diez conexiones cada una
     * agotarían el techo de la base. El número era demasiado bajo: una sola
     * carga de la portada dispara unas diez consultas en paralelo —cuatro del
     * layout y seis de la página— y con tres conexiones el resto hace cola. En
     * cuanto una tardaba, las que esperaban se pasaban del tiempo de conexión
     * y la página se caía con «Connection terminated due to connection
     * timeout».
     *
     * Diez es el valor por omisión de `pg` y es el que corresponde: **la URL
     * apunta al pooler de Neon**, que ya multiplexa contra Postgres, así que el
     * techo que se quería cuidar lo cuida él. Si algún día hay que bajarlo,
     * medir antes cuántas consultas en paralelo hace la página más pesada.
     */
    max: 10,

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
