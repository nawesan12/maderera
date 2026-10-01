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

/**
 * Si la conexión va cifrada.
 *
 * Neon lo exige; un Postgres en la misma máquina no lo tiene configurado y
 * rechaza el intento con «the server does not support SSL connections».
 *
 * Se decidía mirando si la URL decía `localhost`, y eso alcanzaba mientras las
 * dos únicas opciones fueran Neon o el Docker de desarrollo. Deja de alcanzar
 * apenas la base corre en otro contenedor: la aplicación se conecta a `db:5432`
 * —el nombre del servicio—, que no dice `localhost`, así que intentaba cifrar
 * contra un servidor que no puede y no arrancaba.
 *
 * Ahora se puede decir explícitamente con `DATABASE_SSL`. Sin esa variable
 * queda la regla vieja, para no tocar lo que ya funciona.
 */
function usaSsl(url: string): boolean {
  const declarado = process.env.DATABASE_SSL?.trim().toLowerCase();
  if (declarado === "true" || declarado === "on") return true;
  if (declarado === "false" || declarado === "off") return false;

  return !url.includes("localhost") && !url.includes("127.0.0.1");
}

/**
 * El techo de conexiones, con diez si nadie dice otra cosa.
 *
 * Ver el comentario de `max` abajo para por qué diez. Se puede subir con
 * `DATABASE_POOL_MAX` sin tocar código; el caso es el servidor propio, donde
 * hay **una sola instancia** de la aplicación contra un Postgres que acepta
 * cien conexiones y no hay pooler adelante. Ahí diez sigue alcanzando para el
 * tráfico de hoy, pero si algún día se ve «timeout exceeded when trying to
 * connect» con la base tranquila, este es el número que hay que mover —sin
 * pasar de unas setenta, para dejarles lugar a los respaldos y a las
 * migraciones—.
 *
 * Un valor que no es un entero positivo se ignora: un error de tipeo en el
 * `.env` no puede dejar a la aplicación sin conexiones.
 */
function maximoDeConexiones(): number {
  const declarado = Number.parseInt(process.env.DATABASE_POOL_MAX ?? "", 10);
  return Number.isInteger(declarado) && declarado > 0 ? declarado : 10;
}

const pool =
  globalForDb.pool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: usaSsl(process.env.DATABASE_URL)
      ? { rejectUnauthorized: true }
      : false,

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
    max: maximoDeConexiones(),

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

/*
 * Un cliente que se muere no puede llevarse la instancia entera.
 *
 * `pg` emite `error` en el pool cuando una conexión que estaba ociosa se corta
 * —Neon escalando a cero, un corte de red, el pooler reciclando—. **Sin este
 * manejador, Node lo trata como una excepción no capturada y termina el
 * proceso**: con Fluid Compute, donde una misma instancia atiende muchas
 * requests a la vez, eso no es una consulta que falla sino todas las consultas
 * de esa instancia cayéndose juntas.
 *
 * Con el manejador, el cliente roto se descarta y el pool abre otro en la
 * próxima consulta, que es exactamente lo que uno querría que pasara.
 */
pool.on("error", (error) => {
  console.error("Conexión de la base caída, se descarta el cliente", error);
});

if (process.env.NODE_ENV !== "production") globalForDb.pool = pool;

export const db = drizzle(pool, { schema, casing: "snake_case" });
