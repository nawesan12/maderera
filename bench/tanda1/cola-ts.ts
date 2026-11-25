/**
 * La cola en TypeScript: el mismo SQL que lib/cola (tomarUno con SKIP LOCKED
 * y marcar hecho), por drizzle sobre pg. No se usa procesarCola directo
 * porque no se le puede registrar un tipo de prueba sin tocar el código; el
 * SQL es el mismo, copiado de lib/cola/index.ts.
 *
 *   BENCH_BASE=postgres://… npx tsx bench/tanda1/cola-ts.ts
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.BENCH_BASE, max: 20 });
const db = drizzle(pool);

async function tomarUno() {
  const { rows } = await db.execute<{ id: string; tipo: string; carga: unknown; intentos: number; max_intentos: number }>(sql`
    update trabajos
       set estado = 'procesando', intentos = intentos + 1, tomado_hasta = now() + '300000 milliseconds'::interval
     where id = (
       select id from trabajos
        where ((estado = 'pendiente' and proximo_intento_at <= now())
           or (estado = 'procesando' and tomado_hasta < now()))
          and tipo in (${"bench.vacio"})
        order by proximo_intento_at
        limit 1
        for update skip locked
     )
    returning id, tipo, carga, intentos, max_intentos`);
  return rows[0] ?? null;
}

async function main() {
  const rondas = 3;
  let total = 0, segundos = 0;
  for (let r = 0; r < rondas; r++) {
    await db.execute(sql`insert into trabajos (tipo, carga) select 'bench.vacio', '{}'::jsonb from generate_series(1, 2000)`);
    const inicio = performance.now();
    for (;;) {
      const t = await tomarUno();
      if (!t) break;
      await db.execute(sql`update trabajos set estado = 'hecho', terminado_at = now(), tomado_hasta = null, ultimo_error = null where id = ${t.id}`);
      total++;
    }
    segundos += (performance.now() - inicio) / 1000;
  }
  console.log(`ts   trabajos/s=${(total / segundos).toFixed(0)}  (${total} trabajos)`);
  await db.execute(sql`delete from trabajos where tipo = 'bench.vacio'`);
  await pool.end();
}
main();
